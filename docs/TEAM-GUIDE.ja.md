# Daidai チームガイド（JPHACKS 2026・tka_2620）

はじめてのハッカソンでも大丈夫なように、やることを短くまとめました。
わからないことは、15分ひとりで悩まずに、すぐ聞いてください。

**テーマ：「誰も書かない引き継ぎ」**
**いちばん大事なこと：① 本物の役員の声（引用）② ライブループが毎回ちゃんと動くこと**

- ライブループ：後輩の質問に「歴代の会計は誰も知りません」→ 去年の会計のスマホに質問が届く → 声で答える → 後輩の画面に「2025年度 会計」の答えが届く
- 今週末に作るのは、この1本の流れ（ゴールデンパス）だけです。留学・研究室の席と恩送り画面はスライドだけ
- 「＋ 追加」：貼り付けたテキスト、PDF・Word・テキストファイル、LINE などのトーク履歴から、いつでもメモを追加できる（最初の年だけではない）。ファイルは端末の中で読み、名前や電話番号を隠してから送る

---

## 0. 役割

- **ニコ：エンジンとまとめ役**
  - 回答のしくみ（出典つき）、公開範囲、ライブループの裏側、撤回、漏れテスト、数字の計測
  - リポジトリの準備、PRのレビューとマージ、デモ動画、README
  - 発表ではデモを操作する。話すのは日本語の一言だけ：「去年の会計に、聞いてみます。」
- **影広さん：画面と発表**
  - 質問の受信画面と声で答える画面（スマホ）、席ページ、引き継ぎ画面、資料の貼り付け画面、デモ画面
  - 見た目のルールは `docs/DESIGN.md`（部室ノート：昼はノート、夜は黒板）。色とクラスは `styles/tokens.css` と `styles/components.css` にあります。Claude Code は自動でこのルールを読みます
  - 中間発表（土 19:10）と最終発表（日 16:00）で、台本（`docs/pitch/script.md`）を日本語で読む
- **石橋さん：データ・日本語・聞き取り・「去年の会計」役**
  - デモ用のメモと質問（`seed/`）、去年の資料のサンプル、画面の日本語（`messages/ja.json`）
  - 先輩や役員への聞き取り（`docs/EVIDENCE.md`）、動画の字幕、スライド
  - チェックポイントごとに「新しい会計」になって使ってみて、わかりにくい所を伝える
  - 発表では「去年の会計」役：スマホに届いた質問に、声で答える（答える文は `seed/live-answer.txt`）

---

## 1. 今日中に準備するもの

- **3人とも：サークルや学祭の役員に3〜5人連絡する**（メッセージは `docs/EVIDENCE.md` にあります）
  - ほしいもの：本物の声を2〜3個、去年の引き継ぎ資料1つ（名前を消したもの）、できれば「11月の代替わりで試してみる」と言ってくれるサークル
  - 引用は名前を出さず、本人のOKをもらう

