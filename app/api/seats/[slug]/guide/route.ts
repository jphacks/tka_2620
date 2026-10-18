// GET /api/seats/[slug]/guide: the handover guide (引き継ぎ書), the seat's notes the caller may read, what isn't written
// yet and the caller's own questions there. The flow lives in lib/engine/guide.ts and runs as the caller, so RLS
// decides; opening the guide never grants membership.
import { GuideView, SeatSlug } from "@/lib/contracts";
import { embed } from "@/lib/embed";
import { guideAsCaller } from "@/lib/engine/guide";
import { apiError, bearerToken, callerFor, failed } from "@/lib/engine/route";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/seats/[slug]/guide">,
): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return apiError("unauthorized");
  const slug = SeatSlug.safeParse((await params).slug);
  if (!slug.success) return apiError("invalid_request");

  try {
    const caller = await callerFor(token);
    if (!caller) return apiError("unauthorized");
    // One caller's own view (note bodies, their questions and answers): never kept by a cache on the way.
    return Response.json(
      GuideView.parse(await guideAsCaller(caller.db, slug.data, { embed })),
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    // The code only: never a note, a prompt or a question.
    return failed("GET /api/seats/[slug]/guide", error);
  }
}
