// Demo sign-in (lib/api.ts → signIn, signedIn, signOut; docs/SPEC.md → Auth). Without Supabase, Auth is a stubbed
// fetch: a password Auth turns down is unauthorized, a session Auth no longer knows is cleared, and signing out sends
// scope=local, so it ends this device's session only. Live, against the shared project: a25 signs in through the new
// client and the API answers as a25, a second device keeps working after the first signs out, and sign-ups are off.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { GET as inboxRoute } from "@/app/api/inbox/route";
import { GET as seatRoute } from "@/app/api/seats/[slug]/route";
import { signedIn, signIn, signOut } from "@/lib/api";
import { DEMO_EMAIL, DemoAccount } from "@/lib/contracts";

// The inbox words askedBy with the label pack, which needs Next; these tests check who it answers, not the words.
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

const realFetch = globalThis.fetch;
const root = fileURLToPath(new URL("..", import.meta.url));

const paths = (requests: Request[]) =>
  requests.map((request) => {
    const url = new URL(request.url);
    return `${request.method} ${url.pathname}${url.search}`;
  });

describe("the demo accounts", () => {
  it("are the personas scripts/seed.ts gives a password, with the emails it creates", () => {
    const seed = readFileSync(`${root}/scripts/seed.ts`, "utf8");
    const people = [
      ...seed.matchAll(
        /key: "([^"]+)",\s*alias: "([^"]+)",\s*signIn: (true|false)/g,
      ),
    ];
    // Fails loudly if the people list is ever written another way.
    expect(people.length).toBeGreaterThan(DemoAccount.options.length);
    const withPassword = people
      .filter(([, , , signsIn]) => signsIn === "true")
      .map(([, key, alias]) => [alias, `${key}@example.com`]);
    expect(Object.fromEntries(withPassword)).toEqual(DEMO_EMAIL);
  });

  it("keep the demo password out of client code and NEXT_PUBLIC_* variables", () => {
    const tracked = execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
    })
      .split("\0")
      .filter((file) =>
        /\.(ts|tsx|mts|js|mjs|json|md)$|^\.env\.example$/.test(file),
      );
    const naming = (pattern: RegExp, files: string[]) =>
      files.filter((file) =>
        pattern.test(readFileSync(`${root}/${file}`, "utf8")),
      );
    expect(naming(/NEXT_PUBLIC_\w*PASSWORD/, tracked)).toEqual([]);
    // Code that can reach a browser: screens, and lib/ outside the engine. (A UI string may name the variable for
    // the presenter; code never reads it.)
    const client = tracked.filter(
      (file) =>
        /^(app|components|lib|i18n)\/.*\.(ts|tsx|mts|js|mjs)$/.test(file) &&
        !/^(app\/api|lib\/engine)\//.test(file),
    );
    expect(client.length).toBeGreaterThan(0);
    expect(naming(/DEMO_PASSWORD/, client)).toEqual([]);
  });
});

// Supabase Auth and the app's routes as a stubbed fetch: each request is answered by "METHOD /path" and kept. A path
// with no answer fails like a network that's down.
type Answer = (request: Request) => Response | Promise<Response>;
function stubFetch(answers: Record<string, Answer>): Request[] {
  const requests: Request[] = [];
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const request = new Request(new URL(input, "http://app.test"), init);
    requests.push(request.clone());
    const answer =
      answers[`${request.method} ${new URL(request.url).pathname}`];
    if (!answer) throw new TypeError("fetch failed");
    return answer(request);
  });
  return requests;
}

const user = (email: string) => ({
  id: "00000000-0000-4000-8000-000000000102",
  aud: "authenticated",
  role: "authenticated",
  email,
  app_metadata: { provider: "email" },
  user_metadata: {},
  created_at: "2026-10-18T00:00:00Z",
});

const a25 = {
  access_token: "access-a25",
  refresh_token: "refresh-a25",
  token_type: "bearer",
  expires_in: 3600,
  user: user(DEMO_EMAIL.a25),
};

const refusal = (status: number, code: string) => () =>
  Response.json({ code: status, error_code: code, msg: code }, { status });

