-- 0003_tables_rls: who can read and write the other tables (docs/SPEC.md → "Scope rules"), and the writes of the
-- live loop (ask → route → publish → signed answer), all without the service-role key.
--   institutions, groups, seats   everyone, signed out too; opening a seat page never grants membership
--   group_members, seat_holders   your own rows; a seat's lineage (terms, never who) through seat_lineage()
--   notes                         0002's rings, now defined once; holders publish into their own terms
--   questions, answers            only the asker
--   prompts                       holders of the seat; a demand prompt (a newcomer's question) only where routed
--   prompt_routes                 only the recipient, who may set seen_at; their inbox through inbox()
--   events                        nobody yet (F4)
-- Writes that cross people (routing a question to a predecessor, answering it) go only through the functions at the
-- end. They act for auth.uid() and check the caller first; the tables give the API roles no such writes.

-- Who can read a note ------------------------------------------------------------

-- The live loop answers a newcomer with the newcomer's rings, not the predecessor's, so 0002's rule now takes the
-- viewer as an argument. This is its only definition: the notes policy and the live-loop functions both use it.
-- Only the owner may execute it; the API roles get the wrapper below, which answers for auth.uid() only.
create function private.can_read_note_as(
  viewer uuid,
  note_seat uuid,
  note_term integer,
  note_scope text,
  note_status text,
  note_author uuid
)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(note_author = viewer, false) or (
    note_status = 'live'
    and case note_scope
      -- holders of the same seat with a later term
      when 'successor' then exists (
        select 1 from public.seat_holders h
        where h.user_id = viewer and h.seat_id = note_seat and h.term_order > note_term
      )
      -- every holder of the seat, plus every member (current or alumni) of its group
      when 'group' then exists (
        select 1 from public.seat_holders h where h.user_id = viewer and h.seat_id = note_seat
      ) or exists (
        select 1 from public.seats s
        join public.group_members m on m.group_id = s.group_id
        where s.id = note_seat and m.user_id = viewer
      )
      -- every holder of the seat, plus every member of any group at its institution (its own group included)
      when 'institution' then exists (
        select 1 from public.seat_holders h where h.user_id = viewer and h.seat_id = note_seat
      ) or exists (
        select 1 from public.seats s
        join public.groups g on g.id = s.group_id
        join public.groups peer on peer.institution_id = g.institution_id
        join public.group_members m on m.group_id = peer.id
        where s.id = note_seat and m.user_id = viewer
      )
      when 'public' then true
      else false
    end
  );
$$;

create function private.can_read_note(
  note_seat uuid,
  note_term integer,
  note_scope text,
  note_status text,
  note_author uuid
)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.can_read_note_as(auth.uid(), note_seat, note_term, note_scope, note_status, note_author);
$$;

-- Whether the signed-in user holds the seat, in any term.
create function private.holds_seat(seat uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.seat_holders h where h.user_id = auth.uid() and h.seat_id = seat);
$$;

-- Whether the signed-in user may sign a note of the seat for that term: they held it then, and the byline starts with
-- that term, as every label pack's byline does (「2025年度 会計」). The route words the rest from the label pack.
create function private.may_sign(seat uuid, term integer, byline text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.seat_holders h
    where h.user_id = auth.uid() and h.seat_id = seat and h.term_order = term
      and h.term_label <> '' and starts_with(byline, h.term_label)
  );
$$;

revoke all on function
  private.can_read_note_as(uuid, uuid, integer, text, text, uuid),
  private.can_read_note(uuid, integer, text, text, uuid),
  private.holds_seat(uuid),
  private.may_sign(uuid, integer, text)
from public, anon, authenticated, service_role;
grant execute on function private.can_read_note(uuid, integer, text, text, uuid) to anon, authenticated;
grant execute on function private.holds_seat(uuid), private.may_sign(uuid, integer, text) to authenticated;

alter policy "notes: readable within their scope ring"
on public.notes
using (private.can_read_note(seat_id, term_order, scope, status, author_user_id));

drop function private.holds_later_term(uuid, integer), private.in_group_ring(uuid), private.in_institution_ring(uuid);

-- Seats and where they live: everyone ---------------------------------------------------

-- Reads only: no API role can write these tables, so opening a seat page (QR, NFC, URL) joins nothing.
create policy "institutions: readable by everyone"
on public.institutions for select to anon, authenticated
using (true);

create policy "groups: readable by everyone"
on public.groups for select to anon, authenticated
using (true);

create policy "seats: readable by everyone"
on public.seats for select to anon, authenticated
using (true);

-- Who holds what: your own rows ---------------------------------------------------------

create policy "group_members: your own rows"
on public.group_members for select to authenticated
using (user_id = (select auth.uid()));

create policy "seat_holders: your own rows"
on public.seat_holders for select to authenticated
using (user_id = (select auth.uid()));

-- A seat's lineage for its page (代々の会計): the terms, oldest first, never who held them or whether they're
-- reachable. Anyone may call it, signed out too.
create function public.seat_lineage(seat uuid)
returns table (term_label text, term_order integer)
language sql stable security definer
set search_path = ''
as $$
  select distinct h.term_label, h.term_order
  from public.seat_holders h
  where h.seat_id = seat
  order by h.term_order, h.term_label;
$$;

-- Notes: holders publish into their own terms -------------------------------------------

-- Publishing (the live answer, F5 additions, F6 handover) inserts as the author, into a seat and term they held,
-- signed with that term. Only these columns: a new note is live and current, and its id and time come from the
-- database, since a chosen id's unique-key error would tell whether a note the publisher can't read exists.
-- 「更新する」 (superseded_by) is F5.6; withdrawing is F4.
create policy "notes: holders publish into their own terms"
on public.notes for insert to authenticated
with check (author_user_id = (select auth.uid()) and private.may_sign(seat_id, term_order, byline));

revoke insert on public.notes from anon, authenticated;
grant insert (
  seat_id, term_order, author_user_id, byline, kind, title, body, deadline_date, lang, scope, critical, valid_until,
  source, provenance, embedding
) on public.notes to authenticated;

-- Questions and answers: only the asker -------------------------------------------------

-- POST /api/ask runs as the asker: it saves the question (answered or waiting) and, when answered, its answer.
-- Linking a question to a prompt is route_question()'s job, so a new question links to none.
create policy "questions: the asker reads their own"
on public.questions for select to authenticated
using (asker_user_id = (select auth.uid()));

create policy "questions: the asker saves their own"
on public.questions for insert to authenticated
with check (asker_user_id = (select auth.uid()) and prompt_id is null);

create policy "answers: the asker reads their own"
on public.answers for select to authenticated
using (question_id in (select q.id from public.questions q where q.asker_user_id = (select auth.uid())));

create policy "answers: the asker saves their own"
on public.answers for insert to authenticated
with check (question_id in (select q.id from public.questions q where q.asker_user_id = (select auth.uid())));

create policy "answers: the asker updates their own"
on public.answers for update to authenticated
using (question_id in (select q.id from public.questions q where q.asker_user_id = (select auth.uid())))
with check (question_id in (select q.id from public.questions q where q.asker_user_id = (select auth.uid())));

-- Prompts: holders of the seat; demand prompts only where routed ------------------------

-- Handover prompts (F6) are for whoever holds the seat in any term. A demand prompt carries a newcomer's question,
-- which reaches only the reachable holders it was routed to (SPEC → Scope rules), so it's read through a route.
-- Prompts are written only by route_question() and deliver_answer().
create policy "prompts: holders of the seat, demand prompts only where routed"
on public.prompts for select to authenticated
using (
  private.holds_seat(seat_id)
  and (
    kind <> 'demand'
    or exists (
      select 1 from public.prompt_routes r where r.prompt_id = prompts.id and r.user_id = (select auth.uid())
    )
  )
);

-- Prompt routes: only the recipient -----------------------------------------------------

create policy "prompt_routes: the recipient reads their own"
on public.prompt_routes for select to authenticated
using (user_id = (select auth.uid()));

-- Opening the slip sets seen_at (F3.6). Only that column, so nobody can point their route at another prompt.
create policy "prompt_routes: the recipient marks their own seen"
on public.prompt_routes for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

revoke update on public.prompt_routes from anon, authenticated;
grant update (seen_at) on public.prompt_routes to authenticated;

-- The live loop -------------------------------------------------------------------------
-- 1. POST /api/ask, as the newcomer: nothing answers → save the question (waiting) → route_question().
-- 2. GET /api/inbox, as the predecessor: inbox(); a new prompt_routes row arrives by Realtime (F3.6).
-- 3. POST /api/handover/publish, as the predecessor: insert the notes → waiting_questions() → deliver_answer()
--    for each question, so each asker's answers row arrives by Realtime, signed.
-- These are security definer because they read or write rows their caller can't (another person's question, prompt,
-- route or answer). Each acts for auth.uid() only and checks the caller first.

