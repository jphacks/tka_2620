// GET /api/handover/readers (F6.1), offline: the count as the caller with a scripted Supabase client (the seat, what
// scope_readers() answers), plus the handler's checks before Supabase. 0011's counts against the seed world are checked
// on the database by `pnpm test:prompts`.
import { describe, expect, it } from "vitest";
import { ApiError, ReadersQuery, ReadersResponse } from "@/lib/contracts";
import { handleReaders, readersAsCaller } from "@/lib/engine/readers";
import { mockReaders } from "@/lib/mocks";
import { type Result, SMASH_KAIKEI, stubClient } from "./fakes";

const ok = (data: unknown): Result => ({ data, error: null });

async function run(
  options: { scope?: string; seat?: Result; counted?: Result } = {},
) {
  const stub = stubClient(
    { seats: [options.seat ?? ok({ id: SMASH_KAIKEI })] },
    { scope_readers: options.counted ?? ok(mockReaders.group) },
  );
  const query = ReadersQuery.parse({
    seat: "smash-kaikei",
    scope: options.scope ?? "group",
  });
  let result: unknown;
  let error: unknown;
  try {
    result = await readersAsCaller(stub.client, query);
  } catch (thrown) {
    error = thrown;
  }
  return { ...stub, result, error };
}

describe("readersAsCaller", () => {
  it("answers scope_readers()'s count for the seat and scope, and nothing else", async () => {
    const { result, rpcCalls, calls } = await run({ scope: "institution" });
    expect(ReadersResponse.parse(result)).toEqual({ count: mockReaders.group });
    expect(Object.keys(result ?? {})).toEqual(["count"]);
    expect(calls.seats?.[0]).toContainEqual(["eq", "slug", "smash-kaikei"]);
    expect(rpcCalls).toEqual([
      ["scope_readers", { seat: SMASH_KAIKEI, note_scope: "institution" }],
    ]);
  });

  it("answers zero: a 2026 note for later holders has no reader yet", async () => {
    const { result } = await run({ scope: "successor", counted: ok(0) });
    expect(result).toEqual({ count: 0 });
  });

  it("refuses an unknown seat before counting", async () => {
    const { error, rpcCalls } = await run({ seat: ok(null) });
    expect(error).toMatchObject({ name: "ApiFailure", code: "not_found" });
    expect(rpcCalls).toEqual([]);
  });

  it("answers forbidden when the caller doesn't hold the seat (42501)", async () => {
    const { error } = await run({
      counted: { data: null, error: { code: "42501" } },
    });
    expect(error).toMatchObject({ name: "ApiFailure", code: "forbidden" });
  });

  it.each<[string, Result]>([
    ["0011 not applied yet", { data: null, error: { code: "PGRST202" } }],
    ["no count", ok(null)],
    ["a negative count", ok(-1)],
    ["a row instead of a count", ok({ count: 2 })],
  ])("answers unavailable for %s", async (_case, counted) => {
    const { error } = await run({ counted });
    expect(error).toMatchObject({ name: "ApiFailure", code: "unavailable" });
  });
});

describe("handleReaders", () => {
  const get = (query: string, token?: string) =>
    new Request(`http://localhost/api/handover/readers${query}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  it("refuses a request without a token", async () => {
    const response = await handleReaders(get("?seat=smash-kaikei&scope=group"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects a query without a seat slug and one of the four scopes", async () => {
    for (const query of [
      "",
      "?seat=smash-kaikei",
      "?scope=group",
      "?seat=smash-kaikei&scope=everyone",
      "?seat=smash-kaikei&scope=GROUP",
      "?seat=Smash%20Kaikei&scope=group",
    ]) {
      const response = await handleReaders(get(query, "test-token"));
      expect(response.status, query).toBe(400);
      expect(ApiError.parse(await response.json()).error).toBe(
        "invalid_request",
      );
    }
  });
});
