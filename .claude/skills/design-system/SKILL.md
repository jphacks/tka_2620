---
name: design-system
description: Daidai design system and UI rules. Use whenever building or changing UI, components, styles or copy.
---

Read `docs/DESIGN.md` and follow it exactly; tokens are in `styles/tokens.css`, ready-made classes (`dd-…`) in
`styles/components.css`. The look is 部室ノート: notebook paper by day, blackboard by night. In short:

- Golden path first: `AskField`, `AnswerEntry` (a mini stamp after every sentence), `AbstainEntry` (空欄), the live
  loop (`InboxSlip`, `VoiceAnswer`, `LiveStamp`), `AddPanel` + `RedactionPreview` + `MissingList`, the trust proof
  on the console (`WithdrawMeter`, `LeakCounter`). Don't build components marked "later".

- One interface for everyone: the same screens for every seat type. Never add a screen, tab or flow for one
  seat type; differences come from the label pack (`seatTypes.<type>`) and `seats.settings` only.
- Three verbs only: 聞く · 残す · 自分のメモ (`VerbTabs`). Bottom tab bar on phones.
- Progressive disclosure: scope picker, expiry and "critical" controls appear only while writing a note,
  and only when the seat's settings enable them. Scope defaults to `successor`.
- Use the tokens; no literal colours. One job per pen: `--ink` knowledge, `--blue` the viewer (everything
  interactive), `--red` proof and corrections only (date stamps, 二重線, 「変更」 notes, the running meter, never
  errors), `--marker` behind deadline text only, `--green` only for 「漏れ 0」 and redaction counts.
- Fonts (next/font/google): Klee One for predecessors' words (`--font-hand`, on the 32px ruled grid), BIZ UDPGothic
  for UI (`--font-ui`), BIZ UDGothic for dates and counts (`--font-figures`), Yusei Magic only on key tags
  (`--font-marker`). Nothing below 13px.
- Shape follows the object: slips 2px + the `--edge` paper edge, key tags 10px with a hole, buttons 6px, stamps
  and the voice button round. No soft shadows, gradients, chat bubbles, sparkles, emoji or "AI" in copy.
- Seat types get an icon, never their own colour.
- "Nobody knows" is a calm first-class state, never styled as an error.
- All copy comes from `messages/*.json`; Japanese is the default.
- Respect `prefers-reduced-motion`.

After a UI change, ask the `ui-reviewer` subagent to check the screen.
