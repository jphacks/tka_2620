// POST /api/notes/[id]/withdraw and GET /api/me/notes (F4.2, issue #26), offline: the handlers return before they
// touch Supabase unless the request is well-formed, and the flows run on a stub client. withdraw_note() itself (who
// may withdraw, which answers change, the events row) is SQL in supabase/migrations/0006_withdraw.sql.
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { ApiError, MyNotesResponse, WithdrawResponse } from "@/lib/contracts";
import {
  handleMyNotes,
  handleWithdraw,
  myNotesAsCaller,
  withdrawAsCaller,
} from "@/lib/engine/notes";
import { ApiFailure } from "@/lib/engine/route";

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
