# Team workflow: how three people and their AI tools build one golden path

## 1. One vision
- **The demo story in `docs/SPEC.md` is the target**, and the live loop is its centre. Every feature serves one
  of its steps. If it isn't on the golden path, it isn't built on Hack Day.
- **What wins:** real quotes from real officers, plus a live loop that works every time. Everything else is secondary.
- **SPEC.md's acceptance checks are the definition of done.** "It works on my machine" is not done.
- **The plan changes only in SPEC.md**, by a small PR that everyone sees. Never change the vision silently in code.
- **Every AI tool reads the same rules:** `AGENTS.md` (Cursor, Codex and Copilot read it directly;
  Claude Code reads it through `CLAUDE.md`). If you use a chat in the browser, paste `AGENTS.md` first.

## 2. Lanes
| Lane | Owner | Builds | Folders |
|---|---|---|---|
| engine | Nico | F1 scope engine, F2 grounded answers, the engine side of F3 live loop, F4 trust proof and leak test, F5 adding knowledge: file extraction (`lib/ingest/`), chat parsing and redaction (`lib/redact/`), duplicates; metrics | `supabase/`, `lib/engine/`, `lib/ingest/`, `lib/redact/`, `lib/ai.ts`, `lib/embed.ts`, `app/api/`, `scripts/`, `tests/`, `metrics/` |
| screens | Kagehiro | F3 inbox and voice answer (phone), F4 console panes and meter, F5 「＋ 追加」 panel (paste, file, chat) with the redaction preview and duplicate hint, F6 handover prompts, F7 seat page | `app/(seat)/`, `app/console/`, `components/`, `styles/`, `lib/realtime.ts`, `lib/voice.ts` |
| content | Ishibashi | seed notes, test questions, the old-handover, Word, PDF and LINE chat samples, Japanese copy, interview evidence, pitch script and subtitles, slides | `seed/`, `messages/`, `docs/pitch/`, `docs/EVIDENCE.md` |

- **Shared files** (`lib/contracts.ts`, `lib/mocks.ts`, `docs/SPEC.md`, `AGENTS.md`): change only by PR, and
  post one line in `#tka_2620` ("contracts: added `live` to AskResult").
- **Nico is the merge captain**: merges PRs, keeps `main` demoable, owns the demo laptop, records the video.
- **Ishibashi is also the newcomer tester**: at every checkpoint he uses `main` as a26 (the new treasurer)
  and reports anything confusing, in Japanese.

## 3. Contract first (Sat 10:20–11:00)
1. Nico writes `lib/contracts.ts` from SPEC.md → "Interfaces": Zod schemas for every API request and response
   and every LLM output. Kagehiro reviews it on screen.
2. `lib/mocks.ts` returns realistic data for each contract, built from `seed/*.csv`, including a fake inbox item
   and a fake live answer, so the live-loop screens can be built before the engine exists.
3. Screens use the mocks (`NEXT_PUBLIC_USE_MOCKS=1`) until the engine endpoint lands, then switch per endpoint.
4. GitHub Issues F1–F7 get an owner and a checkpoint.

## 4. Checkpoints (5 minutes, on the demo laptop, `main` only)
| When | What must work |
|---|---|
| Sat 12:30 | The live loop clicks through on mocks: ask → 「誰も知りません」 → inbox on a phone → voice → signed answer |
| Sat 14:00 | **Go/no-go: the live loop works end to end once on real data** (a26 on the laptop, a25 on a phone). If not, Nico and Kagehiro pair on it and everything else waits. |
| Sat 16:30 | Grounded answer with a citation on every sentence and the rule-change flag (F2); trust proof: outsider sees nothing, withdrawal timed, 0 leaks (F4); live loop 3 runs in a row |
| Sat 18:30 | Freeze for the 19:10 mid-term presentation; tag `midterm`. Cold start (F5) shown if ready. |
| Sat night | After the mid-term: rehearse the pitch five times; run `pnpm metrics` |
| Sun 11:30 | Feature freeze: `pnpm test:loop` passes 5 in a row; only fixes after this |
| Sun 12:00 | Record the demo video from `main`: one take, the full loop, Japanese and English subtitles |
| Sun 15:00 | Code freeze. README numbers and the Hack Day vs setup table done (`/hackday-log`). Form final by 15:30. |

