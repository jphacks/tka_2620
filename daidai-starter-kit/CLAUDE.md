@AGENTS.md

# Claude Code specifics
- Before planning a feature, read its section in `docs/SPEC.md` and the lanes in `docs/WORKFLOW.md`.
  For UI work, use the `design-system` skill. To support a new kind of group, use the `add-seat-type` skill.
- Use plan mode for anything touching more than one file. Show the plan before editing.
- Before opening a PR that touches `supabase/`, `lib/engine/` or `app/api/`, run the `leak-auditor`
  subagent on the diff. For screen changes, run the `ui-reviewer` subagent.
- Parallel work: one worktree per lane (`claude --worktree engine`, `claude --worktree ui`).
- When compacting, keep the current feature, the files modified and any failing test output.
