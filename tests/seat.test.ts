// A seat's page (GET /api/seats/[slug], F3.10): offline through a stub client, then live and read-only as a26 and x
// against the project in .env.local (skipped without it), so RLS decides who holds what.
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/seats/[slug]/route";
import { ApiError, SeatView } from "@/lib/contracts";
import { ApiFailure } from "@/lib/engine/route";
import { seatViewAsCaller } from "@/lib/engine/seat";
import { type Result, stubClient } from "./fakes";

const SEAT_ID = "33333333-3333-4333-8333-333333333333";
const seatRow = (settings: unknown = {}): Result => ({
  data: {
    id: SEAT_ID,
    slug: "smash-kaikei",
    name: "会計",
    seat_type: "club_role",
    settings,
    groups: {
      name: "テニスサークル Smash",
      institutions: { name: "みなと大学" },
    },
  },
  error: null,
});
const lineage: Result = {
  data: [2024, 2025, 2026].map((term) => ({
    term_label: String(term),
    term_order: term,
  })),
  error: null,
};
const holds = (...terms: number[]): Result => ({
  data: terms.map((term) => ({ term_label: String(term), term_order: term })),
  error: null,
});

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiFailure) return error.code;
    throw error;
  }
  throw new Error("expected a failure");
}

describe("seatViewAsCaller", () => {
  it("shows a holder their latest term in the lineage", async () => {
    const { client, calls, rpcCalls } = stubClient(
      { seats: [seatRow()], seat_holders: [holds(2026)] },
      { seat_lineage: lineage },
    );
    const view = SeatView.parse(await seatViewAsCaller(client, "smash-kaikei"));
    expect(view.seat).toEqual({
      slug: "smash-kaikei",
      name: "会計",
      seatType: "club_role",
      group: "テニスサークル Smash",
      institution: "みなと大学",
      settings: {
        noteExpiry: false,
        groupOwnsCriticalNotes: false,
        requiredPrompts: false,
      },
    });
    expect(view.viewer).toEqual({ isHolder: true, termLabel: "2026" });
    expect(view.lineage.filter((term) => term.isViewer)).toEqual([
      { termLabel: "2026", termOrder: 2026, isViewer: true },
    ]);
    expect(view.lineage.map((term) => term.termLabel)).toEqual([
      "2024",
      "2025",
      "2026",
    ]);
    expect(view.upcoming).toEqual([]);
    expect(calls.seats[0]).toContainEqual(["eq", "slug", "smash-kaikei"]);
    expect(calls.seat_holders[0]).toContainEqual(["eq", "seat_id", SEAT_ID]);
    expect(rpcCalls).toEqual([["seat_lineage", { seat: SEAT_ID }]]);
  });

  it("picks the highest term for someone who held the seat twice", async () => {
    const { client } = stubClient(
      { seats: [seatRow()], seat_holders: [holds(2026, 2025)] },
      { seat_lineage: lineage },
    );
    const view = await seatViewAsCaller(client, "smash-kaikei");
    expect(view.viewer).toEqual({ isHolder: true, termLabel: "2026" });
    expect(
      view.lineage.filter((term) => term.isViewer).map((t) => t.termLabel),
    ).toEqual(["2025", "2026"]);
  });

  it("shows an outsider the seat and the lineage, holding nothing", async () => {
    const { client } = stubClient(
      { seats: [seatRow()], seat_holders: [holds()] },
      { seat_lineage: lineage },
    );
    const view = await seatViewAsCaller(client, "smash-kaikei");
    expect(view.viewer).toEqual({ isHolder: false });
    expect(view.lineage.some((term) => term.isViewer)).toBe(false);
    expect(view.lineage).toHaveLength(3);
  });

  it("fills every settings flag, keeping the ones that are on", async () => {
    const { client } = stubClient(
      {
        seats: [seatRow({ noteExpiry: true, groupOwnsCriticalNotes: "yes" })],
        seat_holders: [holds()],
      },
      { seat_lineage: lineage },
    );
    const view = await seatViewAsCaller(client, "smash-kaikei");
    expect(view.seat.settings).toEqual({
      noteExpiry: true,
      groupOwnsCriticalNotes: false,
      requiredPrompts: false,
    });
  });

  it("answers not_found for an unknown seat", async () => {
    const { client } = stubClient({ seats: [{ data: null, error: null }] });
    expect(await failure(seatViewAsCaller(client, "no-such-seat"))).toBe(
      "not_found",
    );
  });

  it("answers unavailable when the database fails", async () => {
    const { client } = stubClient(
      { seats: [seatRow()], seat_holders: [holds()] },
      { seat_lineage: { data: null, error: { code: "XX000" } } },
    );
    expect(await failure(seatViewAsCaller(client, "smash-kaikei"))).toBe(
      "unavailable",
    );
  });
});

describe("GET /api/seats/[slug]", () => {
  const get = (slug: string, authorization?: string) =>
    GET(
      new Request(`http://localhost/api/seats/${slug}`, {
        headers: authorization ? { authorization } : {},
      }),
      { params: Promise.resolve({ slug }) },
    );

  it("answers unauthorized without a token", async () => {
    const response = await get("smash-kaikei");
    expect(response.status).toBe(401);
    expect(ApiError.parse(await response.json()).error).toBe("unauthorized");
  });

  it("answers invalid_request for a slug that isn't one", async () => {
    const response = await get("Smash Kaikei", "Bearer token");
    expect(response.status).toBe(400);
  });
});

// Live: the public URL and key and the demo password, from the shell or .env.local; never the service-role key.
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

// Each persona gets its own client. No signOut afterwards: its default scope is global, which would also sign out the
// demo phones.
async function signedIn(email: string) {
  const client = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { error } = await client.auth.signInWithPassword({
    email,
    password: env.DEMO_PASSWORD,
  });
  if (error) throw new Error(`${email} doesn't sign in (has pnpm seed run?)`);
  return client;
}

describe.skipIf(missing.length > 0)("live, as the personas", () => {
  it("a26 holds 2026; x holds nothing and sees the same lineage", async () => {
    const [a26, x] = await Promise.all([
      signedIn("smash-kaikei-2026@example.com"),
      signedIn("yamate-outsider@example.com"),
    ]);
    const [newcomer, outsider] = await Promise.all([
      seatViewAsCaller(a26, "smash-kaikei"),
      seatViewAsCaller(x, "smash-kaikei"),
    ]);
    expect(SeatView.safeParse(newcomer).success).toBe(true);
    expect(newcomer.viewer).toEqual({ isHolder: true, termLabel: "2026" });
    expect(outsider.viewer).toEqual({ isHolder: false });
    expect(outsider.lineage.some((term) => term.isViewer)).toBe(false);
    expect(outsider.lineage.map((term) => term.termLabel)).toEqual(
      newcomer.lineage.map((term) => term.termLabel),
    );
    expect(newcomer.lineage.map((term) => term.termLabel)).toEqual(
      expect.arrayContaining(["2024", "2025", "2026"]),
    );
  });
});
