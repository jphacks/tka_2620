// The real client (lib/api.ts → createApi), without Supabase: fetch and the session are stubbed. It sends the session's
// own token, checks every answer against its contract, and passes on only the Realtime rows that match. (Until #89 these
// lived in tests/console-session.test.ts, beside the passphrase route they outlived.)
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, createApi } from "@/lib/api";
import { ApiError } from "@/lib/contracts";
import { mockAnswer, mockSeatViews } from "@/lib/mocks";

// A Supabase client with a fixed session and a Realtime channel that hands its callback to the test.
function fakeDb(token: string | undefined) {
  let push: ((change: { new: unknown }) => void) | undefined;
  const removed: unknown[] = [];
  const channel = {
    on: (_type: string, _filter: unknown, callback: typeof push) => {
      push = callback;
      return channel;
    },
    subscribe: () => channel,
  };
  const db = {
    auth: {
      getSession: async () => ({
        data: { session: token ? { access_token: token } : null },
      }),
    },
    channel: () => channel,
    removeChannel: async (subscription: unknown) => {
      removed.push(subscription);
    },
  } as unknown as SupabaseClient;
  return { db, push: (row: unknown) => push?.({ new: row }), removed };
}

describe("createApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("calls the route as the session's user and checks the answer", async () => {
    const fetch = vi.fn(async () => Response.json(mockSeatViews.a26));
    vi.stubGlobal("fetch", fetch);
    const api = createApi(fakeDb("token-a26").db);
    expect(await api.seat("smash-kaikei")).toEqual(mockSeatViews.a26);
    expect(fetch).toHaveBeenCalledWith("/api/seats/smash-kaikei", {
      method: "GET",
      headers: { authorization: "Bearer token-a26" },
      body: undefined,
      signal: expect.any(AbortSignal),
    });
  });

  it("cuts off a read that stalls, as unavailable, and leaves writes without a limit", async () => {
    // AbortSignal.timeout, fired at once: the stalled read gives up like a route that didn't answer.
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const stop = new AbortController();
      queueMicrotask(() =>
        stop.abort(new DOMException("stalled", "TimeoutError")),
      );
      return stop.signal;
    });
    const fetch = vi.fn(
      (_path: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const api = createApi(fakeDb("token-a26").db);
    const stalled = await api.seat("smash-kaikei").catch((e) => e);
    expect(stalled).toBeInstanceOf(ApiClientError);
    expect(stalled.error).toBe("unavailable");
    expect(timeout).toHaveBeenCalledWith(20_000);

    fetch.mockImplementationOnce(async () => Response.json(mockAnswer));
    await api.ask({ seat: "smash-kaikei", question: "いつまで？" });
    expect(fetch.mock.calls.at(-1)?.[1]).not.toHaveProperty("signal");
    timeout.mockRestore();
  });

  it("posts JSON and parses the contract", async () => {
    const fetch = vi.fn(async () => Response.json(mockAnswer));
    vi.stubGlobal("fetch", fetch);
    const api = createApi(fakeDb("token-a26").db);
    const request = { seat: "smash-kaikei", question: "いつまで？" };
    expect(await api.ask(request)).toEqual(mockAnswer);
    expect(fetch).toHaveBeenCalledWith("/api/ask", {
      method: "POST",
      headers: {
        authorization: "Bearer token-a26",
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });
  });

  it("throws the route's error code, and unavailable for an off-contract answer", async () => {
    const api = createApi(fakeDb("token-a25").db);
    vi.stubGlobal("fetch", async () =>
      Response.json({ error: "forbidden" }, { status: 403 }),
    );
    const refused = await api.withdraw("smash-2024-hokenjo").catch((e) => e);
    expect(refused).toBeInstanceOf(ApiClientError);
    expect(ApiError.safeParse(refused).data).toEqual({ error: "forbidden" });

    vi.stubGlobal("fetch", async () => Response.json({ notes: [{ id: 1 }] }));
    expect((await api.myNotes().catch((e) => e)).error).toBe("unavailable");
  });

  it("doesn't call a route without a session", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const api = createApi(fakeDb(undefined).db);
    expect((await api.myNotes().catch((e) => e)).error).toBe("unauthorized");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("passes on Realtime rows that match the contract and drops the rest", () => {
    const { db, push, removed } = fakeDb("token-a25");
    const rows: unknown[] = [];
    const stop = createApi(db).subscribe("notes", (row) => rows.push(row));
    push({ id: "smash-2025-hokenjo", status: "withdrawn", body: "…" });
    push({ id: "smash-2025-hokenjo", status: "gone" });
    expect(rows).toEqual([{ id: "smash-2025-hokenjo", status: "withdrawn" }]);
    stop();
    expect(removed).toHaveLength(1);
  });
});
