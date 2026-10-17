-- 0004_search_notes: retrieval for answers (F2), running as the asker.
-- search_notes is security invoker, so the notes policy decides what can be found; this function only narrows and
-- ranks. It leaves out withdrawn, expired (valid_until) and superseded notes, and notes without an embedding.
-- Asking needs a signed-in user, so only authenticated can call it. A null argument finds nothing (strict).
-- valid_until is a date on the Japanese calendar (fiscal years end 3/31), so "expired" uses Tokyo's date, not the
-- session's: Supabase sessions run in UTC, and PostgREST lets a caller pick another time zone.

-- A question at a seat searches that seat and, when the asker belongs to its institution (an institution-wide note
-- of the seat would reach them), every other seat there: 学祭実行委員会's note for the whole university reaches a
-- 軽音サークル member asking at Smash's seat. Anyone else searches only the seat itself.
-- The ranking is exact: ordering by similarity rather than by distance keeps the planner off the HNSW index, which
-- takes an approximate top 40 before RLS and these filters run, so it could miss notes. Fine at this size; with
-- thousands of notes, order by distance and set hnsw.iterative_scan instead.
-- The body is SQL-standard (begin atomic), so it is parsed once, here: callers need no access to the private
-- schema (a $$ body would be parsed as the caller and fail), and what it calls can't be dropped from under it.
create function public.search_notes(seat text, query_embedding extensions.vector, k integer)
returns table (
  id text,
  seat_id uuid,
  term_order integer,
  term_label text,
  byline text,
  kind text,
  title text,
  body text,
  deadline_date date,
  lang text,
  similarity double precision
)
language sql stable strict security invoker
set search_path = ''
begin atomic
  with asked as (
    select s.id, g.institution_id, private.can_read_note(s.id, null, 'institution', 'live', null) as belongs
    from public.seats s
    join public.groups g on g.id = s.group_id
    where s.slug = seat
  )
  select
    n.id, n.seat_id, n.term_order,
    -- the term as the lineage writes it (「2025秋」), or its number if no holder of that term is left
    coalesce(
      (select l.term_label from public.seat_lineage(n.seat_id) l where l.term_order = n.term_order limit 1),
      n.term_order::text
    ),
    n.byline, n.kind, n.title, n.body, n.deadline_date, n.lang,
    1 - (n.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.notes n
  join public.seats ns on ns.id = n.seat_id
  join public.groups ng on ng.id = ns.group_id
  join asked a on n.seat_id = a.id or (a.belongs and ng.institution_id = a.institution_id)
  where n.status = 'live'
    and n.superseded_by is null
    and (n.valid_until is null or n.valid_until >= (now() at time zone 'Asia/Tokyo')::date)
    and n.embedding is not null
  order by similarity desc
  limit k;
end;

-- Supabase grants every new function in public to anon, authenticated and service_role; keep it to askers.
revoke all on function public.search_notes(text, extensions.vector, integer)
from public, anon, authenticated, service_role;
grant execute on function public.search_notes(text, extensions.vector, integer) to authenticated;
