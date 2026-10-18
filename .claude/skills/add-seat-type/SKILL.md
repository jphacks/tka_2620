---
name: add-seat-type
description: Add support for a new kind of group (e.g. PTA role, company team, dorm duty) without adding screens. Use when someone asks to support a new seat type.
argument-hint: "[seat_type] [one-line description]"
---

Add the seat type `$0` ($1) to Daidai, keeping one interface for everyone.

1. Add `$0` to the `seat_type` check constraint in a new migration, and to `SeatType` in `lib/contracts.ts`
   (shared file: PR plus one line in Slack; `pnpm test` checks it matches the label packs).
2. Add a label pack under `seatTypes.$0` in BOTH `messages/ja.json` and `messages/en.json`, with the same
   keys as `club_role`: `seat`, `term`, `byline`, `lineage`, `scope.{successor,group,institution,public}`, `abstain`,
   `routed`, and `roles` (the role picker's choices in 「＋ 追加」, one string: 「部長・会計・顧問」 / "President, Treasurer").
   Ask the user to confirm the Japanese wording.
3. Give it a line icon in `components/SeatHeader.tsx` (`icons`, the one table keyed by seat type: club = flag,
   exchange = route, lab = flask; typecheck asks for it). An icon only, never a colour (docs/DESIGN.md → SeatHeader).
4. If the type needs special behavior, express it only as `seats.settings` flags that already exist
   (`noteExpiry`, `groupOwnsCriticalNotes`, `requiredPrompts`). If a genuinely new flag is needed, stop and
   explain why before adding it.
5. Add one seed seat of the new type with 2–3 synthetic notes.
6. Do NOT add routes, pages, tabs or components specific to this type. If the request seems to need one,
   stop and explain the conflict with the one-interface rule in CLAUDE.md.
7. Run `pnpm typecheck` and `pnpm test`, and show the seat page for the new seat at 390px via the `ui-reviewer` subagent.