describe("signIn, signedIn and signOut (Auth stubbed)", () => {
  // Each test signs in under its own storage key: lib/api.ts keeps one client per key.
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://auth.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("signs a device in with the account's email, and its calls carry that session's token", async () => {
    const requests = stubFetch({
      "POST /auth/v1/token": () => Response.json(a25),
      "GET /api/inbox": () => Response.json({ items: [] }),
    });
    const { account, api } = await signIn("a25", "typed-password", "unit-in");
    expect(account).toBe("a25");
    await expect(api.inbox({ seat: "smash-kaikei" })).resolves.toEqual({
      items: [],
    });
    expect(paths(requests)).toEqual([
      "POST /auth/v1/token?grant_type=password",
      "GET /api/inbox?seat=smash-kaikei",
    ]);
    expect(await requests[0].json()).toMatchObject({
      email: "smash-kaikei-2025@example.com",
      password: "typed-password",
    });
    expect(requests[1].headers.get("authorization")).toBe("Bearer access-a25");
  });

  it("answers unauthorized for a password Auth turns down, unavailable when it doesn't answer", async () => {
    for (const [answer, code] of [
      [refusal(400, "invalid_credentials"), "unauthorized"],
      [refusal(429, "over_request_rate_limit"), "unavailable"],
      [undefined, "unavailable"], // offline
    ] as const) {
      stubFetch(answer ? { "POST /auth/v1/token": answer } : {});
      await expect(
        signIn("a26", "typed-password", "unit-refused"),
      ).rejects.toMatchObject({
        name: "ApiClientError",
        error: code,
      });
    }
    expect(await signedIn("unit-refused")).toBeUndefined();
  });

  it("signs out this device's session only, with scope=local", async () => {
    const requests = stubFetch({
      "POST /auth/v1/token": () => Response.json(a25),
      "POST /auth/v1/logout": () => new Response(null, { status: 204 }),
    });
    await signIn("a25", "typed-password", "unit-out");
    await signOut("unit-out");
    expect(paths(requests)).toEqual([
      "POST /auth/v1/token?grant_type=password",
      "POST /auth/v1/logout?scope=local",
    ]);
    expect(requests[1].headers.get("authorization")).toBe("Bearer access-a25");
    // Nothing left on this device, so nothing to check with Auth either.
    expect(await signedIn("unit-out")).toBeUndefined();
    expect(requests).toHaveLength(2);
  });

  it("signs out even when Auth can't be reached", async () => {
    stubFetch({ "POST /auth/v1/token": () => Response.json(a25) });
    await signIn("a25", "typed-password", "unit-out-offline");
    await expect(signOut("unit-out-offline")).resolves.toBeUndefined();
    expect(await signedIn("unit-out-offline")).toBeUndefined();
  });

  it("checks a stored session with Auth, and clears one Auth no longer knows (after pnpm demo:reset)", async () => {
    let known = true;
    const requests = stubFetch({
      "POST /auth/v1/token": () => Response.json(a25),
      "GET /auth/v1/user": () =>
        known ? Response.json(a25.user) : refusal(403, "user_not_found")(),
      "POST /auth/v1/logout": refusal(403, "user_not_found"),
    });
    await signIn("a25", "typed-password", "unit-reset");
    expect((await signedIn("unit-reset"))?.account).toBe("a25");
    known = false;
    expect(await signedIn("unit-reset")).toBeUndefined();
    expect(paths(requests).slice(2)).toEqual([
      "GET /auth/v1/user",
      "POST /auth/v1/logout?scope=local",
    ]);
    // Cleared: the next look finds nothing and asks Auth nothing.
    expect(await signedIn("unit-reset")).toBeUndefined();
    expect(requests).toHaveLength(4);
  });

  it("keeps the session when Auth can't be reached, for the next try", async () => {
    let online = false;
    stubFetch({
      "POST /auth/v1/token": () => Response.json(a25),
      "GET /auth/v1/user": () => {
        if (!online) throw new TypeError("fetch failed");
        return Response.json(a25.user);
      },
    });
    await signIn("a25", "typed-password", "unit-offline");
    await expect(signedIn("unit-offline")).rejects.toMatchObject({
      error: "unavailable",
    });
    online = true;
    expect((await signedIn("unit-offline"))?.account).toBe("a25");
  });

  it("counts a user outside the demo accounts as signed out", async () => {
    stubFetch({
      "POST /auth/v1/token": () => Response.json(a25),
      "GET /auth/v1/user": () => Response.json(user("someone@example.org")),
      "POST /auth/v1/logout": () => new Response(null, { status: 204 }),
    });
    await signIn("a25", "typed-password", "unit-stranger");
    expect(await signedIn("unit-stranger")).toBeUndefined();
  });
});

