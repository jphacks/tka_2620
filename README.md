# 代々（Daidai）

[![IMAGE ALT TEXT HERE](https://jphacks.com/wp-content/uploads/2026/07/IMG_5316.png)](https://www.youtube.com/watch?v=piaNsc6ilBI)

## 製品概要
### 背景(製品開発のきっかけ、課題等）

人間は社会的な動物であると同時に、その社会の中で一定のロールを付与されています。そして、人が入れ替わっても社会が回り続けるように、人間社会には引き継ぎと呼ばれるシステムが存在します。
しかしながら、引き継ぎを書くにしても、どのような情報が必要なのか、どれほどの完成度を求められているのか、などといった判断基準の不在によって、その作業には多大な労力がかかります。
サークルの会計、学祭の責任者、帰国した留学生、卒業する研究室メンバーなど、毎年のように仕組みを知っている人が入れ替わる中で、引き継ぎは大きな重要性を占めます。
また、新しく入った人は手元にある引き継ぎを頼りに、その環境で活動していく必要があります。
そんな時、引き継ぎを自律的に作ってくれるものがあれば、また、わからないときには前任の人と中継してくれるものがあれば、良いと思ったことはありませんか？
私たちは、多様な場面での引き継ぎに関わる手間や精神的負担にアプローチします。

### 製品説明（具体的な製品の説明）

代々 (Daidai) は引き継ぎにおける継承・統合・接続という役割を一つのシステム内で完結させることによって、シームレスでスマートな体験を提供することを目的としています。
主な機能は生の資料群をアップロードすることで自動で引き継ぎを作成する機能、わからないことがあれば前任者に連絡を中継する機能、共有範囲を広げることで例えば大学内での共通事項などは団体内外でも共有する機能です。
引き継ぎを作るには、使用した生のデータなどを直接代々に読ませるだけ。個人情報などは自動で判断して黒塗りにします。会話などには登場するのに、共有されていないデータなどを自動で検出して、通知する機能もあります。それでも、完璧な引き継ぎを作ることは至難の業です。そのため、わからないことがあれば、代々に聞いてください。自動で前の担当者に確認を行い、そこで得られた情報も以降参照可能なように記録します。
このような処理フローによって、成長し続ける引き継ぎシステムが生まれます。

一般的なAIは「自分たちの先代」を知りません。ただ、記録を読むだけです。私たちの代々では、AIは蓄積された情報を参照し、わからなければ聞きに行き、またそれを記録する。そのようなループによって、精度と有用性を高めていきます。

### 技術特長

#### 1. 特長1
インプットされた生のデータから、情報を「メモ」という単位で保管します。答えのすべての文に根拠となった先輩のメモが付き、タップすると元のメモを開けます。元の資料やファイル自体はブラウザの外に出さず、保存もしません。
#### 2. 特長2
名前や連絡先などの個人情報は端末の中で自動で塗りつぶしてから送り、サーバー側でももう一度確かめます。さらにメモごとに共有範囲を設定でき、範囲外の人には見えないことを、漏洩テストで確認しています。例えば会話などでは、名前に「会計」や「部長」などの役職を黒塗りの代わりに表示させることも可能です。
#### 3. 特長3
改まった文章を打つ手間を省くため、質問には写真などを添付できます。誰も知らない質問は前任者のスマホに届き、前任者は声で答えるだけでメモとして残せます。

### 解決出来ること

引き継ぎ資料はわかりやすく、完璧でなくてはならない。けれど、過去の記録を漁って書き起こしていくのは手間。そのような、引き継ぎ制作に関わる問題を解決します。加えて、わからないことが、読み込み不足に起因するのか、本当に引き継ぎの中に無いのかを判断する心労を、自動で判断してくれることによって軽減できます。

### 今後の展望

実際にインタビューを行ってくれた知人のうち、現在引き継ぎを書くフェーズにいる数名に実際に使ってもらい、フィードバックなどを得ることでシステムの改善や、信頼性の確保を行なっていきたいと考えています。

### 注力したこと（こだわり等）
* 安全性や信頼性を見やすい形で確認できるようにしています。
* 画面遷移を少なくし、操作へのストレスを最小限にします。
* 分からないものは前任者に問い合わせ、ハルシネーションが起こらないよう工夫しました。
* マネージドでデータを蓄積し、一般ユーザは管理を考えずに済みます。

## 数字で見る代々 / Numbers
| 指標 / Metric | 結果 / Result | 測り方 / How measured |
|---|---|---|
| 部外者からの漏れ / Leaks to outsiders | 0 / {outsider_attempts} 回 | `pnpm test:leak` ({total_attempts} attempts across 5 personas) |
| 撤回が回答から消えるまで / Withdrawal to gone | 中央値 {withdraw_median_s} 秒（最大 {withdraw_max_s} 秒、{withdraw_runs} 回） | `pnpm metrics` |
| 出典つきの文 / Answer sentences with a source note | {citation_coverage}%（{cited_sentences} / {sentences}） | `seed/questions.csv` |
| トークとファイルの匿名化 / Chat and file privacy | {chats} 件のトークと {files} 件のファイルで名前・連絡先・秘密 {hidden} 件を隠し、端末の外に出たものは {left_browser} 件 / {hidden} items hidden in {chats} chats and {files} files, {left_browser} left the browser | `pnpm test:redact` |
| ライブループ / Live loop | {loop_runs} 回中 {loop_failures} 回失敗、中央値 {loop_median_s} 秒 | `pnpm test:loop` |

## 開発技術
### 活用した技術
#### API・データ
* Claude API（Anthropic）：出典つきの回答、メモの下書き、資料・トーク履歴からの抽出（Sonnet）、追加質問と質問の整理（Haiku）
* Ollama + bge-m3：メモと質問のベクトル化（1,024次元、日本語と英語）
* Supabase：Postgres + pgvector（検索）、行単位セキュリティ（RLS）による共有範囲の制御、Realtime（受信箱と回答の即時反映）、認証
* Web Speech API（`ja-JP`）：先輩が声で答える音声入力
* デモ用データ：架空のサークル・学祭・研究室・留学ルートの引き継ぎメモ、質問、トーク履歴（`seed/`、すべて合成データ）

#### フレームワーク・ライブラリ・モジュール
* Next.js 16（App Router、Turbopack）、React 19、TypeScript
* Vercel AI SDK（`ai`、`@ai-sdk/anthropic`）、Zod（API とモデル出力の型の検証）
* next-intl（日本語・英語）、Tailwind CSS 4、lucide-react
* pdfjs-dist（PDF）、mammoth（Word）：ファイルの文字をブラウザの中で抜き出す
* qrcode.react（席の QR コード）
* Vitest（テスト）、Biome（lint・整形）

#### デバイス
* スマートフォン（iPhone・Android）：席のページで質問する後輩と、受信箱で声で答える先輩
* NFC タグ：部室の鍵に貼り、スマホをかざすと席のページ（`/s/smash-kaikei`）が開く。QR コードでも同じページを開けます
* ノートPC：3人の画面を並べたデモ用のコンソール（`/console`）

### 独自技術
#### ハッカソンで開発した独自機能・技術
* 独自で開発したものの内容をこちらに記載してください
* 特に力を入れた部分をファイルリンク、またはcommit_idを記載してください。

## ハッカソン中に作ったもの / Built during Hack Day
| 機能 / Feature | 内容 / What it does |
|---|---|
|[F1 公開範囲のしくみ](https://github.com/jphacks/tka_2620/issues/13)|メモの公開範囲（次の人だけ／団体／大学／一般）をデータベース側で判定し、見る人に応じて読めるメモだけが返る仕組みを導入した。 / Who may read a note (the next holder only / the group / the university / anyone) is decided in the database, so a search returns only the notes that viewer is allowed to read.|
|[F2 出典つきの回答](https://github.com/jphacks/tka_2620/issues/18)|メモを探して全部の文に出典をつけた回答をつくり、根拠が1つも残らなければ「誰も知りません」と答え、年度で変わったルールは知らせるようにした。 / The answer is built only from the notes we found, every sentence carries a citation, 「誰も知りません」(nobody knows) comes back when no cited sentence is left, and a rule that changed between years is flagged.|
|[F3 ライブループ](https://github.com/jphacks/tka_2620/issues/2)|後輩の答えのない質問が先輩のスマホに届き、先輩が声で答えるとその答えがメモとして残り、後輩の画面にすぐ反映されるところまでを一続きで動かせるようにした。 / A newcomer's unanswered question reaches the predecessor's phone, the predecessor answers by voice, and that answer becomes a note that appears on the newcomer's screen right away: the whole path runs end to end.|
|[F4 信頼の証明](https://github.com/jphacks/tka_2620/issues/24)|部外者にはメモが一切見えないことと、撤回したメモがすべての答えから1秒足らずで消えることを、テストと数字で確かめられるようにした。 / Two promises are now checkable by tests and numbers: an outsider sees no note at all, and a withdrawn note is gone from every answer in under a second.|
|[F5 すでにあるものを追加](https://github.com/jphacks/tka_2620/issues/30)|貼り付けたテキストやPDF・Word・トーク履歴から、送る前に端末の中で名前や連絡先を隠してメモを作り、書かれていないことも一覧で知らせるようにした。 / Pasted text, PDF / Word files and chat exports become notes after names and contact details are hidden on the device, before anything is sent, and what is still missing is listed as well.|
|[F6 引き継ぎの質問](https://github.com/jphacks/tka_2620/issues/39)|先輩には「後輩が何を聞いたか」を理由つきの3つの質問として出し、声で答えるだけでメモの下書きになり、公開範囲を選んで残せるようにした。 / The predecessor is asked what newcomers wanted to know, as three questions in priority order with a reason for each; answering by voice becomes a drafted note, and the predecessor chooses who can read it.|
|[F7 席ページと NFC の入り口](https://github.com/jphacks/tka_2620/issues/44)|部室の鍵に貼ったNFCシールをスマホでかざすと席ページが開き、歴代の会計の系譜・これからの締切・質問欄が出るようにした。 / Holding a phone to the NFC sticker on the club-room key opens the seat page, showing the line of past treasurers, the deadlines taken from their notes, and the ask box.|

全差分 / Full diff: https://github.com/jphacks/tka_2620/compare/pre-hackday...main

## 事前に用意したもの / Prepared before Hack Day (setup)
| 内容 / What | コミット / Commits |
|---|---|
| スターターキット（AGENTS.md・SPEC / DESIGN / WORKFLOW などのルール、AI ツールの設定、デザイントークン、日英の文言、サンプル資料）/ Starter kit (rules in AGENTS.md, SPEC / DESIGN / WORKFLOW, AI tool config, design tokens, ja / en copy, sample files) | [ba9b9a0](https://github.com/jphacks/tka_2620/commit/ba9b9a0) |
| Next.js・TypeScript・Tailwind の骨組み（席ページ・コンソール・自分のメモの空の画面）/ Next.js, TypeScript and Tailwind skeleton (empty seat page, console and my-notes screens) | [214d33e](https://github.com/jphacks/tka_2620/commit/214d33e) |
| Supabase のテーブル（ポリシーなし）と、Claude・Ollama の接続確認 / Supabase tables without policies, and a Claude / Ollama connection check | [862b135](https://github.com/jphacks/tka_2620/commit/862b135) |
| デモ用データを入れるスクリプトと bge-m3 のベクトル化（`pnpm seed`）/ Seed script and bge-m3 embeddings (`pnpm seed`) | [277268e](https://github.com/jphacks/tka_2620/commit/277268e) |
| 開発の足回り（Playwright MCP で画面を確認、トンネルでスマホから開く）/ Dev setup (screenshots through Playwright MCP, dev tunnel so a phone can open the app) | [277268e](https://github.com/jphacks/tka_2620/commit/277268e)・[5e7d783](https://github.com/jphacks/tka_2620/commit/5e7d783) |
| README の骨子（スターターキットの説明は削除）/ README skeleton (the starter kit's own readme was deleted) | [109c388](https://github.com/jphacks/tka_2620/commit/109c388)・[a39a38e](https://github.com/jphacks/tka_2620/commit/a39a38e) |
