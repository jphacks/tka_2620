-- 0007_publish_hardening: what a published note and a live answer may say is the database's decision, not the
-- client's (the F3.8 leak audit). POST /api/handover/publish already does all of this; these hold for anyone writing
-- through PostgREST with their own token too.
--   seat_holders.byline   the byline a holder signs with for that term (「2025年度 会計」), written by scripts/seed.ts
--                         from the label pack; may_sign() now wants exactly it, so nobody signs 「2025年度 部長」
--   notes guard           a note whose title, body or provenance holds contact details or credentials is refused, with
--                         the patterns of lib/engine/guard.ts (emails, @handles, phone numbers, a value next to 電話,
--                         TEL or LINE ID, or next to 暗証番号 or パスワード); names stay with the route, which knows the
--                         roles that aren't names
--   deliver_answer()      stores the answer rebuilt from known parts, anything else the caller sends dropped, and
--                         refuses a sentence with contact details or credentials
-- Apply after 0006 (its answers trigger is what keeps a withdrawal from slipping past deliver_answer's checks). Then
-- run `pnpm seed` (demo:reset) so every holder has a byline: until then may_sign() refuses everyone.

-- Bylines -------------------------------------------------------------------------------

-- The wording stays in the label packs (messages/*.json → seatTypes.*.byline): the seed fills it in for each holder's
-- term, as it does for the seed notes, and whatever creates a holder later must do the same. Never blank: a blank
-- byline would sign blank notes.
alter table public.seat_holders add column byline text check (btrim(byline) <> '');

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

-- lib/engine/guard.ts nearValue(): a token of four or more letters, digits or symbols with a digit in it, within 12
-- characters of the keyword, that isn't an amount, a year or a count (4821, smash2025, 1234-5678; not 10000円, 2026年).
-- More than 20 of the keyword is no seat knowledge either; it also bounds the work, since each regexp_instr() below
-- scans from the start.
create function private.near_value(plain text, keyword text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when regexp_count(plain, keyword, 1, 'i') > 20 then true else exists (
    select 1
    from generate_series(1, regexp_count(plain, keyword, 1, 'i')) as k (n)
    cross join lateral (
      select greatest(1, regexp_instr(plain, keyword, 1, k.n, 0, 'i') - 12) as head,
        regexp_instr(plain, keyword, 1, k.n, 1, 'i') + 12 as tail
    ) near
    cross join lateral regexp_matches(
      substr(plain, near.head, near.tail - near.head),
      '(?<![A-Za-z0-9_!#$%&*+.-])[A-Za-z0-9_!#$%&*+.-]{4,}(?![A-Za-z0-9_!#$%&*+.-]|[年円月日人時分件%])',
      'g'
    ) as token
    where token[1] ~ '[0-9]'
  ) end;
$$;

-- What lib/engine/guard.ts blockReason() refuses as contact details or credentials, pattern for pattern: change the
-- two together. NFKC turns full-width letters, digits and symbols into ASCII (０９０, ＠, ．), invisible characters
-- (zero-width spaces, soft hyphens) go, and kanji digits become digits. Word characters are spelled out in ASCII, as
-- JS's \w has them: [[:alnum:]] matches 時 and 部 here (ICU), and would refuse 「18時@部室に集合」, which the route lets
-- through. Then, in order:
--   - an email, or an @handle with a letter in it (＠500円 is a unit price);
--   - a phone number as written, even right after another number (受付 9:00-17:00 03-1234-5678), or as bare digits;
--   - a phone number once up to three separators between digits are gone, but not a time's colon (〇九〇の一二三四…);
--   - a value next to 電話, TEL, 携帯, FAX or LINE ID, or next to a credential word.
create function private.holds_contact_or_secret(shown text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select plain ~ '[A-Za-z0-9_.+-][[:space:]]?@[[:space:]]?[A-Za-z0-9_-]'
    or plain ~ '(?<![A-Za-z0-9_.])@(?=[A-Za-z0-9_.]*[A-Za-z_])[A-Za-z0-9_.]{2,}'
    or plain ~ '(?<![0-9])(0[0-9]{1,4}|\+81[- ().・のー‐‑‒–—―−]{0,3}[0-9]{1,4})[- ().・のー‐‑‒–—―−]{1,3}[0-9]{1,4}[- ().・のー‐‑‒–—―−]{1,3}[0-9]{3,4}(?![0-9])'
    or plain ~ '(?<![0-9])(\+?810?[0-9]{9,10}|0[0-9]{9,10})(?![0-9])'
    or regexp_replace(plain, '([0-9])(?:[^[:alnum:]:]|[のー]){1,3}(?=[0-9])', '\1', 'g')
      ~ '(?<![0-9])(\+?810?[0-9]{9,10}|0[0-9]{9,10})(?![0-9])'
    or private.near_value(
      plain,
      '電話|(?<![A-Za-z0-9_])TEL(?![A-Za-z0-9_])|携帯|(?<![A-Za-z0-9_])FAX(?![A-Za-z0-9_])|LINE[[:space:]]?ID'
    )
    or private.near_value(
      plain,
      '暗証番号|口座番号|カード番号|パスワード|password|passcode|(?<![A-Za-z0-9_])PIN(?![A-Za-z0-9_])|ログインID'
    )
  from (
    select translate(
      regexp_replace(normalize(shown, nfkc), '[\u00AD\u200B-\u200F\u2060-\u2064\uFEFF]', '', 'g'),
      '〇一二三四五六七八九',
      '0123456789'
    ) as plain
  ) as normalized;
$$;

-- On every insert, and every edit of the text a reader sees, whoever writes (the service role too). Security definer
-- only to reach the function above, which no API role may call; it reads no table. DD001 lets the route answer
-- unredacted. The text is at most what a published card may hold (title 100, body 2000, provenance 80 characters):
-- this trigger runs before RLS, so anyone signed in reaches it, and the guard's work grows with the text.
create function private.reject_contact_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  shown text := concat_ws(E'\n', new.title, new.body, new.provenance);
begin
  if length(shown) > 2200 then
    raise exception 'notes: a note is at most 2200 characters' using errcode = '22001';
  end if;
  if private.holds_contact_or_secret(shown) then
    raise exception 'notes: a note holds no contact details or credentials' using errcode = 'DD001';
  end if;
  return new;
end;
$$;

create trigger notes_no_contact_details
before insert or update of title, body, provenance on public.notes
for each row execute function private.reject_contact_details();

-- Delivering a live answer --------------------------------------------------------------

-- As 0003's, with more checks (the language, at most 40 sentences as 0006 keeps, and every sentence's text: there,
-- and without contact details or credentials, as the notes guard has it), and the answer stored from known parts
-- only: each sentence's text with its citations as the notes have them, the language and live.byline. Anything else
-- the caller sends is dropped, a rule-change flag included: a live answer cites one term's notes, so it never has
-- one, and the flag is never the caller's to set. The sentence text is still the caller's; the route writes it from
-- the notes, and only the asker the question was routed to reads it. 0006's answers trigger locks the cited notes as
-- the row is written, so a note withdrawn after the checks below still leaves the answer.
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
    or jsonb_array_length(answer -> 'sentences') > 40
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
  -- All sentences at once, a line each as the asker sees them, so a number split across two is found too.
  if private.holds_contact_or_secret((
    select string_agg(s.sentence ->> 'text', E'\n' order by s.position)
    from jsonb_array_elements(answer -> 'sentences') with ordinality as s (sentence, position)
  )) then
    raise exception 'deliver_answer: an answer holds no contact details or credentials' using errcode = 'DD001';
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

-- Only the trigger and deliver_answer() use them; a trigger function needs no execute grant to fire.
revoke all on function
  private.near_value(text, text), private.holds_contact_or_secret(text), private.reject_contact_details()
from public, anon, authenticated, service_role;