// Live: the public URL and key and the demo password, from the shell or .env.local; never the service-role key.
const names = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "DEMO_PASSWORD",
] as const;
const envFile = `${root}/.env.local`;
const fromFile = existsSync(envFile)
  ? parseEnv(readFileSync(envFile, "utf8"))
  : {};
const env = Object.fromEntries(
  names.map((name) => [name, process.env[name] || fromFile[name] || ""]),
) as Record<(typeof names)[number], string>;
const missing = names.filter((name) => !env[name]);

// Two devices signed in as a25. Both are signed out again (scope local) at the end; nothing else is written.
const LAPTOP = "live-laptop";
const PHONE = "live-phone";

describe.skipIf(missing.length > 0)("live, two devices as a25", () => {
  // What each /api call carried, by path: the browser's fetch reaches the route handlers in this process, as next dev
  // would serve them; every other request (Supabase) goes out.
  const sent: { path: string; authorization: string }[] = [];

  beforeAll(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", env.NEXT_PUBLIC_SUPABASE_URL);
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof input !== "string" || !input.startsWith("/api/")) {
        return realFetch(input, init);
      }
      const request = new Request(`http://localhost${input}`, init);
      const { pathname } = new URL(request.url);
      sent.push({
        path: pathname,
        authorization: request.headers.get("authorization") ?? "",
      });
      if (pathname === "/api/inbox") return inboxRoute(request);
      const slug = pathname.match(/^\/api\/seats\/([^/]+)$/)?.[1];
      if (!slug) throw new Error(`no route for ${pathname} in this test`);
      return seatRoute(request, {
        params: Promise.resolve({ slug: decodeURIComponent(slug) }),
      });
    });
  });
  afterAll(async () => {
    await Promise.all([signOut(LAPTOP), signOut(PHONE)]);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("signs in as smash-kaikei-2025 through the new client, and /api/inbox answers as a25", async () => {
    const laptop = await signIn("a25", env.DEMO_PASSWORD, LAPTOP);
    // Contract-checked by the client; empty at the seed state.
    const inbox = await laptop.api.inbox({ seat: "smash-kaikei" });
    expect(Array.isArray(inbox.items)).toBe(true);
    // The inbox's caller is the token's user, and that user is a25: the seat says so.
    const [call] = sent.filter((entry) => entry.path === "/api/inbox");
    const claims = JSON.parse(
      Buffer.from(call.authorization.split(".")[1], "base64url").toString(),
    );
    expect(claims.email).toBe("smash-kaikei-2025@example.com");
    const seat = await laptop.api.seat("smash-kaikei");
    expect(seat.viewer).toEqual({ isHolder: true, termLabel: "2025" });
    expect(
      sent.filter((entry) => entry.path === "/api/seats/smash-kaikei")[0]
        .authorization,
    ).toBe(call.authorization);
    expect((await signedIn(LAPTOP))?.account).toBe("a25");
  });

  it("signs one device out and leaves the other device's session working", async () => {
    const phone = await signIn("a25", env.DEMO_PASSWORD, PHONE);
    const laptopToken = sent.find(
      (entry) => entry.path === "/api/inbox",
    )?.authorization;
    expect(laptopToken).toMatch(/^Bearer /);

    await signOut(LAPTOP);
    expect(await signedIn(LAPTOP)).toBeUndefined();
    // Auth ended the laptop's session itself, not just this device's copy.
    const ended = await realFetch(
      `${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          authorization: laptopToken ?? "",
        },
      },
    );
    expect(ended.status).toBe(403);
    expect(await ended.text()).toContain("session_not_found");

    // The phone's session is still one Auth knows, and the API still answers it.
    expect((await signedIn(PHONE))?.account).toBe("a25");
    const inbox = await phone.api.inbox({ seat: "smash-kaikei" });
    expect(Array.isArray(inbox.items)).toBe(true);
  });

  it("has sign-ups off in Supabase Auth, since the anon key is public", async () => {
    const response = await realFetch(
      `${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`,
      { headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY } },
    );
    expect(response.ok).toBe(true);
    expect((await response.json()).disable_signup).toBe(true);
  });
});