-- After an abstain, as the asker: their waiting question becomes a demand prompt of the seat (a new one, or an open
-- one that asks the same thing, F2.5) and reaches the seat's reachable holders other than the asker. Only a holder
-- of the seat routes: anyone else's question creates no prompt and reaches nobody (prompt_id null, routed_to 0).
create function public.route_question(
  question uuid,
  prompt_text text default null, -- the question as a prompt about the seat; its recipients read it
  join_prompt uuid default null, -- or an open demand prompt of the seat to join
  out prompt_id uuid,
  out routed_to integer
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  asked public.questions%rowtype;
  prompt uuid;
begin
  select q.* into asked
  from public.questions q
  where q.id = question and q.asker_user_id = auth.uid() and q.status = 'waiting' and q.prompt_id is null
  for update;
  if not found then
    raise exception 'route_question: not a waiting, unrouted question of yours' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.seat_holders h where h.user_id = asked.asker_user_id and h.seat_id = asked.seat_id
  ) then
    routed_to := 0;
    return;
  end if;

  if join_prompt is not null then
    update public.prompts p
    set ask_count = p.ask_count + 1
    where p.id = join_prompt and p.seat_id = asked.seat_id and p.kind = 'demand' and not p.retired
    returning p.id into prompt;
    if prompt is null then
      raise exception 'route_question: not an open demand prompt of this seat' using errcode = '22023';
    end if;
  elsif length(btrim(coalesce(prompt_text, ''))) between 1 and 500 then
    insert into public.prompts (seat_id, kind, text, ask_count, source_question_id)
    values (asked.seat_id, 'demand', btrim(prompt_text), 1, asked.id)
    returning id into prompt;
  else
    raise exception 'route_question: prompt_text must be 1 to 500 characters' using errcode = '22023';
  end if;

  update public.questions q set prompt_id = prompt where q.id = asked.id;

  insert into public.prompt_routes (prompt_id, user_id)
  select distinct prompt, h.user_id
  from public.seat_holders h
  where h.seat_id = asked.seat_id and h.reachable and h.user_id <> asked.asker_user_id
  on conflict do nothing;

  select count(*)::integer into routed_to
  from public.prompt_routes r
  where r.prompt_id = prompt and r.user_id <> asked.asker_user_id;
  prompt_id := prompt;
