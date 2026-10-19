# Daidai design system: 部室ノート (the club-room notebook)

Tokens live in `styles/tokens.css`, component classes (`dd-…`) in `styles/components.css`. This file says what they mean and how to use them. The visual reference
(all tokens and components, both themes) is the "Daidai Design System" page; this file wins if they differ.

## Personality
Daidai is the meticulous senpai's handover notebook (几帳面な先輩の引き継ぎノート): written by hand, dated,
signed, kept tidy, and honest about the blank lines.

| Trait | What it means on screen |
|---|---|
| 誠実 Honest | Every sentence shows whose note it came from. Unknowns are a blank line, never a guess. |
| 温かい Warm | Predecessors' words appear in a handwriting face; the app's own chrome stays quiet. |
| 几帳面 Meticulous | Dates, terms and stamps are exact; text sits on a fixed ruled grid. |
| 控えめ Modest | The AI is invisible. Answers come from 先輩, never from "AI". No sparkles, no chat bubbles. |

What it is not: a chatbot, a SaaS dashboard, a zen temple, or a "wa-modern" poster.

## The idea in one picture
The things on a club-room desk: a notebook with ruled lines, a three-colour ballpoint pen, a yellow highlighter,
a date stamp, and the room key on its tag. Notebook paper by day, the classroom blackboard by night.

Each pen colour has one job, after the familiar three-colour-pen habit (赤・青・緑):
- **Black ink**: knowledge. Predecessors' notes and answers.
- **Blue ink**: you. What the viewer asks, taps or selects; links, buttons, focus.
- **Red ink**: proof and corrections. Date stamps (bylines), the double line of a withdrawal or update,
  the red-pen margin note when a rule changed.
- **Highlighter**: time. Deadlines and dates that matter soon. Only ever behind black ink.
- **Green**: safe. Only "漏れ 0" and successful privacy counts.

## Color
| Token | Light (notebook) | Dark (blackboard) | Use |
|---|---|---|---|
| `--paper` | `#F9FAFB` | `#1B2723` | Page |
| `--sheet` | `#FFFFFF` | `#22302B` | Slips, tags, panes |
| `--rule` | `#D9E1EC` | `#33433C` | Ruled lines, borders, dividers (decorative only) |
| `--ink` | `#1D2433` | `#E9EEE7` | Text, redaction bars |
| `--ink-2` | `#566074` | `#A8B5AC` | Secondary text, captions |
| `--blue` | `#2141B8` | `#9DB4FF` | Interactive: links, buttons, focus ring, the asker's question, selected scope |
| `--red` | `#C0262F` | `#FF9890` | Date stamps, double-line corrections, rule-change margin notes, running meter |
| `--marker` | `#FFE35A` | `#5F5418` | Highlighter behind deadline text |
| `--green` | `#24704A` | `#8FD3A4` | "漏れ 0" and privacy counts only |
| `--blue-wash` | `#E8EDFB` | `#2A3A5A` | Selected scope ring, hover on blue controls |

Contrast (WCAG): every text colour is at least 5.6:1 on `--paper` in light and 7.2:1 in dark.
Two rules follow from the numbers: never put `--blue` text on `--marker` in dark mode (3.8:1), and never
use `--rule` for text.

## Type
| Role | Face | Where |
|---|---|---|
| Hand (predecessors' voice) | **Klee One** 400 / 600 | Note bodies, answers, the question on the inbox slip, the live transcript |
| UI | **BIZ UDPGothic** 400 / 700 | Everything the app itself says: buttons, labels, headers, help |
| Figures | **BIZ UDGothic** 400 / 700 | Dates, terms, counts, the withdrawal meter, stamp digits (fixed-width digits) |
| Marker (labels on the key tag) | **Yusei Magic** 400 | The seat name on the key tag and the term on each lineage tag. Nowhere else. |

Fallbacks: `"Hiragino Sans", "Noto Sans JP", system-ui, sans-serif` for UI and figures;
`"Hiragino Mincho ProN", serif` is *not* a fallback for Klee One: use the UI stack.

Scale (ratio 1.25): 13 · 16 · 20 · 25 · 31 · 39 px. UI body 16/1.6. Hand body 17px on a 32px line (the ruled grid).
Seat name on the tag 31px. Console title 39px. Nothing below 13px.

Japanese settings (put them on the root and in the components named):
- `lang="ja"` on `<html>`; English pages get `lang="en"`.
- Text from notes, questions and answers carries its own `lang`, so Japanese keeps `lang="ja"` on English pages
  (fonts and `auto-phrase` line breaks depend on it): a note's title and body from `notes.lang`, the question on an
  `InboxSlip` from `questions.lang`, and each `AnswerEntry` sentence from the answer's `language` (answers are
  written in the asker's language, which can differ from the notes').
