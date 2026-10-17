-- 0006_withdraw: withdrawing a note (F4.2, docs/SPEC.md → F4) and the Realtime publication the trust proof needs.
--   answers           every saved answer stands on live notes only, however it is written (a trigger)
--   withdraw_note()   the author withdraws their own live note; every saved answer that cited it is answered again
--                     without it, and one events row records the counts and the milliseconds (numbers only)
--   events            withdraw rows readable by signed-in users: counts and timings only, never text
--   Realtime          notes (status changes), answers (asker only, by RLS) and events (the meter)
-- After a withdrawal the note is readable only by its author (0002/0003), so Realtime sends its status change to the
-- author alone: a pane that can no longer read the note gets nothing for it. Every other pane learns of it from its
-- re-answered answers row (the asker) or from the events row (everyone signed in), as issue #26 asks.

-- Answers stand on live notes only -------------------------------------------------

-- An answered result keeps only the sentences whose citations are all live notes its asker may read (SPEC → Scope
-- rules: withdrawn notes are never in answers, answers come only from notes the asker may read; AGENTS.md: every
-- sentence cites a note). Readability is checked too so the trigger tells an asker nothing: citing a note they can't
-- read looks exactly like citing one that doesn't exist or was withdrawn (otherwise anyone could save an answer citing
-- guessed note ids and read back which exist). Unchanged when every sentence stands, which is every answer
-- POST /api/ask and deliver_answer() write today (both cite only such notes). Otherwise:
--   - the rule-change note goes: it is computed from the deadline notes the sentences cite (lib/engine/rule-change.ts),
--     so it may rest on a sentence that went, and better none than a wrong one;
--   - `live` stays only while a remaining citation carries its byline;
--   - with no sentence left the answer is the blank line again, abstained and routed nowhere (withdrawing never sends
--     the question back to the person who just withdrew), with the row's own question id.
-- A malformed answered payload (anyone can write their own answers row) keeps no sentence, so it becomes that same
-- valid abstain instead of an error. So does one past the caps: 64 kB, 40 sentences, 20 citations in a sentence, far
-- above any real answer (a few sentences), so nobody can store rows that make a withdrawal rewrite slow enough to time
-- out. It reads notes' status and scope only, never their content.
create function private.on_live_notes(answer jsonb, question uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  sentences jsonb := case when jsonb_typeof(answer -> 'sentences') = 'array' then answer -> 'sentences' else '[]'::jsonb end;
  asker uuid;
  kept jsonb;
  next_answer jsonb;
begin
  if answer ->> 'status' is distinct from 'answered' then
    return answer;
  end if;
  if pg_column_size(answer) > 65536
    or jsonb_array_length(sentences) > 40
    or exists (
      select 1 from jsonb_array_elements(sentences) s
      where jsonb_array_length(case when jsonb_typeof(s -> 'citations') = 'array' then s -> 'citations' else '[]'::jsonb end) > 20
    )
  then
    return jsonb_build_object('status', 'abstained', 'questionId', question::text, 'routedTo', 0);
  end if;
  select q.asker_user_id into asker from public.questions q where q.id = question;

  -- Each array function gets an array whatever the payload holds (SQL doesn't promise to test the type first).
  select coalesce(jsonb_agg(s order by ord), '[]'::jsonb) into kept
  from jsonb_array_elements(sentences) with ordinality as t (s, ord),
    lateral (
      select case when jsonb_typeof(s -> 'citations') = 'array' then s -> 'citations' else '[]'::jsonb end as citations
    ) cited
  where jsonb_array_length(cited.citations) > 0
    and not exists (
      select 1
      from jsonb_array_elements(cited.citations) c
      where not exists (
        select 1 from public.notes n
        where n.id = c ->> 'noteId'
          and n.status = 'live'
          and private.can_read_note_as(asker, n.seat_id, n.term_order, n.scope, n.status, n.author_user_id)
      )
    );

  if kept = answer -> 'sentences' and kept <> '[]'::jsonb then
    return answer;
  end if;
  if kept = '[]'::jsonb then
    return jsonb_build_object('status', 'abstained', 'questionId', question::text, 'routedTo', 0);
  end if;

  next_answer := (answer - 'ruleChange') || jsonb_build_object('sentences', kept);
  if not exists (
    select 1
    from jsonb_array_elements(kept) s
    cross join jsonb_array_elements(s -> 'citations') c
    where c ->> 'byline' = answer -> 'live' ->> 'byline'
  ) then
    next_answer := next_answer - 'live';
  end if;
  return next_answer;
end;
$$;

-- Every write to answers goes through it: POST /api/ask as the asker, deliver_answer(), an asker's own update, and
-- withdraw_note() below. It first takes a share lock on the notes the answer cites, so it can't race a withdrawal: an
-- answer saved while a withdrawal of one of its notes runs waits for it and then drops that note's sentences, and a
-- withdrawal that starts after waits for the answer and then answers it again. (POST /api/ask writes seconds after its
-- search, with the model in between, so this happens.)
create function private.answers_on_live_notes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Past the size cap it abstains without reading a note, so there is nothing to lock.
  if pg_column_size(new.payload) <= 65536 then
    -- Only notes the asker may read, so a write never waits on (or reveals) a note they can't; in id order, so two
    -- writes lock the same notes the same way round.
    perform 1
    from public.notes n
    where n.id in (
        select c #>> '{}'
        from jsonb_path_query(new.payload, 'lax $.sentences[*].citations[*].noteId', '{}', true) c
      )
      and private.can_read_note_as(
        (select q.asker_user_id from public.questions q where q.id = new.question_id),
        n.seat_id, n.term_order, n.scope, n.status, n.author_user_id
      )
    order by n.id
    for share of n;
  end if;
  new.payload := private.on_live_notes(new.payload, new.question_id);
  return new;
end;
$$;

create trigger answers_on_live_notes
before insert or update of payload on public.answers
for each row execute function private.answers_on_live_notes();

-- Only the trigger and withdraw_note() use them; a trigger function runs without its caller's execute privilege.
revoke all on function private.on_live_notes(jsonb, uuid), private.answers_on_live_notes()
from public, anon, authenticated, service_role;

-- Withdrawing ------------------------------------------------------------------

-- As the author: status withdrawn with withdrawn_at, then every answers row whose sentences cite the note is written
-- again, and the trigger above answers it on live notes only. Security definer because the answers rows belong to
-- other people (the askers); it acts for auth.uid() only and checks the caller first. The rows are matched with a lax
-- JSON path, which skips a malformed payload instead of failing, so nobody's answers row can stop a withdrawal.
-- Withdrawing again returns the first withdrawn_at and writes no second events row. Withdrawals run one at a time (a
-- transaction advisory lock): two at once, of notes one answer cites, could otherwise deadlock on that answer.
create function public.withdraw_note(note text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  started timestamptz := clock_timestamp();
  target public.notes%rowtype;
  first_time boolean;
  updated integer;
  abstained integer;
begin
  perform pg_advisory_xact_lock(hashtext('public.withdraw_note'));
  select n.* into target
  from public.notes n
  where n.id = note and n.author_user_id = auth.uid()
  for update of n;
  if not found then
    -- The same for a note that doesn't exist, so the answer never tells whether someone else's note is there.
    raise exception 'withdraw_note: not a note you wrote' using errcode = '42501';
  end if;

  first_time := target.status <> 'withdrawn';
  if first_time then
    update public.notes n
    set status = 'withdrawn', withdrawn_at = now()
    where n.id = target.id
    returning n.* into target;
  end if;

  -- created_at moves too, so each row reads as the asker's latest answer; Realtime brings it to the asker alone.
  with changed as (
    update public.answers a
    set payload = a.payload, created_at = now()
    where a.payload ->> 'status' = 'answered'
      and jsonb_path_exists(
        a.payload,
        'lax $.sentences[*].citations[*] ? (@.noteId == $id)',
        jsonb_build_object('id', target.id),
        true
      )
    returning a.payload ->> 'status' as status
  )
  select count(*), count(*) filter (where status = 'abstained') into updated, abstained
  from changed;

  -- One row per withdrawal: the meter's signal and the count for `pnpm metrics`, never the note or its answers.
  if first_time then
    insert into public.events (kind, payload)
    values (
      'withdraw',
      jsonb_build_object(
        'answers', updated,
        'abstained', abstained,
        'ms', round(extract(epoch from clock_timestamp() - started) * 1000, 1)
      )
    );
  end if;

  return target.withdrawn_at;
end;
$$;

-- Supabase grants every new function in public to anon, authenticated and service_role; only signed-in users withdraw.
revoke all on function public.withdraw_note(text) from public, anon, authenticated, service_role;
grant execute on function public.withdraw_note(text) to authenticated;

-- notes has no update policy, so RLS already refuses a direct update; without the grant, too, withdrawing has one way.
revoke update on public.notes from anon, authenticated;

-- Events -----------------------------------------------------------------------

-- Numbers only (lib/contracts.ts → EventsRow). Signed-in panes read the withdraw rows: the console's meter and the
-- signal that a note was withdrawn. Other kinds (leak test, live-loop timings, redaction counts) stay unreadable until
-- a screen needs one: each would tell any signed-in account what others are doing, so each is added on purpose.
-- Writes come only from the functions and scripts/. Signed out, nothing: no policy for anon. anon keeps its select
-- grant, as in 0005, so Realtime drops each events row for a signed-out subscriber silently instead of sending it an
-- "Error 401" that would tell it a withdrawal just happened.
create policy "events: signed-in users read the withdraw numbers"
on public.events for select to authenticated
using (kind = 'withdraw');

revoke insert, update, delete, truncate on public.events from anon, authenticated;

-- Realtime ---------------------------------------------------------------------

-- Realtime applies each table's select policy per subscriber. Added one by one, skipping a table already published
-- (0005 published answers). For notes it sends the whole row, body and embedding included, but only to subscribers
-- who may read that row: readers of a live note, and its author alone once it is withdrawn. Clients keep { id, status }
-- (lib/contracts.ts → NotesRow) and never read note content from a Realtime row.
do $$
declare
  t text;
begin
  foreach t in array array['notes', 'answers', 'events'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
