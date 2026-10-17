-- 0002_notes_rls: who can read a note (docs/SPEC.md → "Scope rules"), enforced in the database.
-- The four rings, each holding the one inside it, so widening a note's scope never hides it from anyone:
--   successor    the author, plus holders of the same seat with a later term
--   group        every member (current or alumni) of the seat's group, plus every holder of the seat
--   institution  every member of any group at the seat's institution, plus the group ring
--   public       everyone, signed out too
-- A withdrawn note is readable only by its author (自分のメモ); search (F1.3) leaves it out for everyone.
-- Reads only: publishing (F1.2) and withdrawing (F4) add their own policies.

-- Ring checks ------------------------------------------------------------------

-- They read seat_holders, group_members, seats and groups: other people's memberships, which readers can't read
-- themselves. So each check is a security definer function that answers only for the signed-in user (auth.uid()
-- inside, never a user id argument), in a schema the API doesn't expose; only the policy below calls them.
create schema private;

create function private.holds_later_term(note_seat uuid, note_term integer)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.seat_holders h
    where h.user_id = auth.uid() and h.seat_id = note_seat and h.term_order > note_term
  );
$$;

create function private.in_group_ring(note_seat uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.seat_holders h
    where h.user_id = auth.uid() and h.seat_id = note_seat
  ) or exists (
    select 1 from public.seats s
    join public.group_members m on m.group_id = s.group_id
    where s.id = note_seat and m.user_id = auth.uid()
  );
$$;

create function private.in_institution_ring(note_seat uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.in_group_ring(note_seat) or exists (
    select 1 from public.seats s
    join public.groups g on g.id = s.group_id
    join public.groups peer on peer.institution_id = g.institution_id
    join public.group_members m on m.group_id = peer.id
    where s.id = note_seat and m.user_id = auth.uid()
  );
$$;

-- New functions are executable by PUBLIC; keep these to the roles the policy runs as.
revoke all on function
  private.holds_later_term(uuid, integer), private.in_group_ring(uuid), private.in_institution_ring(uuid)
from public;
grant execute on function
  private.holds_later_term(uuid, integer), private.in_group_ring(uuid), private.in_institution_ring(uuid)
to anon, authenticated;

-- Notes ------------------------------------------------------------------------

create policy "notes: readable within their scope ring"
on public.notes
for select
to anon, authenticated
using (
  author_user_id = (select auth.uid())
  or (
    status = 'live'
    and case scope
      when 'successor' then private.holds_later_term(seat_id, term_order)
      when 'group' then private.in_group_ring(seat_id)
      when 'institution' then private.in_institution_ring(seat_id)
      when 'public' then true
      else false
    end
  )
);
