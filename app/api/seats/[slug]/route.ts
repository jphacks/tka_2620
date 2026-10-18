// GET /api/seats/[slug] (F3.10, F7.1): the seat page's header, the viewer's own term, the lineage and the deadlines
// coming up. The flow lives in lib/engine/seat.ts and runs as the caller, so RLS decides; opening the page never grants
// membership.
import { SeatSlug, SeatView } from "@/lib/contracts";
import { apiError, bearerToken, callerFor, failed } from "@/lib/engine/route";
import { seatViewAsCaller } from "@/lib/engine/seat";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/seats/[slug]">,
): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return apiError("unauthorized");
  const slug = SeatSlug.safeParse((await params).slug);
  if (!slug.success) return apiError("invalid_request");

  try {
    const caller = await callerFor(token);
    if (!caller) return apiError("unauthorized");
    const view = await seatViewAsCaller(caller.db, slug.data);
    // One caller's own view (the deadline notes they may read): never kept by a cache on the way.
    return Response.json(SeatView.parse(view), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return failed("GET /api/seats/[slug]", error);
  }
}