Each checkpoint ends with one Slack message per person: ✅ done / ▶ next / ⛔ blocked.

## 5. Branches, commits, PRs
- Branch per person and feature: `nico/f2-answers`, `kage/f3-inbox`, `ishi/seed-notes`.
- Pull `main` before you start and before you open a PR. PRs every 60–90 minutes; small is fast.
- Commit messages: `[hackday] F3 route unanswered questions to reachable predecessors` (the README commit
  table is built from these).
- A PR merges when: `pnpm typecheck && pnpm test` pass, the acceptance check output is pasted, UI PRs have a
  390px screenshot, and only the author's lane changed (or the lane owner approved).
- Squash-merge into `main`. Never force-push. Never commit `.env*` or `seed/private/`.

## 6. Working with AI (any tool)
Start every session with the same frame:

```
You are working in the <engine|screens|content> lane of Daidai.
Read AGENTS.md, docs/SPEC.md (feature F<n>) and lib/contracts.ts.
Task: <issue title>. Done when: <acceptance check from SPEC.md>.
Only edit: <your lane's folders>. If you need a change elsewhere, stop and tell me.
Give me a short plan first. After I approve, implement, run <check>, and show the output.
```

- Read the plan against SPEC.md before approving it; most mistakes are visible in the plan.
- One feature per session. Clear the session between features.
- After two failed fixes, start a fresh session with what you learned, instead of a third correction.
- Ask for evidence (test output, screenshot), not "done".
- Don't share accounts. Each person uses their own tool and plan.

## 7. Cut list (drop from the top when behind)
1. F7 upcoming list and lineage polish (a plain seat header is enough)
2. F6 ranking and follow-up questions (three fixed prompts are enough)
3. F5 WhatsApp parser (LINE and paste are enough)
4. F5 duplicate hint and 「更新する」 (additions still work; they just don't merge)
5. F5 PDF and Word upload (paste and the LINE import still work)
6. F5 chat import (pasted text still works; keep `lib/redact/` and its tests if they pass)
7. F5 note extraction (keep the "missing" list: it's the punchline)
8. F5 entirely (show it on a slide)

Never cut: the F3 live loop, F2 citations on every sentence, the F4 ten-second trust proof. They are the demo.
Already static (slides or screenshots): the exchange and lab seats, the 恩送り screen.

## 8. On stage (mid-term Sat 19:10, pitch Sun 16:00)
- **Kagehiro narrates** a fixed Japanese script (`docs/pitch/script.md`).
- **Nico runs the demo** on the laptop without speaking, apart from one Japanese line at the live loop.
- **Ishibashi is last year's treasurer**: his phone receives the question and he answers it by voice.
- Fallback: if the live demo fails, switch to the recorded video at once.

## 9. Evidence (Fri night, then the README and slides)
- Contact 3–5 club or festival officers with the message in `docs/EVIDENCE.md`.
- Goal: 2–3 real quotes, one anonymised old handover doc, and if possible one club saying
  "we'll try it at our November handover".
- Log everything in `docs/EVIDENCE.md`, anonymised and with consent. A real LINE export goes only into `seed/private/`,
  only with the group's OK, and is never opened in an AI tool. It lifts the first two judging
  criteria more than any feature.

## 10. Demo laptop and secrets
- Nico's laptop runs the demo: `main`, Ollama with `bge-m3`, `.env.local`, the console at 1920×1080.
- Ishibashi's phone is signed in as a25 on `/s/smash-kaikei/handover`; test vibration, the microphone
  permission and keyboard dictation at the venue.
- The service-role key lives only on the demo laptop (`scripts/`).
- Share `.env.local` values with a one-time secret link or in person, never in Slack.
- Test the NFC sticker and QR with the presenting phone at the venue. Keep the phone hotspot ready.
- Fallbacks: Wi-Fi down → hotspot; Claude API down → local model via Ollama; live demo fails → the recorded video.
