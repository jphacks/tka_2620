// POST /api/notes/[id]/withdraw and GET /api/me/notes (F4.2, issue #26), and GET /api/notes/[id] (F2.4, #22), offline:
// the handlers return before they touch Supabase unless the request is well-formed, and the flows run on a stub
// client. withdraw_note() itself (who may withdraw, which answers change, the events row) is SQL in
// supabase/migrations/0006_withdraw.sql. Then live and read-only as a26, b and x against the project in .env.local
// (skipped without it), so the notes policy decides which note opens for whom.
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  ApiError,
  MyNotesResponse,
  NoteView,
  WithdrawResponse,
} from "@/lib/contracts";
import {
  handleMyNotes,
  handleNote,
  handleWithdraw,
  myNotesAsCaller,
  noteAsCaller,
  withdrawAsCaller,
} from "@/lib/engine/notes";
import { ApiFailure } from "@/lib/engine/route";
import { stubClient } from "./fakes";

const A25 = "33333333-3333-4333-8333-333333333333";
// What PostgREST hands back for a timestamptz: microseconds and an offset.
const WITHDRAWN_AT = "2026-10-18T01:31:02.123456+00:00";

function request(token?: string): Request {
  return new Request("http://localhost/api/notes/smash-2025-hokenjo/withdraw", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

type Rpc = { data?: unknown; error?: { code: string } | null };

function rpcClient(reply: Rpc, calls: unknown[][] = []): SupabaseClient {
  return {
    rpc: async (...args: unknown[]) => {
      calls.push(args);
      return { data: reply.data ?? null, error: reply.error ?? null };
    },
  } as unknown as SupabaseClient;
}

type Select = { data?: unknown; error?: { code: string } | null };

function notesClient(reply: Select, seen: Record<string, unknown> = {}) {
  return {
    from(table: string) {
      seen.table = table;
      return {
        select(columns: string) {
          seen.columns = columns;
          return {
            eq(column: string, value: unknown) {
              seen.filter = [column, value];
              return {
                order: async (column: string, options: unknown) => {
                  seen.order = [column, options];
                  return {
                    data: reply.data ?? null,
                    error: reply.error ?? null,
                  };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe("handleWithdraw", () => {
  it("refuses a request without a token", async () => {
    const response = await handleWithdraw(request(), "smash-2025-hokenjo");
    expect(response.status).toBe(401);
    expect(ApiError.parse(await response.json()).error).toBe("unauthorized");
  });

  it("rejects an empty note id before anything else", async () => {
    const response = await handleWithdraw(request("token"), "");
    expect(response.status).toBe(400);
    expect(ApiError.parse(await response.json()).error).toBe("invalid_request");
  });
});

describe("withdrawAsCaller", () => {
  it("calls withdraw_note as the caller and answers with withdrawn_at", async () => {
    const calls: unknown[][] = [];
    const result = await withdrawAsCaller(
      rpcClient({ data: WITHDRAWN_AT }, calls),
      "smash-2025-hokenjo",
    );
    expect(calls).toEqual([["withdraw_note", { note: "smash-2025-hokenjo" }]]);
    expect(WithdrawResponse.parse(result)).toEqual({
      withdrawnAt: WITHDRAWN_AT,
    });
  });

  it("turns the refusal for someone else's note into forbidden", async () => {
    await expect(
      withdrawAsCaller(
        rpcClient({ error: { code: "42501" } }),
        "smash-2024-hokenjo",
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("answers unavailable for any other database error", async () => {
    await expect(
      withdrawAsCaller(
        rpcClient({ error: { code: "08006" } }),
        "smash-2025-hokenjo",
      ),
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("answers unavailable when the reply isn't a timestamp", async () => {
    const error = await withdrawAsCaller(
      rpcClient({ data: null }),
      "smash-2025-hokenjo",
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiFailure);
    expect(error).toMatchObject({ code: "unavailable" });
  });
});

describe("handleMyNotes", () => {
  it("refuses a request without a token", async () => {
    const response = await handleMyNotes(
      new Request("http://localhost/api/me/notes"),
    );
    expect(response.status).toBe(401);
  });
});

describe("myNotesAsCaller", () => {
  it("lists the caller's notes with their seats, withdrawn ones included, newest first, without bodies", async () => {
    const seen: Record<string, unknown> = {};
    const notes = [
      {
        id: "smash-2025-hokenjo",
        title: "保健所申請の締切が早くなった",
        scope: "successor",
        status: "withdrawn",
        lang: "ja",
        seat: "smash-kaikei",
      },
      {
        id: "smash-2025-ryoshusho",
        title: "領収書は月末にまとめて精算",
        scope: "group",
        status: "live",
        lang: "ja",
        seat: "smash-kaikei",
      },
    ];
    // PostgREST embeds the seat as an object.
    const rows = notes.map(({ seat, ...note }) => ({
      ...note,
      seat: { slug: seat },
    }));
    const result = await myNotesAsCaller(
      notesClient({ data: rows }, seen),
      A25,
    );
    expect(MyNotesResponse.parse(result)).toEqual({ notes });
    expect(seen).toEqual({
      table: "notes",
      columns: "id, title, scope, status, lang, seat:seats(slug)",
      filter: ["author_user_id", A25],
      order: ["created_at", { ascending: false }],
    });
  });

  it("answers unavailable for rows it can't read as notes", async () => {
    await expect(
      myNotesAsCaller(notesClient({ data: [{ id: "n", title: 1 }] }), A25),
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("turns a policy refusal into forbidden", async () => {
    await expect(
      myNotesAsCaller(notesClient({ error: { code: "42501" } }), A25),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("handleNote", () => {
  const get = (token?: string) =>
    new Request("http://localhost/api/notes/smash-2025-hokenjo", {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  it("refuses a request without a token", async () => {
    const response = await handleNote(get(), "smash-2025-hokenjo");
    expect(response.status).toBe(401);
    expect(ApiError.parse(await response.json()).error).toBe("unauthorized");
  });

  it("rejects an empty note id before anything else", async () => {
    const response = await handleNote(get("token"), "");
    expect(response.status).toBe(400);
    expect(ApiError.parse(await response.json()).error).toBe("invalid_request");
  });
});

describe("noteAsCaller", () => {
  const row = {
    id: "smash-2025-hokenjo",
    kind: "deadline",
    title: "締切",
    body: "本文",
    deadline_date: "2025-10-20",
    lang: "ja",
    byline: "2025年度 会計",
  };

  it("reads one live note as the caller, never its author, scope or embedding", async () => {
    const { client, calls } = stubClient({
      notes: [{ data: row, error: null }],
    });
    const note = await noteAsCaller(client, "smash-2025-hokenjo");
    expect(NoteView.parse(note)).toEqual({
      id: "smash-2025-hokenjo",
      kind: "deadline",
      title: "締切",
      body: "本文",
      deadlineDate: "2025-10-20",
      lang: "ja",
      byline: "2025年度 会計",
    });
    expect(calls.notes[0]).toEqual([
      ["select", "id, kind, title, body, deadline_date, lang, byline"],
      ["eq", "id", "smash-2025-hokenjo"],
      ["eq", "status", "live"],
    ]);
  });

  it("leaves out a deadline the note doesn't have", async () => {
    const { client } = stubClient({
      notes: [
        { data: { ...row, kind: "pitfall", deadline_date: null }, error: null },
      ],
    });
    const note = await noteAsCaller(client, "smash-2025-hokenjo");
    expect(note).not.toHaveProperty("deadlineDate");
  });

  it("answers not_found when the policy shows no row: out of scope, withdrawn or missing alike", async () => {
    const { client } = stubClient({ notes: [{ data: null, error: null }] });
    await expect(
      noteAsCaller(client, "smash-2025-hokenjo"),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("turns a policy refusal into forbidden and any other error into unavailable", async () => {
    const { client } = stubClient({
      notes: [
        { data: null, error: { code: "42501" } },
        { data: null, error: { code: "08006" } },
      ],
    });
    await expect(noteAsCaller(client, "a")).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(noteAsCaller(client, "a")).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("answers unavailable for a row it can't read as a note", async () => {
    const { client } = stubClient({
      notes: [{ data: { ...row, kind: "gossip" }, error: null }],
    });
    await expect(
      noteAsCaller(client, "smash-2025-hokenjo"),
    ).rejects.toBeInstanceOf(ApiFailure);
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

// What reading a note as a persona came to, without the note itself: a body never reaches the test output, so a
// leak of the canary note shows as "readable", not as its text.
const outcome = (client: SupabaseClient, id: string) =>
  noteAsCaller(client, id).then(
    () => "readable",
    (error: unknown) => (error instanceof ApiFailure ? error.code : "error"),
  );

describe.skipIf(missing.length > 0)("live, as the personas", () => {
  it("opens a cited note only for the personas whose scope holds it", async () => {
    const [a26, b, x] = await Promise.all([
      signedIn("smash-kaikei-2026@example.com"),
      signedIn("keion-member@example.com"),
      signedIn("yamate-outsider@example.com"),
    ]);
    // successor, 2025: the 2026 treasurer reads it.
    const note = await noteAsCaller(a26, "smash-2025-hokenjo");
    expect(note.kind).toBe("deadline");
    expect(note.deadlineDate).toBe("2025-10-20");
    expect(note.byline).toBe("2025年度 会計");
    expect(note.body.length).toBeGreaterThan(0);
    // Not another club's member, not an outsider, and the canary note neither.
    for (const [persona, client, id] of [
      ["b", b, "smash-2025-hokenjo"],
      ["x", x, "smash-2025-hokenjo"],
      ["b", b, "smash-2025-uchiage"],
      ["x", x, "smash-2025-uchiage"],
      ["x", x, "gakusai-2025-hokenjo"],
    ] as const) {
      expect(await outcome(client, id), `${persona} opens ${id}`).toBe(
        "not_found",
      );
    }
    // institution: every member of a group at みなと大学.
    expect(await outcome(b, "gakusai-2025-hokenjo")).toBe("readable");
  });
});
