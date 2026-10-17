// POST /api/console/session (F4.1, #25): signs one of the console's personas in, so each of the three panes runs as
// its own user with its own Supabase client (docs/SPEC.md → Console panes). The demo password stays on the server;
// the pane gets that persona's session and nothing else.
//
// Off unless the server running the console sets CONSOLE_SIGN_IN to a passphrase of at least 16 characters (the
// presenter's laptop only, never a hosted deployment; generate it, e.g. `openssl rand -hex 16`, never words). The seat
// pages sign in the same way (components/SeatSignIn.tsx), and the demo phone reaches them through Tailscale Funnel,
// which puts this route on the public internet: run Funnel only for the demo and `pnpm demo:reset` after it, and
// remember the passphrase opens all three personas. Off, the route answers not_found, as if it didn't exist. On,
// a request must also carry that passphrase in x-console-key, or it gets not_found too. The passphrase is the
// boundary, not the network: `next dev` listens on every interface, the repo is public, and at a hackathon anyone on
// the venue Wi-Fi could otherwise take the three demo accounts mid-demo. The console reads it from its URL fragment
// (/console#key=…), which never reaches a server or a log. The custom header means a page on another site needs a
// preflight it doesn't get (no CORS headers), and the answer is never cached. The accounts hold synthetic seed data
// only; `pnpm demo:reset` recreates them, which also ends every session handed out.
import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  type ConsolePersona,
  type ConsoleSession,
  ConsoleSessionRequest,
} from "@/lib/contracts";
import { ApiFailure, apiError, failed } from "@/lib/engine/route";

// scripts/seed.ts gives each persona the account <key>@example.com (scripts/check-ask.ts uses the same keys).
const ACCOUNT: Record<ConsolePersona, string> = {
  a26: "smash-kaikei-2026",
  a25: "smash-kaikei-2025",
  x: "yamate-outsider",
};

// Shorter than this counts as off: "1" or "true" must not turn the route on.
const MIN_PASSPHRASE = 16;

export type SignIn = (persona: ConsolePersona) => Promise<ConsoleSession>;

// The request's x-console-key against the passphrase, in constant time.
function keyMatches(request: Request, passphrase: string): boolean {
  const given = Buffer.from(request.headers.get("x-console-key") ?? "");
  const expected = Buffer.from(passphrase);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function handleConsoleSession(
  request: Request,
  {
    passphrase = process.env.CONSOLE_SIGN_IN,
    signIn = signInWithDemoPassword,
  }: { passphrase?: string; signIn?: SignIn } = {},
): Promise<Response> {
  if (
    !passphrase ||
    passphrase.length < MIN_PASSPHRASE ||
    !keyMatches(request, passphrase)
  ) {
    return apiError("not_found");
  }
  const parsed = ConsoleSessionRequest.safeParse(
    await request.json().catch(() => undefined),
  );
  if (!parsed.success) return apiError("invalid_request");
  try {
    return Response.json(await signIn(parsed.data.persona), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    // The code only: never the email or the password.
    return failed("POST /api/console/session", error);
  }
}

// A fresh sign-in per call, so each pane has a session of its own; nothing is kept here.
export async function signInWithDemoPassword(
  persona: ConsolePersona,
): Promise<ConsoleSession> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const password = process.env.DEMO_PASSWORD;
  if (!url || !anonKey || !password) throw new ApiFailure("unavailable");
  const db = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await db.auth.signInWithPassword({
    email: `${ACCOUNT[persona]}@example.com`,
    password,
  });
  if (error || !data.session) throw new ApiFailure("unavailable");
  return {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
  };
}
