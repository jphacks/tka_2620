-- 0008_dedupe: a newcomer's question joins an open demand prompt that asks the same thing (F2.5, docs/SPEC.md → F2).
--   prompts.listed          the prompt's text is Haiku's wording of its question, so the seat's later askers may see it
--   list_prompt()           the asker lists the prompt their own question started
--   open_demand_prompts()   the seat's open, listed demand prompts, for the asker's own question that waits to be routed
-- POST /api/ask runs as the asker. After an abstain it gives the new question and these prompts to Haiku
-- (lib/engine/dedupe.ts), which picks the one that asks the same thing; route_question() (0003) then joins it, so the
-- predecessor gets one slip with ask_count 2 instead of two slips.
--
-- An exception to 0003's prompts rule (a demand prompt only where routed): a holder of the seat reads the text of the
-- seat's open, listed demand prompts through open_demand_prompts(), for a question of their own that is waiting to be
-- routed (docs/SPEC.md → Scope rules). Who asked, when and how often never leave the database.
-- Listed means worded about the seat by Haiku from the question alone and passed by the guard (no contact details,
-- credential or name). A prompt as the newcomer typed it (Haiku down, or every prompt from before 0008) stays unlisted:
-- only its routed predecessors read it. Only the asker lists, and only the prompt their own question started, so nobody
-- can show anyone else's words to the seat.

alter table public.prompts add column listed boolean not null default false;

-- After route_question() started a prompt from the caller's question with Haiku's wording.
create function public.list_prompt(question uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  update public.prompts p
  set listed = true
  from public.questions q
  where q.id = question
    and q.asker_user_id = auth.uid()
    and p.id = q.prompt_id
    and p.source_question_id = q.id
    and p.kind = 'demand';
  if not found then
    raise exception 'list_prompt: no prompt started by a question of yours' using errcode = '42501';
  end if;
end;
$$;

-- Its own question only, so the caller can't page through other seats; at most 20 prompts, the newest first. Anyone
-- who holds no seat at the seat gets no rows: their question routes nowhere (0003), so it has nothing to join.
create function public.open_demand_prompts(question uuid)
returns table (id uuid, text text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  asked public.questions%rowtype;
begin
  select q.* into asked
  from public.questions q
  where q.id = question and q.asker_user_id = auth.uid() and q.status = 'waiting' and q.prompt_id is null;
  if not found then
    raise exception 'open_demand_prompts: not a waiting, unrouted question of yours' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.seat_holders h where h.user_id = asked.asker_user_id and h.seat_id = asked.seat_id
  ) then
    return;
  end if;

  return query
  select p.id, p.text
  from public.prompts p
  left join public.questions first_asked on first_asked.id = p.source_question_id
  where p.seat_id = asked.seat_id and p.kind = 'demand' and not p.retired and p.listed
  order by first_asked.created_at desc nulls last, p.id
  limit 20;
end;
$$;

-- Supabase grants every new function in public to anon, authenticated and service_role; only signed-in askers call them.
revoke all on function public.list_prompt(uuid), public.open_demand_prompts(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.list_prompt(uuid), public.open_demand_prompts(uuid) to authenticated;
