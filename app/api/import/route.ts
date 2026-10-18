import { handleImport } from "@/lib/engine/import";

// POST /api/import (F5.5): redacted text from the device → dated note cards to review and what the text leaves out.
// Thin on purpose, like /api/handover/publish: the flow lives in lib/engine/import.ts, where it can be tested, and the
// handler acts as the caller (Bearer token), so RLS decides what may be read. Nothing is stored or logged.
export function POST(request: Request): Promise<Response> {
  return handleImport(request);
}
