// F1's acceptance check (docs/SPEC.md → Features): which notes each persona can read, signed in as that persona
// with DEMO_PASSWORD against the Supabase project in .env.local, so RLS decides and nothing is filtered here.
// The table is the seed state (`pnpm seed` / `pnpm demo:reset`). Reads ids and scope columns only, never a title
// or a body.
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";
import { describe, expect, it } from "vitest";
import type { Scope } from "@/lib/contracts";

// The project's public URL and key and the demo password, from the shell or .env.local. Nothing else is taken from
// .env.local: the test acts as each persona, never with the service-role key.
const names = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "DEMO_PASSWORD",
] as const;
const envFile = new URL("../.env.local", import.meta.url);
const fromFile = existsSync(envFile)
  ? parseEnv(readFileSync(envFile, "utf8"))
  : {};
const env = Object.fromEntries(
  names.map((name) => [name, process.env[name] || fromFile[name] || ""]),
) as Record<(typeof names)[number], string>;
const missing = names.filter((name) => !env[name]);

// The personas of docs/SPEC.md with the emails scripts/seed.ts gives them, and a visitor who isn't signed in.
type Viewer = { key: string; email?: string };
const viewers: Viewer[] = [
  { key: "a24", email: "smash-kaikei-2024@example.com" }, // Smash / 会計 / 2024, alumni
  { key: "a25", email: "smash-kaikei-2025@example.com" }, // Smash / 会計 / 2025, reachable
  { key: "a26", email: "smash-kaikei-2026@example.com" }, // Smash / 会計 / 2026, the newcomer
  { key: "b", email: "keion-member@example.com" }, // 軽音サークル, another group at みなと大学
  { key: "x", email: "yamate-outsider@example.com" }, // やまて大学, nothing at みなと大学
  { key: "signed out" },
];

// Who reads each seed note (✓), one column per viewer above. The canary note is smash-2025-uchiage.
// biome-ignore format: the table reads best aligned
const table: Record<string, string> = {
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
const seedIds = new Set(Object.keys(table));

function column(viewer: Viewer): string[] {
  const at = viewers.indexOf(viewer);
  return Object.entries(table)
    .filter(([, row]) => row.split(/\s+/)[at] === "✓")
    .map(([id]) => id)
    .sort();
}

type Note = {
  id: string;
  seat_id: string;
  term_order: number;
  scope: Scope;
  status: "live" | "withdrawn";
  author_user_id: string | null;
};

async function read<Row>(
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  what: string,
): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(`reading ${what}: ${error.message}`);
  return (data ?? []) as Row[];
}

// Each viewer gets their own client, as the console panes do. No signOut afterwards: its default scope is global,
// which would also sign out the demo phones.
async function signIn(
  viewer: Viewer,
): Promise<{ client: SupabaseClient; userId?: string }> {
  const client = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  if (!viewer.email) return { client };
  const { data, error } = await client.auth.signInWithPassword({
    email: viewer.email,
    password: env.DEMO_PASSWORD,
  });
  if (error) {
    throw new Error(
      `${viewer.key} doesn't sign in with DEMO_PASSWORD (has pnpm seed run?): ${error.message}`,
    );
  }
  return { client, userId: data.user.id };
}

// The scope rules of docs/SPEC.md, worked out from what the viewer may read about themselves (their own seat_holders
// and group_members rows) and about every seat. They also cover notes added after the seed (live loop, F5, F6),
// which the table can't list, but only one way: they catch a note the viewer shouldn't read, not one hidden from them.
async function scopeRules(client: SupabaseClient, userId?: string) {
  const [seats, groups, holds, memberships] = await Promise.all([
    read<{ id: string; group_id: string }>(
      client.from("seats").select("id, group_id"),
      "seats",
    ),
    read<{ id: string; institution_id: string }>(
      client.from("groups").select("id, institution_id"),
      "groups",
    ),
    userId
      ? read<{ seat_id: string; term_order: number }>(
          client.from("seat_holders").select("seat_id, term_order"),
          "seat_holders",
        )
      : [],
    userId
      ? read<{ group_id: string }>(
          client.from("group_members").select("group_id"),
          "group_members",
        )
      : [],
  ]);
  const groupOf = new Map(seats.map((seat) => [seat.id, seat.group_id]));
  const institutionOf = new Map(
    groups.map((group) => [group.id, group.institution_id]),
  );
  const memberOf = new Set(memberships.map((member) => member.group_id));
  const institutions = new Set(
    [...memberOf].map((group) => institutionOf.get(group)),
  );

  return (note: Note): boolean => {
    if (userId && note.author_user_id === userId) return true;
    if (note.status !== "live") return false;
    const holdsSeat = holds.some((hold) => hold.seat_id === note.seat_id);
    const group = groupOf.get(note.seat_id) ?? "";
    switch (note.scope) {
      case "successor":
        return holds.some(
          (hold) =>
            hold.seat_id === note.seat_id && hold.term_order > note.term_order,
        );
      case "group":
        return holdsSeat || memberOf.has(group);
      case "institution":
        return holdsSeat || institutions.has(institutionOf.get(group));
      case "public":
        return true;
    }
  };
}

it("the table has a row for every seed note and a cell for every viewer", () => {
  const notes = parse(
    readFileSync(new URL("../seed/notes.csv", import.meta.url), "utf8"),
    { columns: true, skip_empty_lines: true, bom: true },
  ) as { id: string }[];
  expect([...seedIds].sort()).toEqual(notes.map((note) => note.id).sort());
  for (const row of Object.values(table)) {
    expect(row.split(/\s+/)).toEqual(
      viewers.map(() => expect.stringMatching(/^[✓·]$/)),
    );
  }
});

// Without the project's URL, key and password (a fresh clone, no .env.local) only the check above runs.
describe.skipIf(missing.length > 0)(
  missing.length > 0
    ? `as each persona (skipped: ${missing.join(", ")} not set)`
    : "as each persona",
  () => {
    it.each(
      viewers,
    )("$key reads the seed notes its column marks, and no note outside its scope", async (viewer) => {
      const { client, userId } = await signIn(viewer);
      const notes = await read<Note>(
        client
          .from("notes")
          .select("id, seat_id, term_order, scope, status, author_user_id"),
        "notes",
      );

      const seeded = notes.filter((note) => seedIds.has(note.id));
      expect(
        seeded.map((note) => note.id).sort(),
        "seed notes this viewer reads (the table is the seed state: after a withdrawal, pnpm demo:reset)",
      ).toEqual(column(viewer));

      const allowed = await scopeRules(client, userId);
      expect(
        notes.filter((note) => !allowed(note)).map((note) => note.id),
        "notes the scope rules keep from this viewer",
      ).toEqual([]);
    }, 20_000);
  },
);
