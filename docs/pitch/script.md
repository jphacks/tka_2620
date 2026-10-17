# Pitch script (90 seconds)

- **Kagehiro** reads the Japanese lines exactly as written.
- **Nico** runs the demo on the laptop and says one line in Japanese.
- **Ishibashi** is last year's treasurer (a25): his phone receives the question and he answers by voice.
- Replace 〇 with real numbers from `metrics/latest.json` and real evidence from `docs/EVIDENCE.md`.
- Read it aloud with a timer and cut words until it fits; the demo waits overlap with the narration.

| Time | Screen | Kagehiro (日本語) | Nico | Ishibashi |
|---|---|---|---|---|
| 0–8 s | Title 「誰も書かない引き継ぎ」 + quote | 「『保健所の書類を、いつまでに出すのか誰も知らなくて、模擬店が出せなくなりかけました。』引き継ぎは、誰も書きません。」 | — | — |
| 8–20 s | Seat page → hero question → answer with sources | 「新しい会計は、部室の席にスマホをかざして聞きます。答えは歴代の会計のメモだけから。すべての文に、どの先輩のメモか書いてあり、ルールの変更も分かります。」 | Taps the NFC sticker; asks 「模擬店の保健所申請、いつまで？」 | — |
| 20–45 s | 「歴代の会計は誰も知りません」 → phone inbox → signed answer | 「誰も知らないことは、知らないと答えます。その質問は、去年の会計のスマホに届きます。」 … 「声で答えるだけで、メモになって後輩に届きます。」 | Asks 「決算後に申請された領収書はどうすれば良いですか？」、, then says **「去年の会計に、聞いてみます。」** | Phone buzzes; taps 声で答える; says the answer in `seed/live-answer.txt`; taps 公開 |
| 45–55 s | Outsider pane empty; withdraw; meter; leak counter | 「共有する範囲は、自分で決められます。部外者には何も見えません。撤回すると、〇秒で回答から消えます。漏れは〇回中ゼロです。」 | Withdraws the cited note in a25's pane | — |
| 55–67 s | Drop the LINE export → 「名前〇件…を隠しました」 → dated notes + missing list | 「最初は、去年のLINEのトーク履歴を入れるだけ。名前や電話番号は端末の中で隠してから、日付つきのメモにします。足りないことも教えてくれます。」 | Drops `seed/chat-line.sample.txt`, ticks consent, sends (fallback: pastes `seed/old-handover.sample.md`) | — |
| 67–90 s | Why not ChatGPT; evidence; other seats (slide); close | 「去年の人に聞こうにも、何を聞けばいいのかすら分からない。ChatGPTやNotion AIは、書かれたものしか探せません。代々は、後輩が聞いたことを先輩に聞いて、暗黙の了解まで書き残してもらいます。〇人の役員に聞き、〇〇が11月の代替わりで試します。知識は人ではなく、席に受け継がれる。代々です。」 | Switches to the closing slide | — |

## English subtitles (for the video) (not updated)
1. "Last year nobody handed over the requirements for the health-department's document, and our food stall almost didn't happen." Nobody writes the handover.
2. The new treasurer taps the club-room key and asks. Answers come only from past treasurers' notes; every sentence has a source, and rule changes are flagged.
3. When nobody knows, Daidai says so, and the question goes to last year's treasurer's phone. A spoken answer becomes a note and reaches the newcomer.
4. Outsiders see nothing. A withdrawn note disappears from answers in 〇 seconds. 0 leaks in 〇 attempts.
5. Day one: drop in last year's LINE group chat. Names and phone numbers are hidden on the device first; it becomes dated notes, and Daidai shows what's missing.
6. ChatGPT and Notion AI only search what was written down. Daidai gets it written, by asking leavers what newcomers asked. 〇 officers interviewed; 〇〇 will try it at their November handover. Knowledge follows the seat, not the person.

## Rehearsal plan
- Sat 19:10 mid-term: the same script, showing whatever works on `main` at the 18:30 freeze.
- Sat night, after the mid-term: five full run-throughs with a timer, live loop included every time.
- Sun 12:00: record the video in one take from `main`, the full loop, then add Japanese and English subtitles.
- Sun 13:00–14:30: three more run-throughs. If anything fails on stage, switch to the video at once.
