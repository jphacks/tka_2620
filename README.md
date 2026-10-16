# 代々（Daidai）

[![IMAGE ALT TEXT HERE](https://jphacks.com/wp-content/uploads/2026/07/IMG_5316.png)](https://www.youtube.com/watch?v=piaNsc6ilBI)

## 製品概要
### 背景(製品開発のきっかけ、課題等）
### 製品説明（具体的な製品の説明）
### 特長
#### 1. 特長1
#### 2. 特長2
#### 3. 特長3

### 解決出来ること
### 今後の展望
### 注力したこと（こだわり等）
* 
* 

## 数字で見る代々 / Numbers
| 指標 / Metric | 結果 / Result | 測り方 / How measured |
|---|---|---|
| 部外者からの漏れ / Leaks to outsiders | 0 / {outsider_attempts} 回 | `pnpm test:leak` ({total_attempts} attempts across 5 personas) |
| 撤回が回答から消えるまで / Withdrawal to gone | 中央値 {withdraw_median_s} 秒（最大 {withdraw_max_s} 秒、{withdraw_runs} 回） | `pnpm metrics` |
| 出典つきの文 / Answer sentences with a source note | {citation_coverage}%（{cited_sentences} / {sentences}） | `seed/questions.csv` |
| トークの匿名化 / Chat privacy | {chats} 件のトークで名前・連絡先・秘密 {hidden} 件を隠し、端末の外に出たものは 0 件 / {hidden} items hidden in {chats} chats, 0 left the browser | `pnpm test:redact` |
| ライブループ / Live loop | {loop_runs} 回中 {loop_failures} 回失敗、中央値 {loop_median_s} 秒 | `pnpm test:loop` |

## ユーザーの声 / User evidence
- {n} 人のサークル・学祭の役員に話を聞きました。/ We talked to {n} club and festival officers.
- 「{quote 1}」（{role}）
- 「{quote 2}」（{role}）
- {club} が11月の代替わりで試す予定です。/ {club} will try Daidai at its November handover.

## 開発技術
### 活用した技術
#### API・データ
* 
* 

#### フレームワーク・ライブラリ・モジュール
* 
* 

#### デバイス
* 
* 

### 独自技術
#### ハッカソンで開発した独自機能・技術
* 独自で開発したものの内容をこちらに記載してください
* 特に力を入れた部分をファイルリンク、またはcommit_idを記載してください。

## ハッカソン中に作ったもの / Built during Hack Day
| 機能 / Feature | 内容 / What it does | コミット / Commits |
|---|---|---|
| F3 ライブループ / Live loop | … | [abc1234](https://github.com/jphacks/tka_2620/commit/abc1234) |
| F2 出典つき回答 / Grounded answers | … | … |

全差分 / Full diff: https://github.com/jphacks/tka_2620/compare/pre-hackday...main

## 事前に用意したもの / Prepared before Hack Day (setup)
| 内容 / What | コミット / Commits |
|---|---|
| スターターキット、Next.js と Supabase の骨組み、テーブル（ポリシーなし）、デモ用データ / Starter kit, Next.js and Supabase skeleton, tables without policies, synthetic seed data | … |
