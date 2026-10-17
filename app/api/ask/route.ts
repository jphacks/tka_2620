import { handleAsk } from "@/lib/engine/ask";

// POST /api/ask (F3.5): the newcomer asks at a seat. Thin on purpose — the flow lives in lib/engine/ask.ts, so it
// can be tested and the engine stays in one folder. The handler acts as the caller (Bearer token), and RLS decides
// what may be read and written.
export function POST(request: Request): Promise<Response> {
  return handleAsk(request);
}
