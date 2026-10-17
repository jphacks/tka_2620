-- 0005_realtime: the live loop's rows reach the browser by Realtime (docs/SPEC.md → Realtime), so nothing polls.
-- Realtime checks an inserted or updated row against its table's select policy (0003) as each subscriber, so the row
-- reaches only the people allowed to read it:
--   prompt_routes   its recipient: a newcomer's question just reached them (F3.6). The row holds ids and seen_at only;
--                   the inbox is fetched again for the text.
--   answers         its asker: the signed answer from the live loop (F3.8), and later a new one after a cited note is
--                   withdrawn (F4).
-- A deleted row can't be checked against a policy, so Realtime would send its primary key to every subscriber: for
-- prompt_routes, who received which prompt (Supabase docs: "RLS policies are not applied to DELETE statements").
-- Nothing in the live loop needs deletes (a prompt is retired, a note withdrawn, both updates), so the publication sends
-- inserts and updates only. The setting belongs to the publication, so it also holds for tables published later.
-- anon keeps Supabase's default select grant on purpose. No policy lets it read a row, so Realtime's policy check drops
-- every change for a signed-out client; a role without the grant would instead get an "Error 401: Unauthorized" event
-- for each change (realtime.apply_rls), which tells it that something happened.
-- The default replica identity is enough: an insert or update carries the whole new row, and nobody needs the old one.

alter publication supabase_realtime add table public.prompt_routes, public.answers;
alter publication supabase_realtime set (publish = 'insert, update');
