-- 0010_supersede: 「更新する」 (F5.6, docs/SPEC.md → F5 step 9). A new note replaces a live note of the same seat and
-- kind, such as 2026's 学生課 notice moving the 保健所 deadline the 2025 note gives.
--   notes.supersedes          insert-only: the note a new note replaces. The trigger below turns it into the old note's
--                             superseded_by and never stores it, so no reader of the new note (Realtime included)
--                             learns which note it replaced, or that one they can't read exists
--   supersede_on_insert()     checks the old note and sets its superseded_by, inside the insert
--   superseded_deadlines()    the deadline notes some notes replaced, for the rule-change flag (lib/engine/rule-change.ts)
--   on_note_withdrawn()       withdrawing an update brings back the note it replaced; withdrawing a replaced note takes
--                             its date out of the rule-change flags that read it
-- POST /api/handover/publish inserts as the publisher (0003) with supersedes on a 「更新する」 card. A superseded note
-- leaves answers (search_notes 0004, waiting_questions and deliver_answer 0003 skip it) but stays readable within its
-- scope as history: a saved answer's stamp still opens it, and the rule-change flag still counts its date.
-- The old note's readers can see that it was replaced, and by which id (superseded_by, as since 0001), but not the new
-- note unless its scope lets them: an update is never narrower in scope, so that is only a successor note's earlier
-- holders (knowledge passes forward), and the id opens nothing for them.

-- The new note's id comes from its column default, so the trigger writes it into the old note before the new row
-- exists; the foreign key waits for the end of the transaction. A refused card rolls back the whole insert, the old
-- notes' updates included, so a refused publish saves nothing (lib/engine/publish.ts).
alter table public.notes add column supersedes text;
alter table public.notes add constraint notes_supersedes_never_stored check (supersedes is null);
alter table public.notes alter constraint notes_superseded_by_fkey deferrable initially deferred;

grant insert (supersedes) on public.notes to authenticated;

-- As the publisher, for each new note with supersedes: the old note must be a live note, not yet replaced, of the same
-- seat and kind, from the same term or an earlier one, that the publisher may read, and the publisher must be the new
-- note's author (the insert policy checks the rest: their own term, signed with it). The new note's scope is at least
-- as wide as the old one's (successor < group < institution < public), so an update never takes a note out of the
-- answers of people who couldn't read what replaced it: a group note isn't replaced by a note for the treasurers only.
-- Security definer because the old note is someone else's and notes has no update grant (0006). One refusal for every
-- case, so it never tells whether a note the caller can't read exists. The lock makes two updates of one note wait for
-- each other; the second finds it replaced and is refused.
create function private.supersede_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  replaced text;
begin
  select n.id into replaced
  from public.notes n
  where n.id = new.supersedes
    and n.id <> new.id
    and n.seat_id = new.seat_id
    and n.kind = new.kind
    and n.status = 'live'
    and n.superseded_by is null
    and n.term_order <= new.term_order
    and array_position(array['successor', 'group', 'institution', 'public'], new.scope)
      >= array_position(array['successor', 'group', 'institution', 'public'], n.scope)
    and new.author_user_id = auth.uid()
    and private.can_read_note(n.seat_id, n.term_order, n.scope, n.status, n.author_user_id)
  for update of n;
  if not found then
    raise exception 'supersede: not a live note of this seat and kind that you may update' using errcode = '42501';
  end if;

  update public.notes n set superseded_by = new.id where n.id = replaced;
  new.supersedes := null;
  return new;
end;
$$;

create trigger notes_supersede
before insert on public.notes
for each row when (new.supersedes is not null)
execute function private.supersede_on_insert();

-- Only the trigger calls it; a trigger function runs without its caller's execute privilege.
revoke all on function private.supersede_on_insert() from public, anon, authenticated, service_role;

-- As the asker, after search_notes: the live deadline notes that some of the found notes replaced, with their term as
-- the lineage writes it (as search_notes does). Security invoker, so the notes policy decides here too: an asker who
-- may not read the old note gets no row, and no flag from its date. A note past its valid_until counts no more than in
-- search_notes (Tokyo's date, as there). Ids, terms and dates only, never a title or body.
create function public.superseded_deadlines(note_ids text[])
returns table (
  id text,
  seat_id uuid,
  term_order integer,
  term_label text,
  deadline_date date,
  superseded_by text
)
language sql stable strict security invoker
set search_path = ''
begin atomic
  select
    n.id, n.seat_id, n.term_order,
    coalesce(
      (select l.term_label from public.seat_lineage(n.seat_id) l where l.term_order = n.term_order limit 1),
      n.term_order::text
    ),
    n.deadline_date, n.superseded_by
  from public.notes n
  where n.superseded_by = any (note_ids)
    and n.status = 'live'
    and n.kind = 'deadline'
    and n.deadline_date is not null
    and (n.valid_until is null or n.valid_until >= (now() at time zone 'Asia/Tokyo')::date)
  order by n.term_order, n.id;
end;

-- Supabase grants every new function in public to anon, authenticated and service_role; keep it to askers.
revoke all on function public.superseded_deadlines(text[]) from public, anon, authenticated, service_role;
grant execute on function public.superseded_deadlines(text[]) to authenticated;

-- Withdrawing (withdraw_note(), 0006) ------------------------------------------------

-- When a note is withdrawn, inside withdraw_note()'s transaction (it holds the withdrawals' lock):
--   - an update taken back: the note it replaced is current again and comes back to answers, so withdrawing the 2026
--     notice never loses the 2025 deadline for everyone;
--   - a replaced note taken back: no saved flag keeps its date. A saved answer cites the note that replaced it, not
--     the note itself, so withdraw_note() doesn't rewrite it; here each answer citing the replacement loses its
--     ruleChange (computed from history the database no longer has; better none than one from a withdrawn note), and
--     0006's trigger then checks the rest as for any write.
-- Notes that aren't updates and weren't replaced (all but a few) touch nothing here beyond one index lookup.
create function private.on_note_withdrawn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notes n set superseded_by = null where n.superseded_by = new.id;
  if new.superseded_by is not null then
    update public.answers a
    set payload = a.payload - 'ruleChange'
    where a.payload ? 'ruleChange'
      and jsonb_path_exists(
        a.payload,
        'lax $.sentences[*].citations[*] ? (@.noteId == $id)',
        jsonb_build_object('id', new.superseded_by),
        true
      );
  end if;
  return null;
end;
$$;

create trigger notes_on_withdrawn
after update of status on public.notes
for each row when (old.status = 'live' and new.status = 'withdrawn')
execute function private.on_note_withdrawn();

revoke all on function private.on_note_withdrawn() from public, anon, authenticated, service_role;
