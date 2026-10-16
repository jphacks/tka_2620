# Daidai starter kit

Claude Code configuration, spec, design brief and copy for the Daidai repo (`jphacks/tka_2620`).
Everything here is setup and planning, which JPHACKS allows before Hack Day. Commit it with the `[prep]` prefix.

## The story and the golden path
The story is **the handover nobody writes (誰も書かない引き継ぎ)**, not a secure knowledge base. This weekend the
team builds one golden path for one seat (Smash / 会計): answers where every sentence cites a predecessor's note,
「誰も知りません」 plus the **live loop** (the question reaches last year's treasurer's phone, he answers by voice, the
answer appears signed 「2025年度 会計」), a 「＋ 追加」 for pasted text, PDF / Word files and chat exports (the cold start is its first use, and it stays available all year), handover prompts, and a
10-second trust proof. The live loop is built first. The exchange and lab seats and the 恩送り screen are slides.
What wins: real quotes from real officers (`docs/EVIDENCE.md`) and a live loop that works every time.

## The idea the kit is built around: one interface for everyone
Everything is a **seat** (席), a role that outlives its holders: a club treasurer, an exchange route,
a lab duty. Every seat has the same three verbs (聞く · 残す · 自分のメモ), the same screens, and the same
four scope rings (successor / group / institution / public). Seat types differ only in their
**label pack** (`messages/*.json → seatTypes`) and **settings** (`seats.settings`). The kit enforces this in
`AGENTS.md`, `docs/SPEC.md`, `docs/DESIGN.md`, the `ui-reviewer` subagent and the `add-seat-type` skill.

## One vision for three people and their AI tools
`AGENTS.md` holds the shared rules and is read by Cursor, Codex and Copilot directly, and by Claude Code
through `CLAUDE.md` (which imports it). `docs/WORKFLOW.md` is the team process: lanes and folder ownership,
the contract-first start on Saturday, checkpoints, PR rules, the AI session frame and the cut list.
The screens and the engine meet only in the interfaces listed in `docs/SPEC.md` (`lib/contracts.ts` on Hack Day).

## Install
1. Copy the contents of this folder into the repo root, next to the JPHACKS `README.md` and `LICENSE`.
2. Add these lines to `.gitignore`:
   ```
   .env.local
   .claude/worktrees/
   .claude/settings.local.json
   seed/private/
   ```
