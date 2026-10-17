// The predecessor's inbox (F3.6) through a stub client, offline. Who gets which route is the database's job, checked
// against the shared project by scripts/check-inbox.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { InboxResponse, SeenResponse } from "@/lib/contracts";
import { type Byline, inboxAsCaller, markSeen } from "@/lib/engine/inbox";

// seed/questions.csv q04, asked by a26 and routed to a25.
const QUESTION = "決算後に申請された領収書はどうすれば良いですか？";
const PROMPT_ID = "22222222-2222-4222-8222-222222222222";
const SEAT_ID = "33333333-3333-4333-8333-333333333333";
const ASKED_AT = "2026-10-17T07:52:21.123456+00:00"; // as PostgREST writes a timestamptz
const SEEN_AT = "2026-10-17T07:53:02.5+00:00";

type Result = { data: unknown; error: { code: string } | null };
type Call = [method: string, ...args: unknown[]];

// A PostgREST query: each call is recorded, and it answers with one result, awaited or through maybeSingle().
function query(result: Result, calls: Call[]) {
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push([method, ...args]);
      return chain;
    };
  const chain = Object.assign(Promise.resolve(result), {
    select: record("select"),
    update: record("update"),
    eq: record("eq"),
    is: record("is"),
    maybeSingle: async () => result,
  });
  return chain;
}

// A client whose queries answer in order, per table.
function stubClient(
  tables: Record<string, Result[]>,
  rpc: Result = { data: [], error: null },
) {
  const calls: Record<string, Call[][]> = {};
  const rpcCalls: unknown[][] = [];
  const client = {
    from(table: string) {
      const result = tables[table]?.shift();
      if (!result) throw new Error(`unexpected query on ${table}`);
      const queryCalls: Call[] = [];
      calls[table] = [...(calls[table] ?? []), queryCalls];
      return query(result, queryCalls);
    },
    rpc: async (...args: unknown[]) => {
      rpcCalls.push(args);
      return rpc;
    },
  };
  return { client: client as unknown as SupabaseClient, calls, rpcCalls };
}

const byline: Byline = (seatType, term, seat) => `${term}|${seat}|${seatType}`;
const seat: Result = {
  data: { id: SEAT_ID, name: "会計", seat_type: "club_role" },
  error: null,
};
const row = {
  prompt_id: PROMPT_ID,
  question: QUESTION,
  ask_count: 1,
  asked_at: ASKED_AT,
  lang: "ja",
  asked_by_term: "2026",
};

describe("inboxAsCaller", () => {
  it("lists what was routed to the caller, the asker by seat and term", async () => {
    const { client, rpcCalls } = stubClient(
      { seats: [seat] },
      { data: [row], error: null },
    );
    const inbox = await inboxAsCaller(client, "smash-kaikei", byline);
    expect(rpcCalls).toEqual([["inbox", { seat: SEAT_ID }]]);
    expect(InboxResponse.parse(inbox)).toEqual({
      items: [
        {
          promptId: PROMPT_ID,
          question: QUESTION,
          askedBy: "2026|会計|club_role",
          askCount: 1,
          askedAt: ASKED_AT,
          lang: "ja",
        },
      ],
    });
  });

  it("names the seat when an asker's term is missing", async () => {
    const { client } = stubClient(
      { seats: [seat] },
      { data: [{ ...row, asked_by_term: null }], error: null },
    );
    const inbox = await inboxAsCaller(client, "smash-kaikei", byline);
    expect(inbox.items[0].askedBy).toBe("会計");
  });

  it("answers an empty inbox when nothing was routed to the caller", async () => {
    const { client } = stubClient({ seats: [seat] }, { data: [], error: null });
    expect(await inboxAsCaller(client, "smash-kaikei", byline)).toEqual({
      items: [],
    });
  });

  it("404s a seat that doesn't exist, before asking for the inbox", async () => {
    const { client, rpcCalls } = stubClient({
      seats: [{ data: null, error: null }],
    });
    await expect(
      inboxAsCaller(client, "no-such-seat", byline),
    ).rejects.toMatchObject({ name: "ApiFailure", code: "not_found" });
    expect(rpcCalls).toEqual([]);
  });

  it("answers unavailable for rows inbox() can't return", async () => {
    for (const bad of [
      { ...row, lang: "fr" },
      { ...row, prompt_id: "not-a-uuid" },
      { ...row, ask_count: 0 },
      { ...row, asked_at: "yesterday" },
    ]) {
      const { client } = stubClient(
        { seats: [seat] },
        { data: [bad], error: null },
      );
      await expect(
        inboxAsCaller(client, "smash-kaikei", byline),
      ).rejects.toMatchObject({ name: "ApiFailure", code: "unavailable" });
    }
  });

  it("turns a database error into its code, never its text", async () => {
    const refused = stubClient(
      { seats: [seat] },
      {
        data: null,
        error: { code: "42501" },
      },
    );
    await expect(
      inboxAsCaller(refused.client, "smash-kaikei", byline),
    ).rejects.toMatchObject({ code: "forbidden" });
    const broken = stubClient({
      seats: [{ data: null, error: { code: "XX000" } }],
    });
    await expect(
      inboxAsCaller(broken.client, "smash-kaikei", byline),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("markSeen", () => {
  it("sets seen_at on the caller's own route, only while it is unset", async () => {
    const { client, calls } = stubClient({
      prompt_routes: [{ data: [{ seen_at: SEEN_AT }], error: null }],
    });
    expect(
      SeenResponse.parse(await markSeen(client, "user-1", PROMPT_ID)),
    ).toEqual({ seenAt: SEEN_AT });
    const [update] = calls.prompt_routes;
    expect(update).toEqual(
      expect.arrayContaining([
        ["eq", "prompt_id", PROMPT_ID],
        ["eq", "user_id", "user-1"],
        ["is", "seen_at", null],
      ]),
    );
    const [, values] = update.find(([method]) => method === "update") ?? [];
    expect(values).toEqual({ seen_at: expect.any(String) });
  });

  it("answers the first open when the slip was opened before", async () => {
    const { client, calls } = stubClient({
      prompt_routes: [
        { data: [], error: null },
        { data: { seen_at: SEEN_AT }, error: null },
      ],
    });
    expect(await markSeen(client, "user-1", PROMPT_ID)).toEqual({
      seenAt: SEEN_AT,
    });
    expect(calls.prompt_routes[1]).toEqual(
      expect.arrayContaining([["eq", "user_id", "user-1"]]),
    );
  });

  it("404s a prompt that wasn't routed to the caller", async () => {
    const { client } = stubClient({
      prompt_routes: [
        { data: [], error: null },
        { data: null, error: null },
      ],
    });
    await expect(markSeen(client, "user-1", PROMPT_ID)).rejects.toMatchObject({
      name: "ApiFailure",
      code: "not_found",
    });
  });

  it("turns a policy refusal into forbidden", async () => {
    const { client } = stubClient({
      prompt_routes: [{ data: null, error: { code: "42501" } }],
    });
    await expect(markSeen(client, "user-1", PROMPT_ID)).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});
