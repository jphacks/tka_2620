---
name: hackday-log
description: Fill the README's Numbers, User evidence, Built during Hack Day and Prepared before Hack Day sections from metrics, evidence and commits
disable-model-invocation: true
---

Use the section templates in `docs/README-SECTIONS.md`. Write Japanese first with a short English line under it.

1. **Numbers:** run `pnpm metrics` (or read `metrics/latest.json` if it is from the last hour) and fill every
   `{placeholder}`. Never round a leak count or invent a number; leave a missing metric as "not measured".
2. **User evidence:** copy only quotes from `docs/EVIDENCE.md` whose "OK to quote?" is yes, with the role, never a name.
   Add the pilot line only if a club agreed.
3. **Built during Hack Day:** run `git log pre-hackday..HEAD --pretty=format:'%h %s'`, group the commits by feature
   (F1–F7), and write one row per feature: what it does, then links to its key commits as
   `https://github.com/jphacks/tka_2620/commit/<hash>`. Add the compare link
   `https://github.com/jphacks/tka_2620/compare/pre-hackday...main`.
4. **Prepared before Hack Day:** run `git log pre-hackday --pretty=format:'%h %s'` and list the `[prep]` commits
   in one row per area (kit, skeleton, tables, seed data), with commit links.
5. Show the diff of README.md and wait for approval before committing.