end;
$$;

-- The predecessor's inbox at a seat (InboxItem in lib/contracts.ts): the open demand prompts routed to them, oldest
-- first, each with its first asker's question time, lang and term at the seat. The route formats askedBy
-- (「2026年度 会計」) from that term with the label pack; who asked never leaves the database.
create function public.inbox(seat uuid)
returns table (
  prompt_id uuid,
  question text,
  ask_count integer,
  asked_at timestamptz,
  lang text,
  asked_by_term text
)
language sql stable security definer
set search_path = ''
as $$
  select p.id, p.text, p.ask_count, asked.created_at, asked.lang, (
      select h.term_label from public.seat_holders h
      where h.user_id = asked.asker_user_id and h.seat_id = p.seat_id
      order by h.term_order desc
      limit 1
    )
  from public.prompt_routes r
  join public.prompts p on p.id = r.prompt_id
  cross join lateral (
    select q.created_at, q.lang, q.asker_user_id
    from public.questions q
    where q.prompt_id = p.id
    order by q.created_at, q.id
    limit 1
  ) asked
  where r.user_id = auth.uid() and p.seat_id = seat and not p.retired
  order by asked.created_at, p.id;
$$;

-- After publishing, as the predecessor: the questions still waiting on a prompt routed to them, oldest first, each
-- with the notes (of note_ids) its asker may read. Only the caller's own live notes of that seat count. Ids and lang
-- only: the question text reaches the predecessor through the inbox. valid_until is a date on the Japanese calendar,
-- so here and in deliver_answer() "expired" uses Tokyo's date, as search_notes (0004) does, not the session's.
create function public.waiting_questions(prompt uuid, note_ids text[])
returns table (question_id uuid, lang text, readable_note_ids text[])
language sql stable security definer
set search_path = ''
as $$
  select q.id, q.lang, array(
    select n.id
    from public.notes n
    where n.id = any (note_ids)
      and n.author_user_id = auth.uid()
      and n.seat_id = q.seat_id
      and n.status = 'live'
      and n.superseded_by is null
      and (n.valid_until is null or n.valid_until >= (now() at time zone 'Asia/Tokyo')::date)
      and private.can_read_note_as(q.asker_user_id, n.seat_id, n.term_order, n.scope, n.status, n.author_user_id)
    order by array_position(note_ids, n.id)
  )
  from public.questions q
  where q.prompt_id = prompt
    and q.status = 'waiting'
    and exists (select 1 from public.prompt_routes r where r.prompt_id = prompt and r.user_id = auth.uid())
  order by q.created_at, q.id;
