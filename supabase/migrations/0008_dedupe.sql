-- 0008_dedupe: a newcomer's question joins an open demand prompt that asks the same thing (F2.5, docs/SPEC.md → F2).
--   open_demand_prompts()   the seat's open demand prompts, for the asker's own question that waits to be routed
-- POST /api/ask runs as the asker. After an abstain it gives the new question and these prompts to Haiku
-- (lib/engine/dedupe.ts), which picks the one that asks the same thing; route_question() (0003) then joins it, so the
-- predecessor gets one slip with ask_count 2 instead of two slips.
--
-- An exception to 0003's prompts rule (a demand prompt only where routed): a holder of the seat reads the text of the
-- seat's open demand prompts through this function, for a question of their own that is waiting to be routed. The text
-- is a question about the seat, worded by Haiku without names or contact details (docs/SPEC.md → Scope rules). Who
-- asked, when and how often never leave the database. Anyone who holds no seat at the seat gets no rows: their question
-- routes nowhere (0003), so it has nothing to join.
-- Its own question only, so the caller can't page through other seats; at most 20 prompts, the newest first.
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
  where p.seat_id = asked.seat_id and p.kind = 'demand' and not p.retired
  order by first_asked.created_at desc nulls last, p.id
  limit 20;
end;
$$;

-- Supabase grants every new function in public to anon, authenticated and service_role; only signed-in askers call it.
revoke all on function public.open_demand_prompts(uuid) from public, anon, authenticated, service_role;
grant execute on function public.open_demand_prompts(uuid) to authenticated;
