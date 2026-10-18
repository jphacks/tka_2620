// A seat's page (GET /api/seats/[slug], F3.10 and F7.1): offline through a stub client, then live and read-only as
// a24, a26 and x against the project in .env.local (skipped without it), so RLS decides who holds what and which
// deadlines show.
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/seats/[slug]/route";
import { ApiError, SeatView } from "@/lib/contracts";
import { tokyoToday } from "@/lib/engine/notes";
import { ApiFailure } from "@/lib/engine/route";
import {
  type DeadlineNote,
  nextOccurrence,
  seatViewAsCaller,
  upcomingDeadlines,
} from "@/lib/engine/seat";
import { SIMILAR } from "@/lib/engine/similar";
import { type Result, stubClient } from "./fakes";

const SEAT_ID = "33333333-3333-4333-8333-333333333333";
const TODAY = "2026-10-18";
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

// A deadline note as upcomingDeadlines() gets it. The embeddings are short vectors: cosine only needs equal lengths.
const note = (
  id: string,
  term: number,
  date: string,
  embedding: number[] | null,
  title = "締切",
): DeadlineNote => ({
  id,
  title,
  deadline_date: date,
  term_order: term,
  byline: `${term}年度 会計`,
  lang: "ja",
  embedding,
});
// The same note as the notes query returns it: pgvector as text.
const row = (
  { embedding, ...rest }: DeadlineNote,
  text = embedding && JSON.stringify(embedding),
) => ({ ...rest, embedding: text });
const deadlines = (...notes: DeadlineNote[]): Result => ({
  data: notes.map((each) => row(each)),
  error: null,
});
// A unit vector whose cosine with [1, 0] is `similarity`.
const at = (similarity: number) => [
  similarity,
  Math.sqrt(1 - similarity * similarity),
];

// smash-kaikei's two 保健所 notes say the same thing (0.72 in bge-m3); a made-up 部費 deadline says something else.
const hokenjo2024 = note(
  "smash-2024-hokenjo",
  2024,
  "2024-10-27",
  [1, 0, 0],
  "模擬店の保健所申請",
);
const hokenjo2025 = note(
  "smash-2025-hokenjo",
  2025,
  "2025-10-20",
  [0.9, 0.3, 0],
  "保健所申請の締切が早くなった",
);
const buhi2025 = note(
  "smash-2025-buhi",
  2025,
  "2025-04-30",
  [0, 0, 1],
  "部費の集金",
);

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
      {
        seats: [seatRow()],
        seat_holders: [holds(2026)],
        notes: [deadlines()],
      },
      { seat_lineage: lineage },
    );
    const view = SeatView.parse(
      await seatViewAsCaller(client, "smash-kaikei", TODAY),
    );
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
      {
        seats: [seatRow()],
        seat_holders: [holds(2026, 2025)],
        notes: [deadlines()],
      },
      { seat_lineage: lineage },
    );
    const view = await seatViewAsCaller(client, "smash-kaikei", TODAY);
    expect(view.viewer).toEqual({ isHolder: true, termLabel: "2026" });
    expect(
      view.lineage.filter((term) => term.isViewer).map((t) => t.termLabel),
    ).toEqual(["2025", "2026"]);
  });

  it("shows an outsider the seat and the lineage, holding nothing", async () => {
    const { client } = stubClient(
      { seats: [seatRow()], seat_holders: [holds()], notes: [deadlines()] },
      { seat_lineage: lineage },
    );
    const view = await seatViewAsCaller(client, "smash-kaikei", TODAY);
    expect(view.viewer).toEqual({ isHolder: false });
    expect(view.lineage.some((term) => term.isViewer)).toBe(false);
    expect(view.lineage).toHaveLength(3);
    expect(view.upcoming).toEqual([]);
  });

  it("lists the deadline notes the caller reads, at their next occurrence, writing nothing", async () => {
    const { client, calls, rpcCalls } = stubClient(
      {
        seats: [seatRow()],
        seat_holders: [holds(2026)],
        notes: [deadlines(hokenjo2024, buhi2025, hokenjo2025)],
      },
      { seat_lineage: lineage },
    );
    const view = SeatView.parse(
      await seatViewAsCaller(client, "smash-kaikei", TODAY),
    );
    // 2025's 保健所 note stands for 2024's; 4/30 has passed this year, so it comes next year.
    expect(view.upcoming).toEqual([
      {
        noteId: "smash-2025-hokenjo",
        title: "保健所申請の締切が早くなった",
        date: "2026-10-20",
        byline: "2025年度 会計",
        lang: "ja",
      },
      {
        noteId: "smash-2025-buhi",
        title: "部費の集金",
        date: "2027-04-30",
        byline: "2025年度 会計",
        lang: "ja",
      },
    ]);
    // The policy picks the notes the caller may read; the query only narrows to the seat's current deadlines.
    expect(calls.notes[0]).toEqual([
      [
        "select",
        "id, title, deadline_date, term_order, byline, lang, embedding",
      ],
      ["eq", "seat_id", SEAT_ID],
      ["eq", "kind", "deadline"],
      ["eq", "status", "live"],
      ["is", "superseded_by", null],
      // Not expired on Tokyo's date, as search_notes (0004) leaves expired notes out of answers.
      ["or", "valid_until.is.null,valid_until.gte.2026-10-18"],
    ]);
    // Opening the page joins nothing: reads only.
    const methods = Object.values(calls)
      .flat(2)
      .map(([method]) => method);
    expect(methods).not.toContain("insert");
    expect(methods).not.toContain("update");
    expect(rpcCalls.map(([name]) => name)).toEqual(["seat_lineage"]);
  });

  it("keeps a deadline whose embedding doesn't read, matching it with nothing", async () => {
    const { client } = stubClient(
      {
        seats: [seatRow()],
        seat_holders: [holds(2026)],
        notes: [
          { data: [row(hokenjo2024, "[1,0"), row(hokenjo2025)], error: null },
        ],
      },
      { seat_lineage: lineage },
    );
    const view = await seatViewAsCaller(client, "smash-kaikei", TODAY);
    expect(view.upcoming.map((item) => item.noteId)).toEqual([
      "smash-2025-hokenjo",
      "smash-2024-hokenjo",
    ]);
  });

  it("fills every settings flag, keeping the ones that are on", async () => {
    const { client } = stubClient(
      {
        seats: [seatRow({ noteExpiry: true, groupOwnsCriticalNotes: "yes" })],
        seat_holders: [holds()],
        notes: [deadlines()],
      },
      { seat_lineage: lineage },
    );
    const view = await seatViewAsCaller(client, "smash-kaikei", TODAY);
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
      { seats: [seatRow()], seat_holders: [holds()], notes: [deadlines()] },
      { seat_lineage: { data: null, error: { code: "XX000" } } },
    );
    expect(await failure(seatViewAsCaller(client, "smash-kaikei"))).toBe(
      "unavailable",
    );
  });

  it("answers unavailable when the notes query fails", async () => {
    const { client } = stubClient(
      {
        seats: [seatRow()],
        seat_holders: [holds()],
        notes: [{ data: null, error: { code: "XX000" } }],
      },
      { seat_lineage: lineage },
    );
    expect(await failure(seatViewAsCaller(client, "smash-kaikei"))).toBe(
      "unavailable",
    );
  });
});

