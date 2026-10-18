import { handleGap } from "@/lib/engine/gap";
import { handlePrompts } from "@/lib/engine/prompts";

// GET /api/handover/prompts?seat= (F6.1): the three prompts a holder of the seat is asked next, demand → gap → required
// → core, each with its reason. POST (F5.7): 「先輩に聞く」 on the import review turns a missing item's prompt into a gap
// prompt of the seat. Thin on purpose, like /api/import: the flows live in lib/engine/prompts.ts and lib/engine/gap.ts,
// where they can be tested, and the handlers act as the caller (Bearer token), so the database decides who reads and
// adds prompts.
export function GET(request: Request): Promise<Response> {
  return handlePrompts(request);
}

export function POST(request: Request): Promise<Response> {
  return handleGap(request);
}
