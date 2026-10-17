import { handleWithdraw } from "@/lib/engine/notes";

// POST /api/notes/[id]/withdraw (F4.2): the author withdraws their note, and every answer that cited it is answered
// again without it. The flow lives in lib/engine/notes.ts; the handler acts as the caller (Bearer token).
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/notes/[id]/withdraw">,
): Promise<Response> {
  const { id } = await params;
  return handleWithdraw(request, id);
}
