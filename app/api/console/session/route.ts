import { handleConsoleSession } from "@/lib/engine/console";

// POST /api/console/session (F4.1): one console pane's own session. Off unless the server sets CONSOLE_SIGN_IN to a
// passphrase and the request carries it (x-console-key); lib/engine/console.ts says why and where.
export function POST(request: Request): Promise<Response> {
  return handleConsoleSession(request);
}
