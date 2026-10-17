// Who may read each seed note, written by hand from docs/SPEC.md → Scope rules and Personas, so the tests that check
// the database don't take their answer from it. It is the seed state (`pnpm seed` / `pnpm demo:reset`). Shared by F1's
// visibility test (tests/visibility.test.ts) and the leak test (scripts/check-leak.ts, `pnpm test:leak`).

// The personas of docs/SPEC.md with the emails scripts/seed.ts gives them, and a visitor who isn't signed in.
export type Viewer = { key: string; email?: string };
export const viewers: Viewer[] = [
  { key: "a24", email: "smash-kaikei-2024@example.com" }, // Smash / 会計 / 2024, alumni
  { key: "a25", email: "smash-kaikei-2025@example.com" }, // Smash / 会計 / 2025, reachable
  { key: "a26", email: "smash-kaikei-2026@example.com" }, // Smash / 会計 / 2026, the newcomer
  { key: "b", email: "keion-member@example.com" }, // 軽音サークル, another group at みなと大学
  { key: "x", email: "yamate-outsider@example.com" }, // やまて大学, nothing at みなと大学
  { key: "signed out" },
];

// Who reads each seed note (✓), one column per viewer above. The canary note is smash-2025-uchiage.
// biome-ignore format: the table reads best aligned
export const table: Record<string, string> = {
  //                        a24  a25  a26  b    x    signed out
  "smash-2024-hokenjo":    "✓    ✓    ✓    ·    ·    ·", // successor, 2024: its author and the later terms
  "smash-2025-hokenjo":    "·    ✓    ✓    ·    ·    ·", // successor, 2025: not the earlier term
  "smash-2025-ryoshusho":  "✓    ✓    ✓    ·    ·    ·", // group: every holder of the seat and member of Smash
  "smash-2025-gasshuku":   "·    ✓    ✓    ·    ·    ·", // successor, 2025
  "smash-2025-uchiage":    "·    ✓    ✓    ·    ·    ·", // successor, 2025, the canary note
  "gakusai-2025-hokenjo":  "✓    ✓    ✓    ✓    ·    ·", // institution: every member of a group at みなと大学
  "gakusai-2025-tsurisen": "✓    ✓    ✓    ✓    ✓    ✓", // public: everyone, signed out too
  "tum-2025-tenyu":        "·    ·    ·    ·    ·    ·", // group of TUM交換留学
  "lab-2025-cartridge":    "·    ·    ·    ·    ·    ·", // group of 生体工学研
};
export const seedIds = new Set(Object.keys(table));

// Whether the viewer reads the seed note; undefined for a note the table doesn't list (one added after the seed).
export function reads(viewerKey: string, noteId: string): boolean | undefined {
  const row = table[noteId];
  if (row === undefined) return undefined;
  const at = viewers.findIndex((viewer) => viewer.key === viewerKey);
  if (at < 0) throw new Error(`no column for viewer ${viewerKey}`);
  return row.split(/\s+/)[at] === "✓";
}

// The seed notes the viewer reads, sorted.
export function column(viewerKey: string): string[] {
  return [...seedIds].filter((id) => reads(viewerKey, id)).sort();
}
