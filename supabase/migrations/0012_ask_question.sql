-- 0012_ask_question: a newcomer's question is saved and routed in one transaction (F3.5 follow-up, issue #69,
-- docs/SPEC.md → F3 and Scope rules).
--   open_demand_prompts_at()   the seat's open, listed demand prompts, for a holder about to ask there
--   ask_question()             the asker saves a question nobody could answer and routes it, all or nothing
--   route_question()           no longer starts or joins a prompt that would reach nobody but its asker
-- POST /api/ask used to save the waiting question and route it in separate requests (an insert, then
-- open_demand_prompts(), route_question() and list_prompt()), so a routing that failed left the question behind,
-- unrouted, and asking again saved it twice. It now calls ask_question() once: when anything fails, nothing is saved.
-- A question that would reach nobody but its asker (a25 asking, as the seat's only reachable holder) is saved and
-- routed nowhere, like one from someone who holds no seat there, instead of starting a prompt nobody can read.
-- Dedupe (F2.5, lib/engine/dedupe.ts) reads the seat's open prompts before the question is saved, so
-- open_demand_prompts_at() takes the seat instead of a waiting question of the caller's. A holder reads nothing new by
-- it: 0003's insert policy already lets any holder save a waiting question of their own and pass it to
-- open_demand_prompts() (0007).
-- route_question(), open_demand_prompts() and list_prompt() stay until the code on main calls ask_question(); a later
-- migration drops them.

-- As a holder of the seat, before asking there: the seat's open demand prompts in Haiku's wording (listed, 0007), at
-- most 20, the newest first, id and text only, for Haiku to compare the new question with. Who asked, when and how often
-- never leave the database. Anyone who holds no seat at the seat gets no rows: their question routes nowhere, so it has
-- nothing to join.
create function public.open_demand_prompts_at(seat uuid)
returns table (id uuid, text text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.text
  from public.prompts p
  left join public.questions first_asked on first_asked.id = p.source_question_id
  where private.holds_seat(seat)
    and p.seat_id = seat
    and p.kind = 'demand'
    and not p.retired
    and p.listed
  order by first_asked.created_at desc nulls last, p.id
  limit 20;
$$;

-- After an abstain, as the asker: saves the question and, in the same transaction, makes it a demand prompt of the seat
-- (a new one, or an open one that asks the same thing, F2.5) that reaches the seat's reachable holders other than the
-- asker. The question is saved and routed nowhere (prompt_id null, routed_to 0) when the asker holds no seat there,
-- when nobody but the asker could receive it, or when no prompt text passed the guard (lib/engine/dedupe.ts). Only a
-- prompt open_demand_prompts_at() could have offered is joined: for any other id, made up or not, the question starts
-- a prompt from prompt_text instead, so the reply never tells whether that prompt exists.
create function public.ask_question(
  seat uuid,
  question text, -- as typed; only the asker reads it
  lang text, -- questions.lang (lib/engine/lang.ts)
  prompt_text text default null, -- the question as a prompt about the seat; its recipients read it
  join_prompt uuid default null, -- or an open, listed demand prompt of the seat that asks the same thing
  listed boolean default false, -- prompt_text is Haiku's wording: offer a prompt it starts to the seat's later askers
  out question_id uuid,
  out prompt_id uuid,
  out routed_to integer
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  asker uuid := auth.uid();
  asked uuid;
  recipients uuid[];
  prompt uuid;
begin
  -- Before anything is written, and the same for every caller. A row a table constraint refuses would be quoted, the
  -- question with it, in the error and the database log, so every column is checked here first.
  if asker is null then
    raise exception 'ask_question: sign in to ask' using errcode = '42501';
  end if;
  if seat is null or listed is null or coalesce(lang, '') not in ('ja', 'en') then
    raise exception 'ask_question: seat, lang (ja or en) and listed must be given' using errcode = '22023';
  end if;
  if length(btrim(coalesce(question, ''))) not between 1 and 500 then
    raise exception 'ask_question: question must be 1 to 500 characters' using errcode = '22023';
  end if;
  if prompt_text is not null and length(btrim(prompt_text)) not between 1 and 500 then
    raise exception 'ask_question: prompt_text must be 1 to 500 characters' using errcode = '22023';
  end if;

  insert into public.questions (asker_user_id, seat_id, text, lang, status)
  values (asker, seat, question, ask_question.lang, 'waiting')
  returning id into asked;
  question_id := asked;
  routed_to := 0;

  -- Only a holder of the seat routes, and never to themselves: read the recipients once, for the check and the routes.
  if not exists (select 1 from public.seat_holders h where h.user_id = asker and h.seat_id = seat) then
    return;
  end if;
  select array_agg(distinct h.user_id) into recipients
  from public.seat_holders h
  where h.seat_id = seat and h.reachable and h.user_id <> asker;
  if recipients is null then
    return;
  end if;

  -- The update locks the prompt, as deliver_answer() (0003) does before retiring it: a prompt retired meanwhile isn't
  -- joined, and one joined here isn't retired while this question waits on it.
  if join_prompt is not null then
    update public.prompts p
    set ask_count = p.ask_count + 1
    where p.id = join_prompt and p.seat_id = seat and p.kind = 'demand' and not p.retired and p.listed
    returning p.id into prompt;
  end if;
  if prompt is null then
    if prompt_text is null then
      return;
    end if;
    insert into public.prompts (seat_id, kind, text, ask_count, source_question_id, listed)
    values (seat, 'demand', btrim(prompt_text), 1, asked, ask_question.listed)
    returning id into prompt;
  end if;

  update public.questions q set prompt_id = prompt where q.id = asked;

  insert into public.prompt_routes (prompt_id, user_id)
  select prompt, recipient from unnest(recipients) as recipient
  on conflict do nothing;

  select count(*)::integer into routed_to
  from public.prompt_routes r
  where r.prompt_id = prompt and r.user_id <> asker;
  prompt_id := prompt;
end;
$$;

-- route_question() (0003) for the code that still calls it, with ask_question()'s two rules: a question that would
-- reach nobody but its asker starts and joins no prompt, and only a listed prompt is joined (an unlisted one is refused
-- like a made-up id, so the refusal no longer tells that it exists). Otherwise unchanged; replacing it keeps its grants.
create or replace function public.route_question(
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
  ) or not exists (
    select 1 from public.seat_holders h
    where h.seat_id = asked.seat_id and h.reachable and h.user_id <> asked.asker_user_id
  ) then
    routed_to := 0;
    return;
  end if;

  if join_prompt is not null then
    update public.prompts p
    set ask_count = p.ask_count + 1
    where p.id = join_prompt and p.seat_id = asked.seat_id and p.kind = 'demand' and not p.retired and p.listed
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

-- Supabase grants every new function in public to anon, authenticated and service_role; only signed-in askers call these.
revoke all on function
  public.open_demand_prompts_at(uuid),
  public.ask_question(uuid, text, text, text, uuid, boolean)
from public, anon, authenticated, service_role;
grant execute on function
  public.open_demand_prompts_at(uuid),
  public.ask_question(uuid, text, text, text, uuid, boolean)
to authenticated;
