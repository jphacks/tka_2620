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
| 1 | 例：〇〇大学 サークル会計（3年） | 「…」 | "…" | yes / no | 10/16 |

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
