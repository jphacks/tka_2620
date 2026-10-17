// POST /api/console/session (lib/engine/console.ts) and the real client (lib/api.ts), without Supabase: the sign-in
// and fetch are stubbed. The route is off unless CONSOLE_SIGN_IN=1, signs in only the console's three personas, and
// never answers with more than the session; the client sends the pane's own token and checks every answer.
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, createApi } from "@/lib/api";
import { ApiError, type ConsolePersona } from "@/lib/contracts";
import { handleConsoleSession, type SignIn } from "@/lib/engine/console";
import { mockAnswer, mockSeatViews } from "@/lib/mocks";

const post = (body: unknown) =>
  new Request("http://localhost/api/console/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const session = (persona: ConsolePersona) => ({
  accessToken: `access-${persona}`,
  refreshToken: `refresh-${persona}`,
});

describe("POST /api/console/session", () => {
  it("doesn't exist unless the server turned it on", async () => {
    const signIn = vi.fn<SignIn>();
    const response = await handleConsoleSession(post({ persona: "a25" }), {
      enabled: false,
      signIn,
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(signIn).not.toHaveBeenCalled();
  });

  it("is off when CONSOLE_SIGN_IN isn't exactly 1", async () => {
    vi.stubEnv("CONSOLE_SIGN_IN", "true");
    const response = await handleConsoleSession(post({ persona: "a25" }), {
      signIn: async (persona) => session(persona),
    });
    expect(response.status).toBe(404);
    vi.unstubAllEnvs();
  });

  it("signs in each console persona with a session of its own", async () => {
    for (const persona of ["a26", "a25", "x"] as const) {
      const response = await handleConsoleSession(post({ persona }), {
        enabled: true,
        signIn: async (who) => session(who),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(session(persona));
    }
  });

  it("refuses personas outside the console and malformed bodies", async () => {
    const signIn = vi.fn<SignIn>();
    for (const body of [{ persona: "a24" }, { persona: "b" }, {}, "a25"]) {
      const response = await handleConsoleSession(post(body), {
        enabled: true,
        signIn,
      });
      expect(response.status).toBe(400);
    }
    expect(signIn).not.toHaveBeenCalled();
  });

  it("answers unavailable when the sign-in fails, without the reason", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await handleConsoleSession(post({ persona: "a25" }), {
      enabled: true,
      signIn: async () => {
        throw new Error("Invalid login credentials for smash-kaikei-2025");
      },
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect(error.mock.calls.flat().join(" ")).not.toContain("smash-kaikei");
    error.mockRestore();
  });
});

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

  it("calls the route as the pane's user and checks the answer", async () => {
    const fetch = vi.fn(async () => Response.json(mockSeatViews.a26));
    vi.stubGlobal("fetch", fetch);
    const api = createApi(fakeDb("token-a26").db);
    expect(await api.seat("smash-kaikei")).toEqual(mockSeatViews.a26);
    expect(fetch).toHaveBeenCalledWith("/api/seats/smash-kaikei", {
      method: "GET",
      headers: { authorization: "Bearer token-a26" },
      body: undefined,
    });
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
