-- 0006_withdraw: withdrawing a note (F4.2, docs/SPEC.md → F4) and the Realtime publication the trust proof needs.
--   withdraw_note()   the author withdraws their own live note; every saved answer that cited it is answered again
--                     without it, and one events row records the counts and the milliseconds (numbers only)
--   events            readable by signed-in users: counts and timings only, never note, question or chat text
--   Realtime          notes (status changes), answers (asker only, by RLS) and events (the meter)
-- After a withdrawal the note is readable only by its author (0002/0003), so Realtime sends its status change to the
-- author alone: a pane that can no longer read the note gets nothing for it. Every other pane learns of it from its
-- re-answered answers row (the asker) or from the events row (everyone signed in), as issue #26 asks.

-- Withdrawing ------------------------------------------------------------------

-- As the author: status withdrawn with withdrawn_at, then each answers row whose sentences cite the note drops those
-- sentences (a sentence citing it alongside another note goes too: every sentence must stand on live notes only).
-- The rule-change note goes with any dropped sentence: it is computed from the deadline notes the sentences cite
-- (lib/engine/rule-change.ts), so it may rest on what went, and better none than a wrong one. `live` stays only while
-- a remaining citation carries its byline. With no sentence left the answer is the blank line again: abstained, routed
-- nowhere (withdrawing never sends the question back to the person who just withdrew). Security definer because the
-- answers rows belong to other people (the askers); it acts for auth.uid() only and checks the caller first.
-- Withdrawing again returns the first withdrawn_at and writes no second events row, but cleans answers again: one saved
-- while the withdrawal ran (POST /api/ask is slow to write, the model sits between search and save) can still cite it.
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
  stored record;
  kept jsonb;
  next_payload jsonb;
  updated integer := 0;
  abstained integer := 0;
begin
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

  for stored in
    select a.question_id, a.payload
    from public.answers a
    where a.payload ->> 'status' = 'answered'
      and exists (
        select 1
        from jsonb_array_elements(a.payload -> 'sentences') s
        cross join jsonb_array_elements(s -> 'citations') c
        where c ->> 'noteId' = target.id
      )
    for update of a
  loop
    select coalesce(jsonb_agg(s order by ord), '[]'::jsonb) into kept
    from jsonb_array_elements(stored.payload -> 'sentences') with ordinality as t (s, ord)
    where not exists (
      select 1 from jsonb_array_elements(s -> 'citations') c where c ->> 'noteId' = target.id
    );

    if kept = '[]'::jsonb then
      -- The row's own key, not the payload's copy of it (lib/contracts.ts → AbstainedResult).
      next_payload := jsonb_build_object(
        'status', 'abstained',
        'questionId', stored.question_id::text,
        'routedTo', 0
      );
      abstained := abstained + 1;
    else
      next_payload := (stored.payload - 'ruleChange') || jsonb_build_object('sentences', kept);
      if not exists (
        select 1
        from jsonb_array_elements(kept) s
        cross join jsonb_array_elements(s -> 'citations') c
        where c ->> 'byline' = stored.payload -> 'live' ->> 'byline'
      ) then
        next_payload := next_payload - 'live';
      end if;
    end if;

    -- created_at moves too, so the row reads as the asker's latest answer; Realtime brings it to the asker alone.
    update public.answers a
    set payload = next_payload, created_at = now()
    where a.question_id = stored.question_id;
    updated := updated + 1;
  end loop;

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

-- Numbers only (lib/contracts.ts → EventsRow), so every signed-in pane may read them: the console's meter and the
-- signal that a note was withdrawn. Writes come only from the functions and scripts/. Signed out, nothing: no policy
-- for anon. anon keeps its select grant, as in 0005, so Realtime drops each events row for a signed-out subscriber
-- silently instead of sending it an "Error 401" that would tell it a withdrawal just happened.
create policy "events: signed-in users read the numbers"
on public.events for select to authenticated
using (true);

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