describe("upcomingDeadlines", () => {
  const ids = (notes: DeadlineNote[]) =>
    upcomingDeadlines(notes, TODAY).map((item) => item.noteId);

  it("lets a later term's note on the same deadline stand for an earlier one", () => {
    expect(ids([hokenjo2024, hokenjo2025])).toEqual(["smash-2025-hokenjo"]);
    // The 2026 notice after 「更新する」: the 2025 note is superseded (not in the query), and 2026's stands for 2024's.
    const notice2026 = note("notice", 2026, "2026-10-19", [0.8, 0.2, 0.1]);
    expect(ids([hokenjo2024, notice2026])).toEqual(["notice"]);
  });

  it("draws the line at SIMILAR, as 「更新する」 does", () => {
    const earlier = note("earlier", 2024, "2024-11-01", [1, 0]);
    const close = note("close", 2025, "2025-11-02", at(SIMILAR + 0.01));
    const apart = note("apart", 2025, "2025-11-02", at(SIMILAR - 0.01));
    expect(ids([earlier, close])).toEqual(["close"]);
    expect(ids([earlier, apart])).toEqual(["earlier", "apart"]);
  });

  it("keeps notes of the same term, and notes that say something else", () => {
    const twin = note("twin", 2025, "2025-10-21", [0.9, 0.31, 0]);
    expect(ids([hokenjo2025, twin, buhi2025])).toEqual([
      "smash-2025-hokenjo",
      "twin",
      "smash-2025-buhi",
    ]);
  });

  it("never hides a note without an embedding, and such a note hides nothing", () => {
    const blank2024 = { ...hokenjo2024, embedding: null };
    const blank2025 = { ...hokenjo2025, embedding: null };
    expect(ids([blank2024, hokenjo2025])).toEqual([
      "smash-2025-hokenjo",
      "smash-2024-hokenjo",
    ]);
    expect(ids([hokenjo2024, blank2025])).toEqual([
      "smash-2025-hokenjo",
      "smash-2024-hokenjo",
    ]);
  });

  it("orders by date, then the latest term, then id", () => {
    const a = note("b-2024", 2024, "2024-12-01", [1, 0, 0]);
    const b = note("a-2025", 2025, "2025-12-01", [0, 1, 0]);
    const c = note("c-2025", 2025, "2025-12-01", [0, 0, 1]);
    const d = note("d-2025", 2025, "2025-11-30", [0, 0, -1]);
    expect(ids([a, b, c, d])).toEqual(["d-2025", "a-2025", "c-2025", "b-2024"]);
  });

  it("shows nothing when the caller reads no deadline", () => {
    expect(upcomingDeadlines([], TODAY)).toEqual([]);
  });
});

