-- 0011_handover_prompts: the handover prompts in a fixed order, the prompt a note answered, and how many people a scope
-- reaches (F6.1, docs/SPEC.md → F6: GET /api/handover/prompts and GET /api/handover/readers).
--   prompts.seq       the order prompts were added in: a seat type's core prompts as seed/core-prompts.csv lists them
--                     (scripts/seed.ts inserts them in that order), gap prompts as 「先輩に聞く」 added them
--   notes.prompt_id   the handover prompt (gap, required or core) a note answered
--   scope_readers()   how many people besides the caller could read a note the caller publishes at the seat with a scope
--
-- lib/engine/prompts.ts ranks a holder's prompts demand → gap → required → core, and by seq within a kind. Rows that exist
-- before this migration are numbered in their physical order, which is still the order they were inserted in.

alter table public.prompts add column seq bigint generated always as identity;

-- POST /api/handover/publish sets it for a gap, required or core prompt the publisher read as themselves
-- (lib/engine/publish.ts); a newcomer's question (demand) is retired once answered instead (deliver_answer, 0003). The
-- handover doesn't ask a holder that prompt again while such a note of the seat, from their term or later, is live and
-- readable to them; withdrawing the note brings the prompt back. The notes policy decides who sees the link, as for the
-- rest of the row (Realtime sends readers the whole row, 0006): an id, never the prompt's text.
alter table public.notes add column prompt_id uuid references public.prompts (id) on delete set null;
create index notes_prompt_id_idx on public.notes (prompt_id);

grant insert (prompt_id) on public.notes to authenticated;

-- The scope picker's 「{n}人が読めます」. The rings are other people's memberships, which nobody reads directly (0003: your
-- own rows only), so a security definer function counts them, and answers with a number, never who. It counts with the
-- notes policy's own check (can_read_note_as, 0003) for a live note signed with the caller's latest term at the seat,
-- the term a publish signs with (lib/engine/publish.ts), so the number is what the policy lets through:
--   successor    the seat's holders of later terms
--   group        the members of the seat's group and the seat's holders
--   institution  the members of any group at the seat's institution and the seat's holders
--   public       every member of any group and every holder of any seat (anyone signed out reads it too, which no
--                count holds)
-- Only members and holders are counted, so an account that belongs nowhere (a stray sign-up) changes no number. Only a
-- holder of the seat asks, as only a holder publishes there. It shows headcounts, and a holder who asks again sees
-- people join; never who they are. Each person is checked one by one: fine at this size; with thousands of members,
-- count each ring's members instead.
create function public.scope_readers(seat uuid, note_scope text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  term integer;
begin
  select max(h.term_order) into term
  from public.seat_holders h
  where h.user_id = auth.uid() and h.seat_id = seat;
  if term is null then
    raise exception 'scope_readers: not a holder of the seat' using errcode = '42501';
  end if;
  if note_scope is null or note_scope not in ('successor', 'group', 'institution', 'public') then
    raise exception 'scope_readers: note_scope must be successor, group, institution or public' using errcode = '22023';
  end if;

  return (
    select count(*)::integer
    from (
      select h.user_id from public.seat_holders h
      union
      select m.user_id from public.group_members m
    ) people
    where people.user_id <> auth.uid()
      and private.can_read_note_as(people.user_id, seat, term, note_scope, 'live', auth.uid())
  );
end;
$$;

-- Supabase grants every new function in public to anon, authenticated and service_role; only signed-in holders count.
revoke all on function public.scope_readers(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.scope_readers(uuid, text) to authenticated;
