// POST /api/inbox/seen (F3.6): the predecessor opened a slip, so its route gets seen_at. The first open counts.
import { SeenRequest } from "@/lib/contracts";
import { markSeen } from "@/lib/engine/inbox";
import { apiError, bearerToken, callerFor, failed } from "@/lib/engine/route";

export async function POST(request: Request): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return apiError("unauthorized");
  const parsed = SeenRequest.safeParse(
    await request.json().catch(() => undefined),
  );
  if (!parsed.success) return apiError("invalid_request");

  try {
    const caller = await callerFor(token);
    if (!caller) return apiError("unauthorized");
    return Response.json(
      await markSeen(caller.db, caller.userId, parsed.data.promptId),
    );
  } catch (error) {
    return failed("POST /api/inbox/seen", error);
  }
}
