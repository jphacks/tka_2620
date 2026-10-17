import { handlePublish } from "@/lib/engine/publish";

// POST /api/handover/publish (F3.8): the predecessor publishes cards as notes, and every question waiting on the prompt
// is answered again, signed. Thin on purpose, like /api/ask: the flow lives in lib/engine/publish.ts, where it can be
// tested, and the handler acts as the caller (Bearer token), so RLS decides what may be read and written.
export function POST(request: Request): Promise<Response> {
  return handlePublish(request);
}