- VS Code（1.94 以上）
- Node.js 22 以上（[nodejs.org](https://nodejs.org) の LTS）と pnpm：`npm install -g pnpm`
- Git（Windows は [Git for Windows](https://git-scm.com/downloads/win)）
- GitHub アカウント（`jphacks/tka_2620` に Write 権限があること）
- Claude のアカウント（**無料プランでは Claude Code は使えません**）
  - Claude Pro 以上を持っている → そのアカウントでOK
  - 持っていない → ニコが Claude Console のチームに招待します（使いすぎ防止の上限つき）
  - アカウントの共有はしないでください

---

## 2. VS Code に Claude Code を入れる

- VS Code で `Ctrl+Shift+X`（Mac は `Cmd+Shift+X`）→「Claude Code」を検索 → Anthropic の公式拡張機能をインストール
- 開き方（どれでもOK）
  - ファイルを開いて、右上の ✻ アイコンをクリック
  - 左のバーの ✻ アイコン
  - 右下の「✻ Claude Code」
- はじめて開いたら「Sign in」→ ブラウザでログイン
- 基本の使い方
  - **日本語で話しかけてOK**
  - `@` でファイルを指定できる（例：`@docs/SPEC.md`）
  - コードを選んで `Alt+K`（Mac は `Option+K`）→ その行を参照に入れる
  - 入力欄の下のモード表示をクリック →「Plan」で**計画モード**（ファイルを変える前に計画だけ見せてくれる）。`/plan` と入力してもOK
  - 変更は左右の比較（diff）で出る →「Accept」か「Reject」
  - 失敗したら：メッセージにマウスを乗せる → 巻き戻しボタン →「Rewind code to here」
  - リポジトリの `AGENTS.md` と `CLAUDE.md`（チームのルール）を自動で読みます
- ターミナルでも使いたい人だけ（なくてもOK）
  - Mac：`curl -fsSL https://claude.ai/install.sh | bash`
  - Windows（PowerShell）：`irm https://claude.ai/install.ps1 | iex`
  - 確認：`claude --version`

---

## 3. GitHub とつなぐ

Claude Code は、自分のPCの **git** と **GitHub CLI（`gh`）** を使って GitHub を操作します。特別な連携アプリは要りません。

- Git の名前とメールを設定（はじめてのときだけ）
  ```
  git config --global user.name "あなたの名前"
  git config --global user.email "GitHubに登録したメール"
  ```
- GitHub CLI を入れる
  - Mac：`brew install gh`
  - Windows：`winget install --id GitHub.cli`
- ログイン：`gh auth login` →「GitHub.com」→「HTTPS」→ ブラウザでログイン
- リポジトリを持ってくる
  ```
  gh repo clone jphacks/tka_2620
  cd tka_2620
  code .
  ```
- 動かしてみる
  - `pnpm install`
  - `.env.local` はニコから直接もらう（**Slack に貼らない・コミットしない**）
  - 画面を作るだけなら `.env.local` に `NEXT_PUBLIC_USE_MOCKS=1`（仮のデータで動く）
  - `pnpm dev` → ブラウザで http://localhost:3000
- GitHub の「@claude」アプリ（`/install-github-app`）は使いません（組織の管理者権限が必要なため）

---

## 4. ブランチとマージ

**ルール**
- `main` と `dev` に直接 push しない。`main` はいつでもデモできる状態にする
- 1つの Issue = 1つのブランチ = 1つの PR
- ブランチは `dev` から作り、PR も `dev` に向けて出す（`main` ではない）。`dev` から `main` へのマージはニコがする
- ブランチ名：`名前/F番号-内容`（例：`kage/f3-inbox`、`ishi/seed-notes`）
- マージするのはニコ（Squash and merge）。`git push --force` は禁止
- コミットメッセージは英語で `[hackday] F7 ...`（Claude に書いてもらえばOK）

**A. Claude Code に頼む（いちばん簡単）**
- 「dev を最新にして、`kage/f3-inbox` ブランチを作って」
- 「ここまでの変更をコミットして」
- 「push して、dev に向けて PR を作って。PR テンプレートを埋めて、確認した結果も書いて」
- 「dev の変更を取り込んで。コンフリクトがあれば解決して」
- ニコだけ：「PR #12 をレビューして、問題なければ squash merge して」
- Claude はコマンドを実行する前に確認してきます → **内容を読んでから「許可」**

**B. VS Code の画面で**
- 左下のブランチ名をクリック →「Create new branch from…」→ `origin/dev` を選ぶ → 名前を入力
  - その前に：ソース管理（`Ctrl+Shift+G`）の「…」→「Fetch」で `dev` を最新に
- 作業したら：ソース管理 → 変更を確認 → メッセージを入力 →「Commit」
- 「Publish Branch」（はじめて）／「Sync Changes」（2回目から）
- GitHub のリポジトリページに出る「Compare & pull request」→ **base を `main` から `dev` に変える** → テンプレートを埋める →「Create pull request」

**C. ターミナルで**
```
git switch dev && git pull
git switch -c kage/f3-inbox
git add -A
git commit -m "[hackday] F3 add inbox card and voice answer"
git push -u origin HEAD
gh pr create --base dev --web   # dev に向けたPRをブラウザで作る
git pull origin dev         # 作業中に dev の変更を取り込む
gh pr merge 12 --squash --delete-branch   # ← ニコだけ
```

---

## 5. 1つの Issue の進め方（毎回おなじ流れ）

1. GitHub の Issues で自分の Issue を開く（Assignees が自分）
2. `dev` を最新にして、そこからブランチを作る
3. Claude Code で**新しい会話**を開き、計画モードでこれを送る
   ```
   あなたは Daidai の <エンジン / 画面 / コンテンツ> 担当です。
   AGENTS.md と docs/SPEC.md の F<番号>、lib/contracts.ts を読んでください。
   やること：<Issue のタイトル>
   完了の条件：<SPEC.md の「合格チェック」>
   編集してよいのは <自分のフォルダ> だけです。ほかの場所を変える必要があれば、止まって教えてください。
   まず短い計画を日本語で見せてください。
   ```
4. 計画を読む → SPEC.md と合っているか確認 → 違えば直してもらう → OK なら承認
5. Claude が作る → **すぐブラウザで見る** → 気になる所を伝える（スクリーンショットを貼ってもOK）
6. `pnpm typecheck` と `pnpm test` が通ったらコミット（30分に1回くらい）
7. 60〜90分以内に `dev` へ PR → ニコがマージ → 次の Issue へ

- 1つの会話では1つの Issue だけ。終わったら新しい会話にする
- 2回直してもうまくいかない → 巻き戻して、新しい会話で、もっと具体的に頼み直す

---

## 6. 一緒に働くルール

**自分のフォルダだけ触る**

| 担当 | フォルダ |
|---|---|
| ニコ（エンジン） | `supabase/` `lib/engine/` `lib/ingest/` `lib/redact/` `app/api/` `scripts/` `tests/` `metrics/` |
| 影広さん（画面） | `app/(seat)/` `app/console/` `components/` `styles/` `lib/realtime.ts` `lib/voice.ts` |
| 石橋さん（コンテンツ） | `seed/` `messages/` `docs/pitch/` `docs/EVIDENCE.md` |

- 共通ファイル（`lib/contracts.ts`・`lib/mocks.ts`・`docs/SPEC.md`・`AGENTS.md`）を変えるとき → PR と Slack でひとこと
- 画面の文字は `messages/ja.json` と `messages/en.json` に書く（コードに直接書かない）
- **チェックポイント**（5分）：土 12:30 / 14:00 / 16:30 / 18:30、日 11:30
  - 14:00 がいちばん大事：ライブループが本物のデータで1回動くこと（動かなければ、ニコと影広さんが一緒に直す）
  - デモ用PCで `main` を動かして、みんなで確認
  - Slack にひとり1行：「✅できた / ▶つぎ / ⛔困っている」
- 1時間に1回、`dev` の変更を自分のブランチに取り込む
- 15分つまったら、声をかける。隣の席なので、口で聞くのがいちばん速い
- Slack は日本語でOK（ニコは翻訳して読みます）
- 実名・本物の個人情報は入れない。APIキーや `.env.local` は Slack に貼らない
- 本物の LINE のトーク履歴や引き継ぎ資料は `seed/private/` だけに置く（Git に入らない）。グループの OK があるときだけ使い、Claude Code や ChatGPT に直接読ませない

---

## 7. 速く、こまめにテストする

- `pnpm dev` はつけっぱなし → 保存するとブラウザがすぐ更新される
- スマホの見た目：ブラウザで `F12` → デバイス表示 → 幅 390px
- 画面担当は**仮のデータ**で作る（`NEXT_PUBLIC_USE_MOCKS=1`）→ エンジンの完成を待たなくていい
- テストを自動で回す：`pnpm vitest`（保存するたびにテストが走る）
- 型のチェック：`pnpm typecheck`（エラーは VS Code の行の横にも赤く出る）
- デモの質問で試す：`seed/questions.csv` の質問を、そのペルソナ（a26・b・x）で聞いてみる
- データがおかしくなったら：`pnpm demo:reset`
- Claude に確認させる：「`pnpm typecheck` と `pnpm test` を実行して、結果を見せて」
- **小さく作って、すぐ見る**：1つ変える → 見る → コミット。大きな変更を一度に頼まない
- エンジンを変えたら：`pnpm test:leak`（部外者から50回以上試して、漏れが 0 件であること）
- 「＋ 追加」を変えたら：`pnpm test:redact`（トーク履歴やファイルの名前・電話番号などが、端末の外に 0 件しか出ないこと）
- ファイルの確認：`seed/` のサンプルを入れてみる（Word：`handover-2024.sample.docx`、PDF：`notice-2026.sample.pdf` →「更新する」が出る、文字のないPDF：`scan.sample.pdf` → 貼り付けの案内が出る）
- ライブループの確認：PC で新しい会計（a26）、スマホで去年の会計（a25）。`pnpm test:loop` で5回続けて動くか確認
- 声が使えないとき：スマホのキーボードのマイク（音声入力）で文字の欄に話す

---

## 8. 発表

- 中間発表（土 19:10）と最終発表（日 16:00）
  - 影広さん：台本（`docs/pitch/script.md`）を日本語で読む
  - ニコ：デモを操作する（日本語の一言：「去年の会計に、聞いてみます。」）
  - 石橋さん：「去年の会計」役。スマホに届いた質問に声で答えて、「公開する」をタップ
- 練習：土曜の中間発表のあとに **5回**、日曜 13:00〜14:30 にもう3回
- 動画：日曜 12:00 に1回で録画（ライブループ全部）。日本語と英語の字幕をつける
- デモがうまく動かないとき → すぐ録画に切り替える
