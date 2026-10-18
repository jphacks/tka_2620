import { handleGap } from "@/lib/engine/gap";

// POST /api/handover/prompts (F5.7): 「先輩に聞く」 on the import review turns a missing item's prompt into a gap prompt
// of the seat. Thin on purpose, like /api/import: the flow lives in lib/engine/gap.ts, where it can be tested, and the
// handler acts as the caller (Bearer token), so the database decides who may add one. GET (the ranked prompts) is F6.1.
export function POST(request: Request): Promise<Response> {
  return handleGap(request);
}
