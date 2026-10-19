// GET /api/seats/[slug]/asked: the caller's own questions at the seat and their answers, checked again, so 聞く lists
// them after a reload or a closed tab. The flow lives in lib/engine/asked.ts and runs as the caller, so RLS decides; it
// embeds nothing (unlike the guide, no Ollama), and opening it never grants membership.
import { AskedView, SeatSlug } from "@/lib/contracts";
import { askedAsCaller } from "@/lib/engine/asked";
import { apiError, bearerToken, callerFor, failed } from "@/lib/engine/route";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/seats/[slug]/asked">,
): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return apiError("unauthorized");
  const slug = SeatSlug.safeParse((await params).slug);
  if (!slug.success) return apiError("invalid_request");

  try {
    const caller = await callerFor(token);
    if (!caller) return apiError("unauthorized");
    // One caller's own questions and answers: never kept by a cache on the way.
    return Response.json(
      AskedView.parse(await askedAsCaller(caller.db, slug.data)),
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    // The code only: never a question, an answer or a note.
    return failed("GET /api/seats/[slug]/asked", error);
  }
}
