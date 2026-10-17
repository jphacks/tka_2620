-- 0005_realtime: the live loop's rows reach the browser by Realtime (docs/SPEC.md → Realtime), so nothing polls.
-- Realtime checks each row against its table's select policy (0003) as each subscriber, so a row reaches only the
-- people allowed to read it:
--   prompt_routes   its recipient: a newcomer's question just reached them (F3.6). The row holds ids and seen_at only;
--                   the inbox is fetched again for the text.
--   answers         its asker: the signed answer from the live loop, or a new one after a cited note was withdrawn.
-- The default replica identity is enough: an insert or update carries the whole new row, and nobody needs the old one.

alter publication supabase_realtime add table public.prompt_routes, public.answers;
