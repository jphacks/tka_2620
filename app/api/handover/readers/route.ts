import { handleReaders } from "@/lib/engine/readers";

// GET /api/handover/readers?seat=&scope= (F6.1): how many people besides the caller a note at that scope would reach, for
// the scope picker. Thin on purpose, like /api/handover/prompts: the flow lives in lib/engine/readers.ts, where it can be
// tested, and the handler acts as the caller (Bearer token), so the database counts, for a holder of the seat only.
export function GET(request: Request): Promise<Response> {
  return handleReaders(request);
}