$$;

-- As the predecessor, once per waiting question: the signed answer, an AnsweredResult with `live`
-- (lib/contracts.ts) that the route builds from the notes waiting_questions() returned. Each citation must be the
-- caller's own live note of the seat that the asker may read, with its byline and term. Upserts the asker's answers
-- row (Realtime brings it to the asker alone), marks the question answered, and retires the prompt once nothing
-- waits on it.
create function public.deliver_answer(question uuid, answer jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  asked public.questions%rowtype;
begin
  select q.* into asked
  from public.questions q
  where q.id = question
    and q.status = 'waiting'
    and exists (select 1 from public.prompt_routes r where r.prompt_id = q.prompt_id and r.user_id = auth.uid())
  for update of q;
  if not found then
    raise exception 'deliver_answer: not a question waiting on you' using errcode = '42501';
  end if;

  if answer ->> 'status' is distinct from 'answered'
    or answer ->> 'questionId' is distinct from asked.id::text
    or jsonb_typeof(answer -> 'live' -> 'byline') is distinct from 'string'
    or jsonb_typeof(answer -> 'sentences') is distinct from 'array'
    or answer -> 'sentences' = '[]'::jsonb
  then
    raise exception 'deliver_answer: not a live answered result for this question' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(answer -> 'sentences') s
    where jsonb_typeof(s -> 'citations') is distinct from 'array' or s -> 'citations' = '[]'::jsonb
  ) then
    raise exception 'deliver_answer: every sentence cites at least one note' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(answer -> 'sentences') s
    cross join jsonb_array_elements(s -> 'citations') c
    left join public.notes n on n.id = c ->> 'noteId'
    where n.id is null
      or n.author_user_id is distinct from auth.uid()
      or n.seat_id <> asked.seat_id
      or n.status <> 'live'
      or n.superseded_by is not null
      or n.valid_until < (now() at time zone 'Asia/Tokyo')::date
      or n.byline is distinct from c ->> 'byline'
      or not exists (
        select 1 from public.seat_holders h
        where h.user_id = n.author_user_id and h.seat_id = n.seat_id and h.term_order = n.term_order
          and h.term_label = c ->> 'termLabel'
      )
      or not private.can_read_note_as(
        asked.asker_user_id, n.seat_id, n.term_order, n.scope, n.status, n.author_user_id
      )
  ) then
    raise exception 'deliver_answer: a citation is not your own note, as published, that this asker may read'
      using errcode = '42501';
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(answer -> 'sentences') s
    cross join jsonb_array_elements(s -> 'citations') c
    where c ->> 'byline' = answer -> 'live' ->> 'byline'
  ) then
    raise exception 'deliver_answer: live.byline is not the byline of a cited note' using errcode = '22023';
  end if;

  insert into public.answers (question_id, payload)
  values (asked.id, answer)
  on conflict (question_id) do update set payload = excluded.payload, created_at = now();

  update public.questions q set status = 'answered' where q.id = asked.id;

  -- Lock the prompt first: the check below then sees a question that route_question() is joining to it right now,
  -- or that another deliver_answer() has just answered.
  perform 1 from public.prompts p where p.id = asked.prompt_id for update;
  update public.prompts p
  set retired = true
  where p.id = asked.prompt_id
    and not exists (select 1 from public.questions w where w.prompt_id = p.id and w.status = 'waiting');
end;
$$;

-- Supabase grants every new function in public to anon, authenticated and service_role; keep each to its callers.
revoke all on function
  public.seat_lineage(uuid),
  public.route_question(uuid, text, uuid),
  public.inbox(uuid),
  public.waiting_questions(uuid, text[]),
  public.deliver_answer(uuid, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.seat_lineage(uuid) to anon, authenticated;
grant execute on function
  public.route_question(uuid, text, uuid),
  public.inbox(uuid),
  public.waiting_questions(uuid, text[]),
  public.deliver_answer(uuid, jsonb)
to authenticated;
