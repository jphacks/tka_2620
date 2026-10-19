<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/mark-dark.svg">
  <img src="docs/images/mark-light.svg" width="112" alt="Daidai's mark: a blue note with its corner folded down and 々 written on it by hand (the 々 of 代々, generation after generation)">
</picture>

# Daidai (代々): the handover nobody writes

[![CI (typecheck, unit tests, lint, on mock data)](https://github.com/jphacks/tka_2620/actions/workflows/ci.yml/badge.svg)](https://github.com/jphacks/tka_2620/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[日本語](README.md) | English

**Daidai answers a newcomer's questions only from what their predecessors wrote down. A question nobody can answer reaches a predecessor's phone. They answer by voice, and the answer appears signed 「2025年度 会計」 (FY2025 treasurer), never with a name.**

*Daidai (代々) means "generation after generation".*

<!-- Once the demo video (task 2) is online, start the links line with "[Demo video (90 s)](https://www.youtube.com/watch?v=VIDEO_ID) · ". The image stays a link to the public demo. -->
<a href="https://daidai-demo.vercel.app/s/smash-kaikei">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/hero-en-dark.png">
  <img src="docs/images/hero-en-light.png" width="100%" alt="Open the public demo (mock). Two phone screens with demo data. On the left, last year's treasurer's 残す (hand over) page shows 「後輩から質問が届きました」 (a newcomer asked you something), the question about receipts after the books were closed, and a field with a microphone for answering by voice, then the handover questions with 「＋ 追加」 (add). On the right, the newcomer's seat page shows the tags of past treasurers (24, 25, and you), the upcoming deadline, the way into the handover guide, and the signed answer 「いま、2025年度 会計が答えました」 (the FY2025 treasurer just answered), with the ask field right above the tabs.">
</picture>
</a>

[Open the demo (mock)](https://daidai-demo.vercel.app/s/smash-kaikei) · [How it works](#how-it-works) · [Try it](#try-it) · [User evidence (13 quotes)](docs/EVIDENCE.md) · [Everything built during Hack Day](https://github.com/jphacks/tka_2620/compare/pre-hackday...2206aa2)

## The problem

A club's treasurer, a festival lead, a lab's equipment keeper: the roles change every year, and what their holders knew leaves with them. Nobody knows what to write down until the newcomer is stuck. The three people we interviewed on 17 Oct 2026 had all run into this (quoted without names, with their consent). All 13 quotes are in [docs/EVIDENCE.md](docs/EVIDENCE.md).

> The handover from the year before last didn't go smoothly, and the registration for our club room was missed. As a result, [the club] no longer has a dedicated club room this year. (International officer, university debating club)

> There's even work that never got done in my year because I missed the timing. (Food-stall lead, Komaba Festival, translated)

> When I look back to decide what to hand over, I can't remember it, so when the handover comes I can't write enough. (Former lead for a high school's sports-day broadcast and yearbook, translated)

The knowledge lives in Google Drive and in LINE and Slack threads, and those places disappear on schedules unrelated to a one-year term. Slack's free plan deletes messages after a year,<sup>[1](https://www.heise.de/en/news/Slack-deletes-data-from-free-workspaces-after-one-year-9783229.html)</sup> and some universities delete accounts at graduation.<sup>[2](https://www.wako.ac.jp/img/library/icc/manual/gmail_drive_migration_20260401.pdf)</sup>

Japan had a record 2.646 million undergraduates in 2025,<sup>[3](https://eic.obunsha.co.jp/file/educational_info/2025/1002_1.pdf)</sup> and 51.5% of final-year students belong to a club or circle.<sup>[4](https://career-research.mynavi.jp/wp-content/uploads/2025/01/2026_Lifestyle-1.pdf)</sup> At the University of Tokyo, registered student groups must file to continue by the end of May every year.<sup>[5](https://www.u-tokyo.ac.jp/ja/students/clubs/h09_01.html)</sup>

## How Daidai works

Daidai calls a role a seat (席). A seat outlives its holders, and every seat has the same three actions: **ask** (聞く), **hand over** (残す) and **my notes** (自分のメモ).

1. The new treasurer holds a phone to the NFC sticker on the club-room key and asks 「模擬店の保健所申請、いつまで？」 ("When is the health-department form for our food stall due?").
2. Every sentence of the answer carries the year stamp of the predecessor's note it rests on. A sentence whose rule changed between years is marked 「2025年に変更」 (changed in 2025).
3. A question no note answers gets 「歴代の会計は誰も知りません。」 (none of the past treasurers knows) and reaches last year's treasurer as 「後輩から質問が届きました」 (a newcomer asked you something).
4. Last year's treasurer answers by voice, checks the draft and taps 公開する (publish).
5. The newcomer's screen shows 「いま、2025年度 会計が答えました」 (the FY2025 treasurer just answered), with the signed answer.

<!-- Live-loop GIF (task 9): once docs/images/loop.gif exists, replace this whole comment with the next line.
![The live loop: from 「歴代の会計は誰も知りません。」 to last year's treasurer answering by voice and the signed answer arriving](docs/images/loop.gif)
-->

「＋ 追加」 turns last year's documents and chat exports into dated draft notes. Names and contact details are redacted on the device before anything is sent, and the original files are never stored. Whatever is missing (「保健所申請の締切が書かれていません」, "the health-department deadline isn't written down") becomes a list, and each item can go to a predecessor as a question.

The handover guide (引き継ぎ書) puts the readable notes, the upcoming deadlines and what isn't written yet on one page. Club roles, exchange routes and lab duties all use the same screens. Only the words change from one kind of seat to another.

<!-- Three seats side by side (task 9): once docs/images/seats.png exists, replace this whole comment with the next line.
![One seat page for three kinds of seat: treasurer, TUM to UTokyo IST, bioprinter duty](docs/images/seats.png)
-->

## Features

### 1. Every sentence cites a note, and unverifiable sentences are dropped
Code checks that each sentence cites a note the search actually found, and removes any that doesn't. If none remain, Daidai answers "nobody knows" and sends the question to a predecessor.

### 2. What nobody knows goes to a predecessor
The question reaches only predecessors of the same seat who agreed to be contacted, shown by seat and year. When the predecessor answers by voice, the answer stays with the seat, and every newcomer who was waiting gets it, signed.

### 3. The database decides who sees what
Each note is shared with the next holder only, the group, the university or everyone, and the database, not the app, decides who sees what. A withdrawn note leaves every answer in a median of 0.27 s.<sup>[6](metrics/latest.json)</sup>

## What it solves

| What we heard | What Daidai does |
|---|---|
| Unable to recall what to hand over, "I can't write enough" (former high-school event lead, translated) | The questions newcomers actually ask reach the predecessor, so nobody has to guess what to write. |
| "Not the timing of the actual tasks, or even where the role stands and what it covers" (Komaba Festival food-stall lead, translated) | Deadlines from past notes appear on the seat page as upcoming deadlines. |
| "I would have liked to know more about how to handle administrative procedures and paperwork" (university debating club's international officer) | The seat answers from past notes, with a source on every sentence. If no note covers it, the question reaches a predecessor. |
| Last year's handover documents: "Nothing in particular, it was verbal" (Komaba Festival food-stall lead, translated) | Verbal still works. A spoken answer becomes a dated note. |
| Where the information lives: "Google Drive, and the replies to questions asked on LINE or Slack" (same, translated) | 「＋ 追加」 takes documents and chat exports, redacts them on the device, and drafts notes. |

## How it differs

A general-purpose AI doesn't know your predecessors.

| | AI that searches documents (Notion AI<sup>[7](https://www.notion.com/help/enterprise-search)</sup>, NotebookLM<sup>[8](https://support.google.com/notebooklm/answer/16269187?hl=en)</sup>, …) | Workplace Q&A (Qast<sup>[9](https://thebridge.jp/2024/12/any-operator-of-a-knowledge-platform-raises-1-055-billion-yen-in-series-b-funding)</sup>, Tettra<sup>[10](https://support.tettra.com/article/110-asking-questions-in-tettra)</sup>, Guru<sup>[11](https://help.getguru.com/docs/using-guru-answers-to-find-trusted-information)</sup>, …) | Daidai |
|---|---|---|---|
| Grounding | Shows sources | Answers from posts | A source on every sentence. Unverifiable sentences are dropped |
| When there is no answer | Can't answer what isn't written | Asks a current employee who knows | Reaches a predecessor, who answers by voice |
| Sharing unit | Notebook or workspace | Company | Each note (next holder / group / university / everyone), withdrawn within a second |
| For | Individuals, companies | Companies | Student groups whose roles change every year |

<sub>Based on each vendor's public documentation, October 2026.</sub>

## What's next

If we reach Award Day, two or three groups will use Daidai free of charge at their November handover. We will measure (1) how often predecessors answer, (2) how long they take, and (3) how many 「誰も知りません」 answers disappear. Lab-duty and exchange-route seats already run on the same screens (in the demo data).

## What we cared about

- **No AI on screen**: answers come from predecessors. The screens show no "AI" and no sparkles.
- **The same rules for our AI tools**: [AGENTS.md](AGENTS.md) gives every coding tool three rules (scope enforced in the database, a source on every sentence, files never leave the device), and each feature landed as its own PR.
- **Measured with a script**: leaks, withdrawal, citations, redaction and the live loop are measured with `pnpm metrics`.<sup>[6](metrics/latest.json)</sup>

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/architecture-en-dark.svg">
  <img src="docs/images/architecture-en-light.svg" width="100%" alt="Diagram of how Daidai works. A newcomer's question reaches the Daidai server. The database searches with the viewer's permissions and returns only notes the viewer may read. Claude writes a draft from those notes alone, and Daidai's code checks the source of every sentence before the cited answer goes back. If nobody knows, the question reaches a predecessor, who answers by voice and publishes, and the signed answer reaches the newcomer. Documents and chats are redacted on the device before they become draft notes.">
</picture>

1. **Question and cited answer**: Daidai passes the newcomer's question to the database with the newcomer's own permissions.
2. **Search as the viewer**: only the database's row-level security policies decide what can be found.
3. **Source check**: Claude writes a draft from the readable notes alone, and Daidai's code checks the source of every sentence.
4. **When nobody knows**: Realtime delivers the question to a predecessor's phone.
5. **Answer by voice and publish**: the answer stays with the seat, and every waiting question gets it, signed.

The green shields mark the three safeguards: redaction on the device, scope decided by the database, and sources checked by code.

### Built with

- Claude API (Anthropic): Sonnet for answers, note drafts and extraction, and Haiku for follow-up questions and question merging
- Ollama + bge-m3: embeddings for notes and questions (1,024 dimensions)
- Supabase: Postgres + pgvector, row-level security, Realtime, auth
- Web Speech API (`ja-JP`): voice answers
- Next.js 16, React 19, TypeScript, Tailwind CSS 4, next-intl (Japanese and English)
- Vercel AI SDK and Zod (checks on API and model output)
- pdfjs-dist and mammoth (in-browser text extraction from PDF and Word)
- Vitest, Biome, GitHub Actions
- Devices: phones for the newcomer and the predecessor, an NFC tag on the club-room key (a printed QR code opens the same page), and a laptop for the three-pane console

### Our own technology

All of it was built during Hack Day (see [Built during Hack Day](#built-during-hack-day)).

- [`lib/engine/answer.ts`](lib/engine/answer.ts) keeps only sentences that cite a note the model was given, and abstains and routes the question when none remain.
- [`lib/engine/rule-change.ts`](lib/engine/rule-change.ts) computes the rule-change flag from `deadline_date`, without the model.
- [`supabase/migrations/0004_search_notes.sql`](supabase/migrations/0004_search_notes.sql) is a search function that runs with the viewer's permissions, so only the policies in [`0002_notes_rls.sql`](supabase/migrations/0002_notes_rls.sql) decide what can be found.
- The live loop saves and routes a question in one transaction, and publishing re-answers every waiting question ([#67](https://github.com/jphacks/tka_2620/pull/67), [#80](https://github.com/jphacks/tka_2620/pull/80), [#114](https://github.com/jphacks/tka_2620/pull/114)).
- [`lib/redact/redact.ts`](lib/redact/redact.ts) redacts on the device, and `/api/import` re-runs the same rules and rejects anything still found ([#99](https://github.com/jphacks/tka_2620/pull/99)).
- [`scripts/check-leak.ts`](scripts/check-leak.ts) tries every persona against every scope for leaks.

## Built during Hack Day

Between 17 Oct 10:20 and 18 Oct 15:00 JST we merged 74 PRs into `dev`, adding 11 migrations and 39 test files. The table lists the main PRs. Everything else is in the full diff, [pre-hackday...2206aa2](https://github.com/jphacks/tka_2620/compare/pre-hackday...2206aa2).

| Feature | What it does | Main PRs |
|---|---|---|
| F1 Scope engine | The database decides each note's scope and returns only the notes the viewer may read | [#58](https://github.com/jphacks/tka_2620/pull/58), [#63](https://github.com/jphacks/tka_2620/pull/63), [#65](https://github.com/jphacks/tka_2620/pull/65) |
| F2 Grounded answers | A source on every sentence, 「誰も知りません」 when none remains, and a mark on rules that changed between years | [#72](https://github.com/jphacks/tka_2620/pull/72), [#74](https://github.com/jphacks/tka_2620/pull/74), [#79](https://github.com/jphacks/tka_2620/pull/79) |
| F3 Live loop | An unanswered question reaches a predecessor's phone, and the spoken answer reaches the newcomer, signed | [#67](https://github.com/jphacks/tka_2620/pull/67), [#80](https://github.com/jphacks/tka_2620/pull/80), [#114](https://github.com/jphacks/tka_2620/pull/114) |
| F4 Trust proof | The console shows that outsiders see nothing and that a withdrawal leaves every answer within a second | [#77](https://github.com/jphacks/tka_2620/pull/77), [#84](https://github.com/jphacks/tka_2620/pull/84), [#93](https://github.com/jphacks/tka_2620/pull/93) |
| F5 Add what exists | Documents and chat exports are redacted on the device and drafted into notes, and what's missing is listed | [#95](https://github.com/jphacks/tka_2620/pull/95), [#99](https://github.com/jphacks/tka_2620/pull/99), [#103](https://github.com/jphacks/tka_2620/pull/103) |
| F6 Handover prompts | What newcomers asked becomes a question for the predecessor, and a voice answer becomes a draft note | [#100](https://github.com/jphacks/tka_2620/pull/100), [#110](https://github.com/jphacks/tka_2620/pull/110), [#111](https://github.com/jphacks/tka_2620/pull/111) |
| F7 Seat page and NFC entry | The NFC sticker on the club-room key opens the seat page with past holders, deadlines and the ask box | [#112](https://github.com/jphacks/tka_2620/pull/112), [#113](https://github.com/jphacks/tka_2620/pull/113), [#120](https://github.com/jphacks/tka_2620/pull/120) |
| Handover guide | Readable notes, deadlines and what isn't written yet on one page, ready to export | [#118](https://github.com/jphacks/tka_2620/pull/118) |

## Prepared before Hack Day

| What | Commit (JST) |
|---|---|
| Starter kit (rule documents, AI tool config, design tokens, Japanese and English copy, sample files) | [ba9b9a0](https://github.com/jphacks/tka_2620/commit/ba9b9a0) (16 Oct 19:35) |
| Next.js skeleton (empty screens) | [214d33e](https://github.com/jphacks/tka_2620/commit/214d33e) (16 Oct 20:12) |
| Supabase tables without policies, and a Claude and Ollama connection check | [862b135](https://github.com/jphacks/tka_2620/commit/862b135) (16 Oct 22:15) |
| Screenshot setup and shared server config | [5e7d783](https://github.com/jphacks/tka_2620/commit/5e7d783) (16 Oct 23:18) |
| Seed script, bge-m3 embeddings, and a tunnel for phones | [277268e](https://github.com/jphacks/tka_2620/commit/277268e) (17 Oct 00:06) |
| README skeleton | [109c388](https://github.com/jphacks/tka_2620/commit/109c388) (17 Oct 00:37), [a39a38e](https://github.com/jphacks/tka_2620/commit/a39a38e) (00:48) |

The last state before Hack Day is the tag [`pre-hackday`](https://github.com/jphacks/tka_2620/tree/pre-hackday) (17 Oct 00:59, [#48](https://github.com/jphacks/tka_2620/pull/48)). At that point `app/` held only empty pages and the shared layout, `components/` had no files, and the database had no policies. Hack Day work started on 17 Oct at 10:20.

## After the code freeze

The code freeze was 18 Oct, 15:00 JST, with `main` at [2206aa2](https://github.com/jphacks/tka_2620/commit/2206aa2) (the same content as `dev` at 14:58). That is where the Hack Day work ends.

On 19 Oct we added the following to `main`. All of it is in the diff [2206aa2...main](https://github.com/jphacks/tka_2620/compare/2206aa2...main).

- A review of the screens ([#134](https://github.com/jphacks/tka_2620/pull/134) to [#157](https://github.com/jphacks/tka_2620/pull/157), merged from `dev` into `main` in [#158](https://github.com/jphacks/tka_2620/pull/158) and [#160](https://github.com/jphacks/tka_2620/pull/160)): wording, button placement, screen-reader announcements, two tabs in 「＋ 追加」, and a list of your own questions.
- An API route that returns the caller's own questions and answers, `GET /api/seats/[slug]/asked` ([#138](https://github.com/jphacks/tka_2620/pull/138)). The leak test probes it too.
- A fix in reading chat exports: a WhatsApp export with a single message still reads as a chat ([#154](https://github.com/jphacks/tka_2620/pull/154)).
- The README and images. The image at the top shows the screens as they are now.
- The public demo (mock): this `main`, deployed on Vercel.

The database (`supabase/`), the search, the access policies and the citation check (`lib/engine/answer.ts`) did not change.

## Try it

Public demo (mock): **[daidai-demo.vercel.app/s/smash-kaikei](https://daidai-demo.vercel.app/s/smash-kaikei)**

The mock uses no database and no AI, the answers come from the demo data, and there is no sign-in. To run it locally (Node 22.18 or later, pnpm 10):

```bash
pnpm install
NEXT_PUBLIC_USE_MOCKS=1 pnpm dev
```

Open the public demo or http://localhost:3000/s/smash-kaikei and try these four steps (about three minutes). The screens are in Japanese by default. The English link at the top switches them, and the labels below are the Japanese ones.

1. Ask 「模擬店の保健所申請、いつまで？」 → every sentence gets a year stamp, and 「2025年に変更」 appears.
2. Ask 「決算後に申請された領収書はどうすれば良いですか？」 → after 「歴代の会計は誰も知りません。」, press the mock-only button 「先輩が答えて公開する（モック）」, and the signed answer 「いま、2025年度 会計が答えました」 appears.
3. In the console ([public demo](https://daidai-demo.vercel.app/console) or http://localhost:3000/console), press 「撤回する」 on 「保健所申請の締切が早くなった」 in the 「去年の会計」 pane → the meter shows the seconds, and the 「2025年に変更」 sentence leaves the newcomer's answer. The 「部外者」 (outsider) pane shows nothing.
4. On the seat page, go to 残す → 「＋ 追加」 → 「ファイル」 (file), choose the made-up chat [`seed/chat-line.sample.txt`](seed/chat-line.sample.txt) (download it first for the public demo), press 「この役割で隠す」, tick the consent box and press 「この内容だけを送る」 → the redaction count and the 「〇〇が書かれていません」 list appear.

Real mode needs a Supabase project, an Anthropic API key and Ollama with `bge-m3`. Copy `.env.example` to `.env.local`, fill in the values, then run `supabase db push`, `pnpm seed` and `pnpm dev`. The demo accounts' password is `DEMO_PASSWORD`.

## Team and licence

Team tka_2620: engine (search, scope, API, measurement) [@Nico4899](https://github.com/Nico4899), screens [@PenguinCabinet](https://github.com/PenguinCabinet), content, user research and pitch [@yonage](https://github.com/yonage)

Licence: [MIT](LICENSE)
