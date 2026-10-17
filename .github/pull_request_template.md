## What
F<n>: <one line>

## Acceptance check (from docs/SPEC.md)
<paste the command output, or describe what you checked on the demo laptop>

## Screens (UI changes)
<390px screenshot; console changes also at 1920px>

## Checklist
- [ ] Base branch is `dev` (GitHub suggests `main`)
- [ ] Only my lane's folders changed, or the lane owner approved
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm lint` pass (CI runs all three)
- [ ] New UI text is in both `messages/ja.json` and `messages/en.json`
- [ ] No secrets, no real names, no `seat_type` branches in the UI
- [ ] Engine PRs: `leak-auditor` run, `pnpm test:leak` shows 0 leaks
