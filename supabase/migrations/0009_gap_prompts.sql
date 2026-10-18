-- 0009_gap_prompts: 「先輩に聞く」 on the import review turns a missing item into a gap prompt of the seat (F5.7,
-- docs/SPEC.md → adding knowledge, "Any time, not only at the start").
--   add_gap_prompt()   a holder of the seat adds a gap prompt, or gets back the open one with the same text
-- What an added text leaves out (a missing item's prompt, lib/engine/extract-notes.ts) becomes a handover prompt for the
-- seat's holders, the predecessors who know the answer among them (F6 ranks it after demand prompts). 0003 lets only
-- functions write prompts, so POST /api/handover/prompts (lib/engine/gap.ts) calls this as the caller.
--
-- Gap prompts are read by every holder of the seat, in any term, like core prompts: 0003's prompts policy keeps only
-- demand prompts to the holders they were routed to. So only a holder of the seat adds one, as only a holder imports
-- there, and the route refuses a text with a name, contact details, a secret, a placeholder or a canary (unredacted)
-- before it calls this; here the text is only trimmed and held to GapRequest's 1 to 500 characters. The same open text
-- again (the same doc imported twice, or a double tap) is the same prompt: its id comes back and nothing is inserted.
-- Only gap prompts are compared, so the answer never says whether a demand prompt (a newcomer's question) has that
-- text. A gap prompt keeps listed's default (0007): listing is for demand prompts.

create function public.add_gap_prompt(seat uuid, prompt_text text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  wording text := btrim(coalesce(prompt_text, ''));
  prompt uuid;
begin
  if not private.holds_seat(seat) then
    raise exception 'add_gap_prompt: not a holder of the seat' using errcode = '42501';
  end if;
  if length(wording) not between 1 and 500 then
    raise exception 'add_gap_prompt: prompt_text must be 1 to 500 characters' using errcode = '22023';
  end if;

  -- One add at a time per seat (a transaction advisory lock; two keys, so never withdraw_note's one-key lock), so two
  -- taps at once can't both miss the open prompt and insert it twice.
  perform pg_advisory_xact_lock(hashtext('public.add_gap_prompt'), hashtext(seat::text));
  select p.id into prompt
  from public.prompts p
  where p.seat_id = seat and p.kind = 'gap' and not p.retired and p.text = wording
  limit 1;
  if prompt is null then
    insert into public.prompts (seat_id, kind, text)
    values (seat, 'gap', wording)
    returning id into prompt;
  end if;
  return prompt;
end;
$$;

-- Supabase grants every new function in public to anon, authenticated and service_role; only signed-in holders add.
revoke all on function public.add_gap_prompt(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.add_gap_prompt(uuid, text) to authenticated;