- Headings, tag labels and buttons: `word-break: auto-phrase` (Chrome 119+, falls back cleanly) and
  `font-feature-settings: "palt"` with `letter-spacing: .04em`.
- Body text: no `palt`, `letter-spacing: .02em`, `line-break: strict`.
- `text-autospace: normal` where supported (progressive; adds space between Japanese and Latin/digits).
- Vertical labels on lineage tags: `writing-mode: vertical-rl`; years as one upright unit with
  `text-combine-upright: all` on a `<span>` holding the last two digits (「'25」 reads 「25」).
- No italics, no all-caps labels. Emphasis is the highlighter or bold UI text, never colour alone.

## Marks and signs
Use Japanese notebook marks, not coloured chips or emoji. Each mark is followed by its word for screen readers
(`aria-label` on the mark, the word visible in lists).

| Kind | Mark | Word |
|---|---|---|
| `deadline` | 〆 | 締切 |
| `contact` | ℡ | 連絡先 |
| `rule_of_thumb` | ◎ | コツ |
| `pitfall` | ㊟ | 落とし穴 |
| `unwritten_rule` | ※ | 暗黙のルール |

- **Date stamp (日付印)**: the byline. A red ring with three tiers: role on top (会計), the year in the middle band
  (2025, figures face), group at the bottom (Smash; at most five Latin letters or three kanji). 64px on a note; a 24px
  mini stamp holding only 「25」 after each answer sentence as its citation, with a 44px hit area. Rotated -3°.
  Never used for anything but authorship.
- **Double line (二重線)**: the Japanese correction mark. A withdrawn or updated note is crossed with two red
  lines before it leaves; an updated note keeps the lines and 「2026年度に更新」.
- **Blackout (黒塗り)**: hidden names and numbers in the redaction preview are solid `--ink` bars with the type
  in small `--paper` UI text inside: 「電話番号」.
- **Blank line (空欄)**: what nobody knows. An empty ruled line with a dashed stamp outline at its end.

## Space, lines and shape
- Base unit 4px. Spacing 4 · 8 · 12 · 16 · 24 · 32 · 48. Side gutter 16px on phones, 24px from 600px.
- **Ruled grid**: note and answer areas draw a ruled line in `--rule` at the foot of every 32px line box
  (`background: repeating-linear-gradient(to bottom, transparent 0 31px, var(--rule) 31px 32px)`, no offset), so hand
  text sits on the lines. Anything inside (mini stamps, the 「2025年に変更」 note) stays on the same line so the rhythm
  holds. UI areas (headers, buttons, forms) have no lines.
- **Shape follows the object, not one radius for everything:**
  page 0 · slip (inbox, import panel) 2px · key tag 10px with a 10px punched hole · button 6px ·
  voice button round · ask field 6px (an outlined box).
- **Elevation**: none, except slips, which sit on the page with a 1px `--rule` border and a 0 2px 0 offset
  in `--rule` (a paper edge, not a blur shadow).
- Tap targets at least 44px; the voice button 80px.

## Components (golden path)
- **`SeatHeader`**: the key tag on the left, 44px tall (Nico's call): the seat type's word in UI text, then the seat's
  name in Yusei Magic 20px, 「役職：会計」 (a ring through the punched hole),
  group and institution in UI text beside it. One line icon per seat type (club = flag, exchange = route,
  lab = flask); seat types never get their own colour.
- **`LineageRail`** (歴代の札): one small key tag per term, oldest left, newest right, vertical Yusei Magic
  labels 「24 会計」, 「25 会計」, then a dashed blank tag 「あなた」 for the viewer. Horizontal scroll on phones.
- **`VerbTabs`**: 聞く · 残す · 自分のメモ as notebook index tabs: on phones they sit at the bottom edge; the active
  tab is `--sheet` with blue text and joins the page, inactive tabs are `--paper` with `--ink-2` text. The bar is
  translucent (the paper at 72%, the chosen tab at 88%, no blur), so the page shows faintly as it scrolls under it;
  opaque under `prefers-reduced-transparency`. A pressed tab shows `--blue-wash` at once.
- **`SeatBar`**: a quiet row above every seat page, right-aligned in the page's 640px column, never printed, with 8px
  under it before the page begins (Nico's call: a little more room). Three
  44px items: the language switch (the other language named in itself, 「English」 / 「日本語」, as a blue text button),
  the theme switch (**`DisplayToggles`**: a 6px blue-outlined icon button, the moon on the notebook and the sun on the
  blackboard, `aria-pressed` for 暗い画面) and 「あなた」, a key tag's shape lying down, outlined solid in `--blue` like the
  theme button, so it reads as a control (the dashed 「あなた」 stays the viewer on the lineage rail). Both display
  choices are this device's own (cookies), rendered by the server, so there is no flash. Nothing in the bar is a
  fourth verb.
- **「あなた」 is the account on this device** (`AccountMenu`). A small chevron after the word says it opens a menu
  (`aria-haspopup`, `aria-expanded`). A tap opens a small slip just under the bar, at the column's right edge: 264px,
  13px text, its button 36px tall with a 44px tap area (Nico's call: smaller). It uses the Popover API, so Esc or a tap
  outside closes it, and focus goes back to the tag.
  - Signed in: 「2025年度 会計でログインしています」 (never a name), then a full-width 「アカウントを切り替える」. That takes
    the account's data off the screen, signs out this device only, and shows `SignIn` in place.
  - Signed out: 「この端末ではログインしていません」.
  - While the page checks the sign-in, or signs out: its caption (「ログインを確かめています」, 「ログアウトしています」).
  - Offline: the offline line.
  - On mocks: that the page shows sample data.
  - The tag fills with `--blue-wash`, its chevron pointing up, while the slip is open.
- **`YouCard`**, at the top of 自分のメモ (`/me` redirects there): who you are at the seat you came from, never by name.
  - Your dashed tag 「26 会計」 beside your byline (「2026年度 会計」, 20px bold).
  - The group and institution, and 「この席の3代目です」.
  - Someone who never held the seat is named as `SignIn` names them, with 「会計を担当したことはありません」.
  - Identity only: nothing to set. The notes, their filter and 「撤回する」 follow.
  - It is read with the notes, so the card and the list appear together. A seat that can't be read leaves the card out,
    never the notes.
- **`SignIn`**: what a signed-out seat page shows in place (the URL stays the seat link, so an NFC tap still lands
  on the seat). A UI area with no ruled lines: 「ログイン」 and a one-sentence lead in `--ink-2`, then 「アカウント」 and the
  five demo accounts as 44px choices, never by name: a holder by the label pack's byline (「2026年度 会計」), the other
  two by their group or school (「軽音サークルの部員」, 「やまて大学の学生」). Hover and the chosen one are `--blue-wash`;
  the chosen one also gets a `--blue` border and bold blue text. Below them, one password field as a writing line (a
  2px `--blue` underline, no box) in the UI face (the password is the app's word, not a predecessor's) with the usual
  focus ring,
  then a full-width primary 「ログインする」, live as soon as an account is chosen. A wrong password, or no answer from
  the server, gets a calm `--ink-2` line under the button that says what to do, never red; it scrolls clear of the
  verb tabs. Checking the session and signing out show a calm caption (「ログインを確かめています」,
  「ログアウトしています」); no network shows a calm line with 「もう一度ためす」. Signed in, the page has no foot: which account
  this is, and 「アカウントを切り替える」, are in 「あなた」's slip in `SeatBar`.
- **`AskField`**: an outlined box, 1.5px `--blue` with 6px corners on `--sheet` (Nico's call; it was a writing line),
  as tall as the blue 「聞く」 button beside it, with the placeholder in Klee One (「先輩たちに聞いてみましょう」). Not a chat
  box: no bubble, no send arrow.
- **`AnswerEntry`**: the question repeated in blue UI text, then the answer in Klee One on the ruled grid. Each
  sentence ends with a mini stamp (「25」). Tapping a stamp opens the source note. Deadline phrases carry the
  highlighter (`--marker` behind the text, slightly taller than the x-height, no rounded ends).
  A rule change is a red-pen margin note: a red bracket left of the sentence and 「2025年に変更」 in red UI text right
  after its stamp, on the same line.
- **聞く, top to bottom:** `SeatHeader`, then `LineageRail` (代々の会計), then `UpcomingList` (これからの締切), then the first
  steps (for someone who hasn't asked yet), the guide's cover (`GuideSheet`), and the answers and 「これまでの質問」.
  - Who came before, then what's due (Nico's call): the seat's story first, then the questions.
  - The ask field isn't in that flow: it is **docked** right above the verb tabs (`AskDock`, Nico's call), in the page's
    640px column, on the paper at 72% like the tabs, so it is always in reach. While the page scrolls it fades out (160ms)
    and stops taking taps; 300ms after the scrolling stops it fades back in (200ms). It never fades while focus is in it,
    so typing, and a phone's keyboard scrolling the page up to it, keep it on screen. What went wrong with it (a question
    that didn't go out, the seat that didn't load, with 「もう一度ためす」) sits right above it, in the dock.
  - The page leaves room for the dock: its end, and an answer brought into view, stop above the dock as well as the
    tabs. The console's newcomer pane keeps the field in place, at the top of its pane.
- **AskPanel's status line**: one always-present line for a screen reader, never shown: 「先輩たちのメモを探しています」, then
  the outcome (an answer, 「誰も知りません。…に届けました」, 「いま、…が答えました」). On screen the searching line sits under the
  new question, in `--ink-2`, where the answer will be (the only sign that 聞く is working), and the answer takes its place, so
  nothing jumps; the new entry comes into view as it is added (smoothly, unless the device asks for less motion). The
  field appears once, in place: 聞く keeps the panel unseen until the seat has loaded. A load that fails offers
  「もう一度ためす」 (`RetryLine`). A question that didn't go out says so right next to the field (above it in the dock; under it in the console's pane), and is back in the field to send again.
- **First steps** on 聞く: someone who hasn't asked anything at the seat yet sees 「たとえば」 and three questions others ask at
  this kind of seat (the label pack's `seatTypes.<type>.examples`) as blue text buttons in the hand; a tap puts one in the
  field to read or change, never sends it. Gone after the first question; never on the console.
- **A load that fails** offers 「もう一度ためす」 (`RetryLine`) everywhere a page or section reads data: the seat, the inbox,
  the handover prompts, 自分のメモ and the guide. A read that hangs (venue Wi-Fi) gives up after 20 s and fails the
  same way, so no page waits forever behind 「読み込んでいます」.
- **「これまでの質問」** on 聞く: the asker's earlier questions at the seat (GET /api/seats/[slug]/asked), under this session's,
  answered ones as `AnswerEntry`, the rest with 「まだ答えはありません。答えが届くと、ここに出ます。」. An answer that came
  while the tab was closed carries 「新しい答え」 in blue UI text (13px, bold) once per device, and the status line reads out
  「先輩から新しい答えが1件届いています」. Read again when the page is back from sleep. Off on the console's newcomer pane.
- **`AbstainEntry`** (空欄): the blank line, 「歴代の会計は誰も知りません」 in `--ink-2`, and a blue status line
  「去年の会計に届けました」. Calm; never red, never an error icon.
- **`LiveStamp`**: when the live answer arrives, the new `AnswerEntry` appears and its date stamp lands,
  with 「いま、2025年度 会計が答えました」 under it.
- **`InboxSlip`** (伝言メモ, on the predecessor's phone): a message slip like an office phone-message pad.
  Header 「後輩から質問が届きました」, a 「から」 field with 「2026年度 会計」, the question in Klee One 20px,
  「〇人が質問しました」, and the answer written on the slip itself (`VoiceAnswer`), so nothing has to open first.
- **残す's page** (`HandoverColumn`): no title on screen (Nico's call: the verb tab says where you are; the h1 is for a
  screen reader), just the inbox, the handover prompts and 「＋ 追加」. They appear together, in place, once the seat, the
  inbox and the prompts have been read (a 「読み込んでいます」 caption until then), so nothing slides under a finger; a
  file dropped on the page is kept off it from the first moment. A newcomer's question shows once,
  on its slip (the prompts leave out what the inbox holds); a new one is read out in one line
  (「後輩から質問が届きました（2026年度 会計）：…」), and the inbox reads itself again when the phone wakes or comes back
  online. Each answer box is described by its question, keeps its draft when its drafted cards are put away (やめる), and
  dictates in the question's (or the page's) language. 「＋ 追加」 sits at the right end of the 「引き継ぎの質問」 row, aligned
  with the cards' right edge (Nico's call).
  - Its subtitle, right-aligned under it, says in one short line what it adds: 「去年の資料・トーク履歴」. A full
    sentence under the heading would have read as being about the questions.
  - The slip opens right there, above the cards.
  - 「＋ 追加」 shows only to the seat's holders. Others read why, in a line under the heading.
  自分のメモ shows no title either. あなた's h1 and the guide's title are `--text-l`, one step above their 20px section
  headings.
- **`VoiceAnswer`**: a textbox (1px `--ink-2`, `--blue` while focused) holding the answer in Klee One on ruled lines,
  growing with it and using its full width, with a round 40px microphone laid over it at the bottom right: `--blue` icon, filled `--blue` while
  listening with one ring pulsing outward in `--blue-wash`. Focused, the border turns `--blue` inside the usual 2px ring.
  Tap anywhere on the box to type (it is the field's label) or the mic to speak (it sits in the box's corner beside the
  label, with its own focus ring inside its circle); 「公開する」 appears below with the first word and stays clear of the
  verb tabs as the answer grows. The same box sits on each handover prompt, where the button
  says 「下書きを作る」.
- **`NoteEntry`**: a note as a notebook entry: kind mark and title (UI bold), body (Klee One), date stamp
  bottom-right, scope in small UI text (「次の会計だけ」). Deadline notes show the date in figures with the highlighter.
- **自分のメモ's list** (`MyNotes`) is what's live, what the newcomers' answers draw on. Withdrawn notes aren't dropped
  from view, since the author keeps the record of what they took back: they're folded away at the end under one 44px blue
  line, 「撤回したメモ（2件）」, which opens them struck through with 撤回済み under 「どの回答にも使われません。」 (Nico's
  call). Withdrawing a note draws the double line, collapses it out of the list, and adds it to the fold, as a reload
  shows it too. The same search and filters apply to both; with every note withdrawn the list says 「公開中のメモはありません。」.
- **`UpcomingList`**: a planner column: boxed date in figures (「10/20 火」), title, mini stamp. Dates within 7 days
  carry the highlighter.
- **The filter** (`.dd-filter`, on the guide and 自分のメモ): the search across the whole width, then the selects on one
  line, each with its caption above (種類 · 書いた人 · 並び順; 読める人 · 並び順). The captions let the choices stay
  short (「すべて」, 「新しい順」, 「締切順」); a long one, once picked, ends in 「…」 and reads in full in the open list. Two to
  a row below 380px (375px iPhones, 360px Androids); a fourth select (席) takes its own row. The printout and the export
  still say what was left in, in full words (「絞り込み：すべての種類、2025年度 会計」).
- **`ScopeRings`**: four concentric rings drawn in 1.5px `--blue`; the chosen ring fills with `--blue-wash`.
  Labels from the seat's label pack. `ReaderCount` beside it: 「12人が読めます」 in figures; no avatar stack.
- **`AddPanel`** (「＋ 追加」, beside the prompts' heading on 残す): a slip with two index tabs, 貼り付け · ファイル.
  - **貼り付け:** a two-way choice above the box (`.dd-choices`, side by side when they fit): 「資料」 (the default) or
    「コピーしたメッセージ」, which reads every speaker as a chat's, so their names get roles. The box keeps what was
    typed across the choice.
  - **ファイル:** one `FileDrop` (a dashed `--rule` area) for a PDF, Word or text file and for a LINE or WhatsApp export.
    An export is read as a chat by its form, here or dropped anywhere on the page.
  - Then `RedactionPreview`, the drafted `NoteEntry`s, `DuplicateHint` and `MissingList`.
  - A chat guessed from a doc offers 「トークではなく資料として読む」. A pasted doc with lines like 名前: 本文 offers the
    other way, 「トークとして読む」, with one `--ink-2` line saying why.
- **`RedactionPreview`**: counts line 「名前 12件・電話番号 2件を隠しました」 with the numbers in `--green`, speaker rows
  with role pickers, the scrollable text with blackout bars, the consent checkbox, 「この内容だけを送る」.
- **`DuplicateHint`**: a red-pen note on the drafted entry, 「似たメモがあります：保健所申請の締切（2025年度 会計）」,
  with 「更新する」 and 「別のメモとして残す」.
- **`MissingList`**: blank lines, each 「〆 保健所申請の締切が書かれていません」 with a blue 「先輩に聞く」.
- **`HandoverGuide`** (引き継ぎ書, `/s/[seat]/guide`): a document, not a dashboard.
  - **Header:** 「会計の引き継ぎ書」 (25px), the group and institution, 「2026年10月18日時点」 and the counts. Under it, a caption
    with the page's rules: only notes you may read, withdrawn and replaced notes left out, a saved copy keeps today's
    version.
  - **Export:** 「印刷・PDFで保存」 (primary) and 「テキストで保存（.md）」, then the filter (種類 · 書いた人 · 並び順, `.dd-filter`).
    Both are never printed.
  - **Content:**
    1. `UpcomingList`
    2. one section per kind, headed by its mark and word (〆 締切). Each note is a `NoteEntry` slip: the title in bold
       UI, the deadline as written in figures with the highlighter, the body in the hand on the ruled grid, the byline
       and the 64px date stamp at the foot.
    3. 「まだ書かれていないこと」 as blank lines with their reason and a dashed stamp outline; the viewer's own unanswered
       questions in blue
    4. 「あなたの質問と答え」 as `AnswerEntry`s, whose stamps open their notes
  - **Who wrote it:** people appear only as bylines (「2025年度 会計」).
  - **On 聞く (`GuideSheet`):** the way in is the guide's **cover**, a slip right under the ask field that says what it is
    (Nico's call: the deadlines and the lineage stay above the field, and the cover comes under it, so the field stays
    above the verb tabs on a 664px phone):
    - a 4px `--blue` spine on its left edge, so it reads as a book to open, not one more note;
    - a line book icon (left out below 360px, where the spine alone says it);
    - 「会計の引き継ぎ書」;
    - one `--ink-2` line, 「先輩たちが残したメモを、一冊にまとめて読めます」;
    - at the end, a blue 「読む」 with a chevron pointing right.

    The whole slip is the button (`aria-haspopup="dialog"`). A tap opens the guide as a **reading sheet** over 聞く,
    which itself never moves (no screen change, no unfolding):
    - Full height on a phone; a 560px panel on the right from 720px, with 聞く faded beside it (the paper at 72% as a
      backdrop, solid under `prefers-reduced-transparency`). It slides in over 200ms, at once under
      `prefers-reduced-motion`.
    - A native modal `<dialog>`: the page behind is inert and doesn't scroll. Focus goes to the sheet's title, and comes
      back to the cover on closing.
    - Its header stays while the guide scrolls under it: 「会計の引き継ぎ書」, 「保存」 (prints the guide alone, or saves a
      PDF; named 「印刷・PDFで保存」) and ✕ (「引き継ぎ書を閉じる」).
    - It closes with ✕, Esc, a tap on the backdrop, the phone's back button (the sheet has its own address, `#guide`,
      which also opens it from a link), or 「引き継ぎ書を閉じる」 at the guide's end.
    - The guide loads when the sheet opens. Its title, group and institution go on paper only (the sheet's header and
      the key tag say them). The filter folds under one 44px blue line, 「絞り込みと並び順」. The export buttons come
      after the notes: read first, then save.

    Printing from the sheet puts only the guide on paper, with its full header, across as many pages as it needs.
    `/s/[seat]/guide` stays as its own page, for a direct link and the source line on paper: export first, the filter
    open.
- **`WithdrawMeter`**: figures face, 39px on the console; counts in `--red` from the click, freezes in `--ink`
  when the last pane drops the note: 「0.8秒」.
- **`LeakCounter`**: 「漏れ 0 / 50 回」, the 0 in `--green`.
- **`PersonaPane`** (console): a plain rounded rectangle in `--sheet`, 390 wide and up to 844 tall (shorter on a laptop
  whose window leaves less room, so the whole proof stays on one screen; the pane scrolls inside), with a 1px `--rule`
  border and the persona above it in UI text: 新しい会計 · 去年の会計 · 部外者. No device chrome. Below about 1270px
  the three panes scroll sideways instead of wrapping. Signed out (real data), the console keeps its title at the
  proof's x and, where the first pane goes, a 390px column like `SignIn` (the full width on a phone): a
  one-sentence lead naming the three, one password field (the writing line in the UI face) and a full-width primary
  「3人でログインする」; no page scroll at 1920. It is all three or none: when one can't sign in, nobody is signed in,
  and a calm `--ink-2` line says so and what to do. The checking and signing-out captions and the offline line with
  「もう一度ためす」 are `SignIn`'s. Signed in, 「ログアウト」 sits beside the meter and the leak counter and ends this
  device's three sessions only.
- **`MeasuredNumbers`** (console): 「測定の内訳」, a collapsed `<details>` under the meter and the leak counter with
  one line per check that `pnpm metrics` measured (leaks, withdrawal, citations, live loop, privacy), read from
  `metrics/latest.json` only, with when it was measured. A check that didn't run says 「未測定」. Green only for 漏れ 0 and
  the privacy counts. On real data it also says that a reset is `pnpm demo:reset` in a terminal.

## Motion
One signature moment, everything else functional.
- **Signature, the stamp landing** (live answer, publish): scale 1.12 → 1, rotate -8° → -3°, opacity 0 → 1,
  180ms `cubic-bezier(.2,.8,.2,1)`, then a 1px ring that fades (the ink settling).
- **Double line** (withdraw, update): two red lines draw left to right, 220ms, then the entry collapses (200ms).
- **Listening**: one ring pulses from the voice button every 1.2s while recording.
- **Inbox arrival**: the slip slides 8px down into place (160ms) and the phone vibrates where supported.
- **Changing verb tabs** (Nico's call): the page slides out to one side while the chosen one slides in from the other,
  by the tabs' order (聞く · 残す · 自分のメモ; a tab to the right brings its page in from the right), 300ms
  `cubic-bezier(.2,.7,.2,1)`, through the browser's View Transitions (`PageTurn` → `slideTo`). The top bar and the tabs
  stay put above it, and the tab's highlight moves across. A click with a modifier key opens the link as usual.
- **Other page changes** (the guide page, a redirect), or a browser without View Transitions: the new page's content
  fades in, opacity only, 160ms (`PageTurn`). After sign-in the account's page fades in the same way (`.dd-fade-in`).
- **The guide's reading sheet** slides in over 200ms (up on a phone, from the right from 720px).
- No fade or slide on the first page load, and no slides beyond these and the inbox's 8px arrival; no hover lifts, no
  confetti, no bouncing.
- `prefers-reduced-motion`: every motion becomes an instant state change; the stamp simply appears.

## Copy voice
Polite plain Japanese (です・ます), short sentences, the user's own words: 先輩, 後輩, 引き継ぎ, 年度, 締切.
Never "AI", "アシスタント", "チャット" or "生成" in the interface; answers come from 先輩. Buttons say exactly what
happens (「公開する」 → 「公開しました」). Errors say what happened and what to do. No exclamation marks except on
the 恩送り slide. English mirrors the Japanese. All strings live in `messages/*.json`.

## One interface rules
- Same screens for every seat type; differences come only from the label pack (`seatTypes.<type>`) and `seats.settings`.
- Three verbs only: 聞く · 残す · 自分のメモ.
- Progressive disclosure: scope, expiry and "critical" controls appear only while writing, and only when the
  seat's settings enable them. Scope defaults to `successor`.
- No feeds, badges, follower counts, folders or settings pages for newcomers.
- Exception, by choice: the two display switches and 「あなた」 in `SeatBar` (language and theme are the viewer's
  device settings, not the seat's; 「あなた」 is the account on this device, not a page).
- Anything that decides what a user sees is visible and usable on screen, never only in a terminal, a URL fragment
  or a cookie: the language and theme switches, the measured numbers on the console. What stays a terminal command
  (`pnpm demo:reset`, which needs the service-role key) is said on screen where it matters.

## Accessibility
- Text at least 4.5:1 in both themes (see Color). Focus: a 2px `--blue` outline with 2px offset on every control.
- Marks and stamps have text equivalents (`aria-label`: 「締切」, 「2025年度 会計のメモ」).
- Highlighter and colour never carry meaning alone: deadlines also show 〆 and the date; the rule change also
  shows 「変更」.
- Voice always has the text fallback in the same place.
- Every page names itself (`generateMetadata`): 「会計（テニスサークル Smash）｜代々」, 「残す・会計（…）｜代々」, 「自分のメモ｜代々」;
  Next's route announcer reads it on each navigation, and a shared seat link gets a preview. The app installs from the browser
  (`app/manifest.ts`). Its icon is the app's mark (Nico's call: simple, with a unique touch): a filled `--blue` note with
  its top-right corner folded down (`--blue-wash`), and on it 々 in `--sheet`, written in Klee One, the notes' hand. 々 is
  the mark that repeats the character before it, "generation after generation": a note handed down. It is deliberately
  not the seat's key tag, which 聞く shows right under it.
- The same mark stands in the top left of every screen in place of the word 「代々」 (Nico's call): `AppIcon`, an inline
  SVG in the theme's tokens (so it follows the dark screen), 32px in a 44px target (40px beside the console's title).
  On a seat page (`SeatBar`) and in the console's title row it is the link to the start page, named 「代々」 for a screen
  reader (title 「はじめのページへ」) with a `--blue-wash` hover; on the start page it is a plain mark. The PNG icons
  (`app/app-mark.tsx`: favicon, home screen, link preview) draw the same shapes from `markSvg`, in the light colours.
- Every seat page has two navs, each labelled: `SeatBar` (「表示とあなた」) and `VerbTabs` (「この席でできること」).
- Print: paper only. `SeatBar`, `VerbTabs` and every `.dd-noprint` control are hidden, the light tokens are forced
  (the blackboard's pale ink would print grey on white), and an entry isn't split across sheets.
- `viewport-fit=cover`, so the bottom tabs keep `env(safe-area-inset-bottom)` above an iPhone's home indicator; the
  browser bars take `--paper` of the theme shown.

## Don'ts (they make Daidai look generic or generated)
- Chat bubbles, typing dots, robot or sparkle icons, "Ask AI" labels.
- Gradients, glass blur, glow, soft drop shadows, cards with one radius on everything.
- Cream paper with a serif display and a terracotta accent; near-black with a single neon accent.
- Mincho display type, red hanko squares, cherry blossoms, waves or other "Japanese" decoration.
- Emoji as markers, all-caps or tracked eyebrow labels, arrows appended to buttons, middle-dot meta strings.
- A different colour per kind or per seat type.

## Later (not built this weekend)
`SeatSwitcher`, `InviteCard`, `OnkuriCredit` (slide only), `UsageLine`, the 「古い？」 button.
