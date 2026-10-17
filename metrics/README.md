# metrics/

`latest.json` holds every number the README shows and the console's leak counter (F4.3, #27) displays. One command
writes it:

```
pnpm metrics          # scripts/metrics.ts (F4.5, #29)
```

It is committed on purpose: the README and the trust proof show the numbers without a test run on stage.

## The file

Its shape is `Metrics` in `lib/contracts.ts`; every section is optional and holds counts and seconds only, never a
note, chat or canary string. A section is missing until its check has run, and the README then says "not measured":
a missing number stays missing, it is never rounded down to 0.

| Section | Holds | Measured by |
|---|---|---|
| `leaks` | outsider attempts (≥50), all attempts, leaks found | `scripts/check-leak.ts` (F4.4, #28) |
| `withdraw` | runs, median and max seconds from click to absent in every pane | `scripts/check-withdraw.ts` (F4.5, #29) |
| `citations` | answer sentences over `seed/questions.csv`, and those with a source note | `scripts/check-citations.ts` (F4.5, #29) |
| `redaction` | chats imported, items hidden, items that left the browser | `scripts/check-redact.ts` (F5) |
| `loop` | live-loop runs, failures, median seconds from 「誰も知りません」 to the signed answer | `scripts/check-loop.ts` (F3.9, #11) |

## How `pnpm metrics` collects the numbers

`scripts/metrics.ts` runs each check above (skipping any whose script isn't built yet), and each check reports what it
measured on one line with `reportMetrics()` (`scripts/metrics-line.ts`):

```
METRICS {"leaks":{"outsiderAttempts":50,"totalAttempts":250,"found":0}}
```

The line is a partial `Metrics` — only the sections that check owns. `pnpm metrics` takes each check's last line,
validates it against `Metrics`, and merges the sections into `latest.json`. A check that fails, prints no line, or
reports something outside the contract leaves its section out; it can never put a wrong number in the file.

To add a check, have it end with:

```ts
import { reportMetrics } from "@/scripts/metrics-line";
reportMetrics({ loop: { runs: 5, failures: 0, medianS: 12.4 } });
```

and add it to `CHECKS` in `scripts/metrics.ts`, in the README's order.
