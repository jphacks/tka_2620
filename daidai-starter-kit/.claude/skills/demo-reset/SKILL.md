---
name: demo-reset
description: Reset the database to the demo seed state and verify the golden path (answer, live loop, trust proof, cold start) is ready
disable-model-invocation: true
---

1. Run `pnpm demo:reset`.
2. Verify, and report pass or fail for each:
   - the five demo users exist (a24, a25, a26, b, x); a25 is `reachable` on `smash-kaikei`
   - the live note count equals the seed count and no note is withdrawn
   - no note answers 「部室の鍵を無くしたら、誰に連絡する？」 (the live-loop question), a25's inbox is empty,
     and no `answers` row exists
3. As a26 on `smash-kaikei`, ask 「模擬店の保健所申請、いつまで？」 and confirm every sentence cites the 2024 or
   2025 note and the "rule changed in 2025" flag shows.
4. As x, ask the same question and confirm nothing is shown.
5. Run `pnpm test:loop` once (it resets afterwards) and report the time from abstain to the signed answer.
6. Open `/s/smash-kaikei` at 390px and `/console` at 1920px and confirm both load without console errors.
