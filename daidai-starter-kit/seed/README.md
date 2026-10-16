# Seed data / デモ用データ

All seed data is made up. No real people, clubs or labs. / すべて架空のデータです。実在の人・団体・研究室の名前は使わないでください。

## `notes.csv`: predecessors' notes / 先輩のメモ（約30件）
| column | 意味 | example |
|---|---|---|
| `id` | 英数字の短いID（questions.csv から参照） | `smash-2025-hokenjo` |
| `seat_slug` | 席 | `smash-kaikei`, `gakusai-mogiten`, `tum-ist-autumn`, `lab-bioprinter` |
| `term_label` / `term_order` | 年度（表示用 / 並び順の数字） | `2025` / `2025`, `2025秋` / `2025` |
| `author` | 書いた人（ペルソナ a24, a25 か、架空の f25, ex25, lab25 など） | `a25` |
| `kind` | `deadline`（締切）, `contact`（連絡先）, `rule_of_thumb`（コツ）, `pitfall`（落とし穴）, `unwritten_rule`（暗黙のルール） | `deadline` |
| `title`, `body` | 短く、具体的に（いつ・どこ・誰に） | |
| `deadline_date` | `deadline` のときだけ（YYYY-MM-DD） | `2025-10-20` |
| `scope` | `successor`（次の人だけ）, `group`（団体全体）, `institution`（大学全体）, `public`（公開） | `successor` |
| `critical`, `valid_until` | 研究室の席だけ使う | `true`, `2026-03-31` |
| `canary` | リークテスト用の合言葉（そのメモの本文にも入れる） | `KIKYO-7731` |

Must include / 必ず入れるもの:
- 2024 → 2025 で変わったルール 1つ（例: 保健所申請の締切）
- 誰も答えられない質問 2つ（questions.csv に書き、notes.csv には答えを書かない）
- 4つの scope すべて、全部で3〜5個のカナリア（`successor` か `group` のメモに）
- 留学ルート（`tum-ist-autumn`）と研究室（`lab-bioprinter`）の席に2〜3件ずつ

## `questions.csv`: demo and test questions / デモとテストの質問（10個）
`persona` は a24, a25, a26（新しい会計）, b（別サークル）, x（部外者）。
`expected` に期待する答え、`expected_notes` に根拠のメモID（`;`区切り）、答えられない質問は `abstain`。
These questions are the acceptance tests for F2, F4 and F5. / F2・F4・F5 の合格テストになります。

Google スプレッドシートで作って CSV で書き出しても大丈夫です。

## ほかのファイル / Other files
- `old-handover.sample.md`：コールドスタートのデモで貼り付ける、架空の「去年の引き継ぎ資料」。わざと雑に書いてあり、保健所申請の締切がありません。
  A made-up, deliberately messy 2024 handover doc for the cold-start demo (F5). It has no 保健所 deadline on purpose.
- `handover-2024.sample.docx`：上の資料と同じ内容の Word ファイル。名前と電話番号をわざと入れてあり、ファイルでも隠されることを確認します。
  The same handover as a Word file, with a planted name and phone number to test redaction for files.
- `notice-2026.sample.pdf`：架空の学生課のお知らせ（文字が選べるPDF）。保健所申請の締切が 10/19 に変わったので、あとから追加すると 2025年度のメモを「更新する」かどうか聞かれます。
  A made-up 学生課 notice (PDF with a text layer) that moves the 保健所 deadline to 10/19, for the "add any time" update test.
- `scan.sample.pdf`：文字のない（画像だけの）PDF。「文字を読み取れません」のメッセージを確認します。
  An image-only PDF to check the "no readable text" hint.
- `chat-line.sample.txt`：架空の LINE グループのトーク履歴（`.txt` の形式）。わざと名前・電話番号・メール・LINE ID・口座番号・暗証番号を入れてあり、取り込むときに全部隠されることを確認します。
  A made-up LINE group export with planted names, a phone number, an email, a LINE ID, an account number and a safe PIN.
- `chat-canaries.txt`：取り込みのあとで、どこにも出てきてはいけない文字列の一覧（`pnpm test:redact` が使います）。
  The strings that must never leave the browser; used by `pnpm test:redact`.
- `live-answer.txt`：ライブループで石橋さん（a25）が声で答える文。`pnpm test:loop` も同じ文を使います。
  The answer Ishibashi (a25) speaks in the live loop; `pnpm test:loop` uses the same text.
- `private/`：本物の引き継ぎ資料や LINE のトーク履歴を置く場所。Git には入らず、Claude Code も読めない設定です。グループの OK があるときだけ使います。公開してよいと言われた場合だけ `old-handover.real.md` として追加します。
  Real handover docs (anonymised) go here; the folder is gitignored. Only add one as `old-handover.real.md` if its owner agreed to publish it.

`questions.csv` の `demo_step`：`ask`（質問）、`live`（ライブループ）、`trust`（部外者には何も見えない）、`leak`（リークテスト）。
