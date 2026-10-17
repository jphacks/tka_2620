-- 0007_publish_hardening: what a published note and a live answer may say is the database's decision, not the
-- client's (the F3.8 leak audit). POST /api/handover/publish already does all of this; these hold for anyone writing
-- through PostgREST with their own token too.
--   seat_holders.byline   the byline a holder signs with for that term (「2025年度 会計」), written by scripts/seed.ts
--                         from the label pack; may_sign() now wants exactly it, so nobody signs 「2025年度 部長」
--   notes guard           a note whose title, body or provenance holds an email, an @handle or a phone number is
--                         refused (the patterns of lib/engine/guard.ts); names and credentials stay with the route,
--                         which knows the wording
--   deliver_answer()      stores the answer rebuilt from known parts; anything else the caller sends is dropped
-- After applying, run `pnpm seed` (demo:reset) so every holder has a byline: until then may_sign() refuses everyone.

-- Bylines -------------------------------------------------------------------------------

-- The wording stays in the label packs (messages/*.json → seatTypes.*.byline): the seed fills it in for each holder's
-- term, as it does for the seed notes, and whatever creates a holder later must do the same.
alter table public.seat_holders add column byline text;

-- Whether the signed-in user may sign a note of the seat for that term: they held it then, and the byline is exactly
-- the one their term signs with. The arguments are qualified because seat_holders now has a byline column too.
create or replace function private.may_sign(seat uuid, term integer, byline text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.seat_holders h
    where h.user_id = auth.uid() and h.seat_id = may_sign.seat and h.term_order = may_sign.term
      and h.byline = may_sign.byline
  );
$$;

-- The notes guard -----------------------------------------------------------------------

-- On every insert, and every edit of the text a reader sees. NFKC turns full-width letters, digits and symbols into
-- ASCII (０９０, ＠, ．), and kanji digits become digits too. Phone numbers are matched once up to three separators
-- between digits are gone (03-1234-5678, (0)90…, 090の1234…), as lib/engine/guard.ts does; dates and amounts don't
-- start with 0 or reach ten digits. DD001 lets the route answer unredacted.
create function private.reject_contact_details()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  shown text := translate(
    normalize(concat_ws(E'\n', new.title, new.body, new.provenance), nfkc),
    '〇一二三四五六七八九',
    '0123456789'
  );
  digits text;
begin
  if shown ~ '[[:alnum:]_.%+-][[:space:]]?@[[:space:]]?[[:alnum:]_-]'
    or shown ~ '(^|[^[:alnum:]_.])@[A-Za-z0-9_.]{2,}'
  then
    raise exception 'notes: a note holds no email or @handle' using errcode = 'DD001';
  end if;
  digits := regexp_replace(shown, '([0-9])[[:space:]().,/・〜~_‐‑‒–—―−ーの-]{1,3}(?=[0-9])', '\1', 'g');
  if digits ~ '(^|[^0-9])(\+?810?[0-9]{9,10}|0[0-9]{9,10})([^0-9]|$)' then
    raise exception 'notes: a note holds no phone number' using errcode = 'DD001';
  end if;
  return new;
end;
$$;

create trigger notes_no_contact_details
before insert or update of title, body, provenance on public.notes
for each row execute function private.reject_contact_details();

-- Delivering a live answer --------------------------------------------------------------

-- As 0003's, with two more checks (the language, and every sentence's text), and the answer stored from known parts
-- only: each sentence's text with its citations as the notes have them, the language and live.byline. Anything else
-- the caller sends is dropped, a rule-change flag included: a live answer cites one term's notes, so it never has
-- one, and the flag is never the caller's to set. The sentence text is still the caller's; the route writes it from
-- the notes, and only the asker the question was routed to reads it.
create or replace function public.deliver_answer(question uuid, answer jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  asked public.questions%rowtype;
  stored jsonb;
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
    or coalesce(answer ->> 'language', '') not in ('ja', 'en')
    or jsonb_typeof(answer -> 'live' -> 'byline') is distinct from 'string'
    or jsonb_typeof(answer -> 'sentences') is distinct from 'array'
    or answer -> 'sentences' = '[]'::jsonb
  then
    raise exception 'deliver_answer: not a live answered result for this question' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(answer -> 'sentences') s
    where jsonb_typeof(s -> 'text') is distinct from 'string'
      or length(btrim(s ->> 'text')) not between 1 and 1000
      or jsonb_typeof(s -> 'citations') is distinct from 'array'
      or s -> 'citations' = '[]'::jsonb
  ) then
    raise exception 'deliver_answer: every sentence has text and cites at least one note' using errcode = '22023';
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

  -- Each citation as checked above: the note's id and byline from the notes, the term its author's holding confirmed.
  stored := jsonb_build_object(
    'status', 'answered',
    'questionId', asked.id,
    'sentences', (
      select jsonb_agg(
        jsonb_build_object(
          'text', btrim(s.sentence ->> 'text'),
          'citations', (
            select jsonb_agg(
              jsonb_build_object('noteId', n.id, 'byline', n.byline, 'termLabel', c.citation ->> 'termLabel')
              order by c.position
            )
            from jsonb_array_elements(s.sentence -> 'citations') with ordinality as c (citation, position)
            join public.notes n on n.id = c.citation ->> 'noteId'
          )
        )
        order by s.position
      )
      from jsonb_array_elements(answer -> 'sentences') with ordinality as s (sentence, position)
    ),
    'language', answer ->> 'language',
    'live', jsonb_build_object('byline', answer -> 'live' ->> 'byline')
  );

  insert into public.answers (question_id, payload)
  values (asked.id, stored)
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

-- A trigger function needs no execute grant to fire; nobody calls it directly.
revoke all on function private.reject_contact_details() from public, anon, authenticated, service_role;
