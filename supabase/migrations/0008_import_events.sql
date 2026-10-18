-- 0008_import_events: what POST /api/import hid, refused and drafted, as counts in events (F5.5, docs/SPEC.md → adding
-- knowledge, step 6).
--   record_import()   one events row (kind 'import') per import or refused import, numbers only
-- /api/import never stores the text, the cards or the missing list (lib/engine/import.ts). It records how much the
-- browser hid, what the server's second pass hid again or found left over (phone numbers, emails, canaries: then the
-- request is refused), and how many cards, blocked cards and missing items came back, for the privacy numbers
-- (docs/SPEC.md → Numbers for the README). Signed-in users can't write events themselves (0006), so the route calls
-- this as the caller.
--
-- Only a holder of the seat records, as only a holder imports there; the seat isn't recorded. Nobody signed in reads
-- these rows: the one events policy (0006) selects kind 'withdraw', so Realtime doesn't send them either. The counts
-- are the caller's to give, so a holder could record made-up ones: they are a log of imports, and `pnpm test:redact`
-- (#38) measures its own numbers.

create function public.record_import(seat uuid, counts jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.holds_seat(seat) then
    raise exception 'record_import: not a holder of the seat' using errcode = '42501';
  end if;
  -- An object of the counts lib/engine/import.ts sends, by name, each a whole number from 0 to 100000: no room for text,
  -- not even in a key. One test per statement, since SQL doesn't promise the order an OR is evaluated in.
  if jsonb_typeof(counts) is distinct from 'object' then
    raise exception 'record_import: counts only' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_each(counts) as entry (key, value)
    where entry.key not in (
        -- the source: chat or file (neither is pasted text)
        'chat', 'file',
        -- what the browser hid (ImportRequest.redaction)
        'names', 'phones', 'emails', 'urls', 'ids', 'addresses', 'accounts', 'secrets', 'people',
        -- what the server's second pass hid again, or found left over (then the import was refused)
        'rehidden', 'rejected', 'phones_left', 'emails_left', 'canaries_left',
        -- what came back
        'cards', 'blocked', 'missing', 'dates_dropped', 'dates_fixed'
      )
      or case
        when jsonb_typeof(entry.value) = 'number'
          then entry.value::numeric <> trunc(entry.value::numeric)
            or entry.value::numeric not between 0 and 100000
        else true
      end
  ) then
    raise exception 'record_import: counts only' using errcode = '22023';
  end if;

  insert into public.events (kind, payload) values ('import', counts);
end;
$$;

-- Supabase grants every new function in public to anon, authenticated and service_role; only signed-in holders import.
revoke all on function public.record_import(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.record_import(uuid, jsonb) to authenticated;
