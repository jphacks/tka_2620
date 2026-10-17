import { handleNote } from "@/lib/engine/notes";

// GET /api/notes/[id] (F2.4): the note a citation's stamp opens, when the caller may read it. The flow lives in
// lib/engine/notes.ts; the handler acts as the caller (Bearer token), so the notes policy decides.
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/notes/[id]">,
): Promise<Response> {
  const { id } = await params;
  return handleNote(request, id);
}
