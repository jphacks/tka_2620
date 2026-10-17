// POST /api/console/session (F4.1, #25): signs one of the console's personas in, so each of the three panes runs as
// its own user with its own Supabase client (docs/SPEC.md → Console panes). The demo password stays on the server;
// the pane gets that persona's session and nothing else.
//
// Off unless the server running the console sets CONSOLE_SIGN_IN=1 (the presenter's laptop): anywhere else the route
// answers not_found, as if it didn't exist. With it on, anyone who can reach that server can get these three demo
// sessions, so turn it on only where the audience can't reach (localhost, or the team's tailnet without Funnel),
// never on a public deployment. The accounts hold synthetic seed data only; `pnpm demo:reset` restores them.
// A browser on another site can't read the answer: there are no CORS headers, and a JSON body needs a preflight.
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

export type SignIn = (persona: ConsolePersona) => Promise<ConsoleSession>;

export async function handleConsoleSession(
  request: Request,
  {
    enabled = process.env.CONSOLE_SIGN_IN === "1",
    signIn = signInWithDemoPassword,
  }: { enabled?: boolean; signIn?: SignIn } = {},
): Promise<Response> {
  if (!enabled) return apiError("not_found");
  const parsed = ConsoleSessionRequest.safeParse(
    await request.json().catch(() => undefined),
  );
  if (!parsed.success) return apiError("invalid_request");
  try {
    return Response.json(await signIn(parsed.data.persona));
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
