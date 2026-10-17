# User evidence / ユーザーの声

Real quotes from real officers lift the first two judging criteria (problem insight, usefulness) more than any
feature. Goal for Friday night: contact 3–5 club or festival officers and get
- 2–3 real quotes,
- one real old handover document (anonymised), and
- if possible, one club saying "we'll try it at our November handover".

Everything here is public once committed: only anonymised quotes, roles instead of names, and only with consent.
A real handover document goes into `seed/private/` (gitignored) unless its owner agrees to publish it.

## Message to send (LINE / Slack DM)

**日本語**
```
突然すみません、〇〇です。今週末のハッカソン（JPHACKS）で、サークルや学祭の「引き継ぎ」を助けるアプリを作っています。5分だけ教えてもらえませんか？

1. 引き継ぎで困ったこと、引き継がれていなくて焦ったことはありますか？（締切・連絡先・お金など）
2. 前の担当の人に、いちばん聞きたかったことは何ですか？
3. 去年の引き継ぎ資料（メモやGoogleドキュメント）はありますか？名前などを消したうえで見せてもらえると、とても助かります。
4. 引き継ぎに必要な情報は、ふだんどこにありますか？（LINE・Slack・Googleドライブ・紙など）

いただいた言葉は、名前を出さずに発表で引用するかもしれません（NGなら教えてください）。
もしよければ、11月の代替わりで無料で試してもらえませんか？
```

**English** (for the Debating Society or international members)
```
Hi, it's Nico. This weekend at the JPHACKS hackathon we're building an app that helps clubs and festival
committees with handovers. Could you give me 5 minutes?

1. Has a handover ever gone wrong for you, or did something not get passed on (a deadline, a contact, money)?
2. What did you most want to ask your predecessor?
3. Do you have last year's handover notes (a memo or a Google Doc)? With names removed, it would help a lot.
4. Where does the information you need for a handover usually live (LINE, Slack, Google Drive, paper)?

I may quote you in the pitch without your name (tell me if that's not OK).
Would your club be open to trying it, for free, at the November handover?
```

## Quote log
| # | Who (role only) | Quote (original) | English | OK to quote? | Date |
|---|---|---|---|---|---|
| 1 | 高校 運動会の放送担当の責任者・卒業誌制作の責任者（経験者）：引き継ぎで困ったこと | 「今までの仕事を思い返して自分が引き継ぐべき内容を考えようとしても、その内容を覚えてないなどの理由で、いざ引き継ぎのタイミングになっても十分な引き継ぎがかけない。」 | "When I look back to decide what to hand over, I can't remember it, so when the handover comes I can't write enough." | yes | 10/17 |
| 2 | 高校 運動会の放送担当の責任者・卒業誌制作の責任者（経験者）：引き継ぎで困ったこと | 「だからと言って日々の仕事内容を何かしらにメモし続けるようなことも、なかなか続かない。」 | "But keeping notes on my day-to-day work doesn't last either." | yes | 10/17 |
| 3 | 高校 運動会の放送担当の責任者・卒業誌制作の責任者（経験者）：引き継がれていなくて焦ったこと | 「部活で十分な引き継ぎが得られておらず、顧問の虎の尾を踏みまくった。」 | "I didn't get a proper handover in my club, and I kept stepping on our advisor's toes." | yes | 10/17 |
| 4 | 高校 運動会の放送担当の責任者・卒業誌制作の責任者（経験者）：前の担当者に聞きたかったこと | 「仕事の記録を見たかったです。とくに顧問とのやりとりとか、この企画をやろうとして通らなかったとか、そういう試行錯誤を活かしたいので。」 | "I wanted to see their work records, especially their exchanges with the advisor and the plans that didn't get approved, so I could learn from that trial and error." | yes | 10/17 |
| 5 | 高校 運動会の放送担当の責任者・卒業誌制作の責任者（経験者）：引き継ぎの情報がある場所 | 「基本ドライブのPDFや、昔のプロジェクトデータ、素材自体が引き継ぎという形が多かったです。（InDesignやAfter Effectsのプロジェクトのデータなど）」 | "Mostly PDFs on a shared drive, old project data, the source files themselves (InDesign and After Effects projects)." | yes | 10/17 |

## Old handover document
| Source (role only) | Anonymised? | Where it is | OK to publish? |
|---|---|---|---|
| | | `seed/private/…` | yes / no |

Many clubs have no document, only a LINE group. A chat export is welcome too, with these rules:
- the officer asks their group first (or shares only their own messages);
- it goes into `seed/private/` and is imported through Daidai's redaction, never opened in an AI tool or pasted into a chat;
- only the reviewed, name-free notes may appear in the demo.

If it can be published, add an anonymised copy as `seed/old-handover.real.md` and use it in the cold-start demo
instead of `seed/old-handover.sample.md`.

## November pilot
| Club or committee (role of contact) | What they agreed to | Date of their handover |
|---|---|---|
| | | |

## Where this is used
- Pitch: the opening line and one quote on the first slide; the count of officers and the pilot on the last slide.
- README: the "User evidence" section (`docs/README-SECTIONS.md`).
- Cold-start demo (F5): the real document, if its owner agreed.
