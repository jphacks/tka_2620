import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    // claude --worktree puts full checkouts of other branches here
    exclude: [...configDefaults.exclude, ".claude/worktrees/**"],
  },
});
