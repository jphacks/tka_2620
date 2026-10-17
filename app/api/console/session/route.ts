import { handleConsoleSession } from "@/lib/engine/console";

// POST /api/console/session (F4.1): one console pane's own session. Off unless the server sets CONSOLE_SIGN_IN=1;
// lib/engine/console.ts says where it may be on.
export function POST(request: Request): Promise<Response> {
  return handleConsoleSession(request);
}
