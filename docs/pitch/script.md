# Pitch script (90 seconds)

- **Kagehiro** reads the Japanese lines exactly as written.
- **Nico** runs the demo on the laptop and says one line in Japanese.
- **Ishibashi** is last year's treasurer (a25): his phone receives the question and he answers by voice.
- Replace 〇 with real numbers from `metrics/latest.json` and real evidence from `docs/EVIDENCE.md`.
- Read it aloud with a timer and cut words until it fits; the demo waits overlap with the narration.
- The opening quote is the scenario from `docs/SPEC.md`, not a logged interview. Swap in a quote from `docs/EVIDENCE.md`
  if you want a real voice.
- Evidence as of 10/18: `docs/EVIDENCE.md` logs one interviewee and no November pilot yet. Fill the 〇 in the last row
  only from logged entries, or drop that sentence.
- The screen links open the laptop's server. On real data, add `#key=<passphrase>&as=a26` to the seat page and
  `#key=<passphrase>&as=a25` to the handover page (on Ishibashi's phone, through the laptop's LAN address, not
  localhost); `/console` takes `#key=<passphrase>`. Never write the passphrase here.

| Time | Screen | Kagehiro (日本語) | Nico | Ishibashi |
|---|---|---|---|---|
| 0–11 s | Title 「誰も書かない引き継ぎ」 + quote | 「代々の発表を始めます。『保健所の書類の内部期限を知らなくて、模擬店が出せなくなりかけました。』引き継ぎには、誰も書きません。私たちは、引き継ぎのプロセスをシームレスにします。」 | — | — |
| 11–20 s | Seat page → hero question → answer with sources [`/s/smash-kaikei`](http://localhost:3000/s/smash-kaikei) | 「新しい会計は、部室の席にスマホをかざして代々に聞きます。答えは蓄積されたメモだけから。すべての文に、誰の記録か書いてあり、比較も簡単です。」 | Taps the NFC sticker; asks 「模擬店の保健所申請、いつまで？」 | — |
| 20–45 s | 「歴代の会計は誰も知りません」 → phone inbox → signed answer [`/s/smash-kaikei/handover`](http://localhost:3000/s/smash-kaikei/handover) | 「誰も知らないことは、そのように答え、前年の担当者のスマホに質問が届きます。声で答えるだけで、メモが届きます。」 | Asks 「決算後に申請された領収書はどうすれば良いですか？」, then says **「去年の会計に、聞いてみます。」** | Phone buzzes; taps 声で答える; says the answer in `seed/live-answer.txt`; taps 公開 |
| 45–55 s | Outsider pane empty; withdraw; meter; leak counter [`/console`](http://localhost:3000/console) | 「共有する範囲は、自分で決められます。共有対象でない人には何も見えません。撤回すると、1秒以内に回答から消えます。500回以上試して、漏れはゼロです。」 | Withdraws the cited note in a25's pane | — |
| 55–67 s | Drop the LINE export → 「名前〇件…を隠しました」 → dated notes + missing list [`/s/smash-kaikei/handover`](http://localhost:3000/s/smash-kaikei/handover) | 「登録には、前年の資料を入れるだけ。名前などの秘匿情報は端末の中で隠してから、日付つきのメモにします。足りないことも教えてくれます。」 | Drops `seed/chat-line.sample.txt`, ticks consent, sends (fallback: pastes `seed/old-handover.sample.md`) | — |
| 67–90 s | Why not ChatGPT; evidence; other seats (slide); close | 「前年の人に聞こうにも、何を聞けばいいのかすら分からない。ChatGPTやNotion AIは、書かれたものしか探せません。代々は、後輩が聞いたことや暗黙の了解も蓄積します。〇人の役員に聞き、〇〇が11月の代替わりで試します。知識は人ではなく、席に受け継がれる。代々です。」 | Switches to the closing slide | — |

## English subtitles (for the video)
1. This is Daidai. "We didn't know the internal deadline for the health department's papers, and our food stall almost didn't happen." Nobody writes the handover. We make handing over seamless.
2. The new treasurer holds a phone to the seat in the club room and asks Daidai. Answers come only from the stored notes; every sentence shows whose record it is, and the years are easy to compare.
3. When nobody knows, Daidai says so, and the question reaches last year's holder's phone. Answering by voice is enough for the note to arrive.
4. You decide who can read each note. Anyone outside that circle sees nothing. A withdrawn note leaves every answer within a second. Over 500 attempts, zero leaks.
5. To start, just add last year's documents. Names and other private details are hidden on the device, then everything becomes dated notes. Daidai also tells you what's missing.
6. You can't even ask last year's people when you don't know what to ask. ChatGPT and Notion AI only search what was written down. Daidai keeps what newcomers asked, and the unwritten rules too. 〇 officers interviewed; 〇〇 will try it at their November handover. Knowledge passes down with the seat, not the person. This is Daidai.

## Rehearsal plan
- Sat 19:10 mid-term: the same script, showing whatever works on `main` at the 18:30 freeze.
- Sat night, after the mid-term: five full run-throughs with a timer, live loop included every time.
- Sun 12:00: record the video in one take from `main`, the full loop, then add Japanese and English subtitles.
- Sun 13:00–14:30: three more run-throughs. If anything fails on stage, switch to the video at once.