3. Install `jq` (the formatting hook uses it): `brew install jq`.
4. Add the MCP servers (check each project's docs for current flags; read-only access is enough for Supabase):
   ```
   claude mcp add --transport http supabase https://mcp.supabase.com/mcp
   claude mcp add playwright -- npx @playwright/mcp@latest
   ```
5. Optional: run planning sessions at the highest effort with `CLAUDE_CODE_EFFORT_LEVEL=max claude`.
6. Point next-intl at `messages/` when you bootstrap the app (Japanese is the default locale).
   For 「＋ 追加」, add `pdfjs-dist` (PDF text in the browser) and `mammoth` (Word text in the browser).
7. In the GitHub repo settings, turn on "Allow squash merging" and protect `main` against force pushes.

## What's inside
| Path | Purpose |
|---|---|
| `AGENTS.md` | Shared rules for every AI tool: the vision, one interface, lanes, commands, scope and privacy rules |
| `CLAUDE.md` | Imports `AGENTS.md`, plus Claude Code specifics (plan mode, subagents, worktrees) |
| `docs/WORKFLOW.md` | Team process: lanes, contract first, checkpoints, branches and PRs, AI session frame, cut list, secrets |
| `docs/EVIDENCE.md` | Outreach message (Japanese and English) for club and festival officers, quote log, old-doc and pilot tracking |
| `docs/pitch/script.md` | The 90-second script: Kagehiro's Japanese lines, Nico's demo actions and one line, Ishibashi's live answer, English subtitles, rehearsal plan |
| `docs/README-SECTIONS.md` | README sections to paste: Numbers, User evidence, Built during Hack Day, Prepared before Hack Day |
| `docs/TEAM-GUIDE.ja.md` | Simple Japanese guide for teammates: roles, Claude Code in VS Code, GitHub, branches and merging, the per-issue loop, testing fast |
| `docs/SPEC.md` | Hack Day spec: the story, the golden path, demo story, seats, personas, data model, scope rules, routes, API interfaces, F1–F7 with acceptance checks, README numbers, LLM contracts |
| `seed/` | `notes.csv` and `questions.csv` templates, `old-handover.sample.md`, `handover-2024.sample.docx`, `notice-2026.sample.pdf`, `scan.sample.pdf` and `chat-line.sample.txt` (adding knowledge: demo and tests), `chat-canaries.txt` (redaction test), `live-answer.txt`, and a bilingual README |
| `.github/pull_request_template.md` | Acceptance check, screenshot and lane checklist on every PR |
| `docs/DESIGN.md` | Design system 部室ノート (notebook by day, blackboard by night): personality, three-colour-pen colour rules, type, marks and stamps, components (KeyTag, AnswerEntry, AbstainEntry, InboxSlip, VoiceAnswer, AddPanel, RedactionPreview…), motion, copy voice, don'ts |
| `styles/tokens.css`, `styles/components.css` | The tokens (both themes) and the `dd-…` component classes; import both from `app/globals.css`. Fonts via next/font/google: Klee One, BIZ UDPGothic, BIZ UDGothic, Yusei Magic |
| `messages/ja.json`, `messages/en.json` | Starter copy: the three verbs, label packs for `club_role`, `exchange_route`, `lab_duty`, and shared strings |
| `.claude/settings.json` | Permission allowlist (and no access to `.env*` or `seed/private/`), Biome format-on-edit hook, macOS notification hook |
| `.claude/agents/leak-auditor.md` | Opus subagent that reviews diffs for scope leaks, live-loop routing and citation checks |
| `.claude/agents/ui-reviewer.md` | Sonnet subagent that screenshots screens and checks they're identical across seat types |
| `.claude/skills/add-seat-type` | `/add-seat-type <type> "<description>"`: add a new kind of group with a label pack and settings only |
| `.claude/skills/leak-test` | `/leak-test`: run and summarize the leak test |
| `.claude/skills/demo-reset` | `/demo-reset`: reset the database and verify the golden path (answer, live loop, trust proof) |
| `.claude/skills/hackday-log` | `/hackday-log`: fill the README numbers, user evidence and the Hack Day vs setup tables with commit links |
| `.claude/skills/design-system` | Loaded automatically for UI work |
| `.vscode/` | Recommended extensions and workspace settings (i18n Ally edits `messages/` inline) |
| `.env.example`, `.worktreeinclude` | Variable names, and copying `.env.local` into Claude Code worktrees |

## Order for Friday (the repo is empty)
0. All three: message 3–5 club or festival officers with `docs/EVIDENCE.md` (quotes, an old handover doc, a November pilot).
1. Copy the kit, bootstrap Next.js, push `[prep]` so teammates can clone.
2. Supabase project with `vector`, tables-only migration, `.env.local`, `ollama pull bge-m3`, AI smoke test.
3. Seed script reading `seed/*.csv`, five personas, `pnpm demo:reset`, GitHub Issues F1–F7.
4. Load the real seed notes, README skeleton, NFC/QR, `git tag pre-hackday && git push --tags`.

## The line between prep and Hack Day
- Before Saturday: this kit, the Next.js and Supabase skeleton, tables (no policies or search functions),
  seed data for all three seat types and the demo users, AI plumbing smoke test, UI shell and tokens,
  README skeleton, NFC stickers. Push the tag `pre-hackday` on Friday night.
- On Hack Day: F1–F7 in `docs/SPEC.md`, live loop first. Commit with `[hackday] F<n> …`.