describe("nextOccurrence", () => {
  it("keeps a date that is still ahead", () => {
    expect(nextOccurrence("2026-10-19", TODAY)).toBe("2026-10-19");
    expect(nextOccurrence("2027-04-30", TODAY)).toBe("2027-04-30");
  });

  it("brings a predecessor's date to this year, today included", () => {
    expect(nextOccurrence("2025-10-20", TODAY)).toBe("2026-10-20");
    expect(nextOccurrence("2024-10-27", TODAY)).toBe("2026-10-27");
    expect(nextOccurrence("2025-10-18", TODAY)).toBe("2026-10-18");
    expect(nextOccurrence("2026-10-18", TODAY)).toBe("2026-10-18");
  });

  it("goes to next year once this year's day has passed", () => {
    expect(nextOccurrence("2025-04-30", TODAY)).toBe("2027-04-30");
    expect(nextOccurrence("2025-10-17", TODAY)).toBe("2027-10-17");
    expect(nextOccurrence("2025-01-10", "2026-12-31")).toBe("2027-01-10");
  });

  it("puts 29 February on the 28th in a common year", () => {
    expect(nextOccurrence("2024-02-29", TODAY)).toBe("2027-02-28");
    expect(nextOccurrence("2024-02-29", "2027-10-18")).toBe("2028-02-29");
    expect(nextOccurrence("2024-02-29", "2026-02-28")).toBe("2026-02-28");
  });
});

describe("GET /api/seats/[slug]", () => {
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

function get(slug: string, authorization?: string) {
  return GET(
    new Request(`http://localhost/api/seats/${slug}`, {
      headers: authorization ? { authorization } : {},
    }),
    { params: Promise.resolve({ slug }) },
  );
}

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

// These read the seed as `pnpm demo:reset` leaves it: a 「更新する」 with the 2026 notice since then changes upcoming.
describe.skipIf(missing.length > 0)("live, as the personas", () => {
  let a24: SupabaseClient;
  let a26: SupabaseClient;
  let x: SupabaseClient;
  beforeAll(async () => {
    [a24, a26, x] = await Promise.all([
      signedIn("smash-kaikei-2024@example.com"),
      signedIn("smash-kaikei-2026@example.com"),
      signedIn("yamate-outsider@example.com"),
    ]);
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("a26 holds 2026; x holds nothing and sees the same lineage", async () => {
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

  it("a26 gets the 2025 保健所 deadline on 10/20, not 2024's; x gets no deadline", async () => {
    const [newcomer, outsider] = await Promise.all([
      seatViewAsCaller(a26, "smash-kaikei"),
      seatViewAsCaller(x, "smash-kaikei"),
    ]);
    expect(newcomer.upcoming).toContainEqual({
      noteId: "smash-2025-hokenjo",
      title: "保健所申請の締切が早くなった",
      date: nextOccurrence("2025-10-20", tokyoToday()),
      byline: "2025年度 会計",
      lang: "ja",
    });
    expect(newcomer.upcoming.map((item) => item.noteId)).not.toContain(
      "smash-2024-hokenjo",
    );
    expect(outsider.upcoming).toEqual([]);
  });

  it("a24 still gets their own 2024 deadline: the 2025 note they can't read hides nothing", async () => {
    const view = await seatViewAsCaller(a24, "smash-kaikei");
    expect(view.upcoming.map((item) => [item.noteId, item.date])).toEqual([
      ["smash-2024-hokenjo", nextOccurrence("2024-10-27", tokyoToday())],
    ]);
  });

  it("answers a26 through the route, never cached", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", env.NEXT_PUBLIC_SUPABASE_URL);
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
    const { data } = await a26.auth.getSession();
    const response = await get(
      "smash-kaikei",
      `Bearer ${data.session?.access_token}`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const view = SeatView.parse(await response.json());
    expect(view.upcoming.map((item) => item.noteId)).toContain(
      "smash-2025-hokenjo",
    );
  });
});
