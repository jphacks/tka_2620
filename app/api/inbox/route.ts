// GET /api/inbox?seat= (F3.6): the newcomers' questions waiting for this predecessor at a seat, oldest first. The flow
// lives in lib/engine/inbox.ts; askedBy is worded here with the seat type's label pack, in the reader's language (the
// NEXT_LOCALE cookie, Japanese by default).
import { getTranslations } from "next-intl/server";
import { InboxResponse, SeatQuery } from "@/lib/contracts";
import { inboxAsCaller } from "@/lib/engine/inbox";
import { apiError, bearerToken, callerFor, failed } from "@/lib/engine/route";

export async function GET(request: Request): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return apiError("unauthorized");
  const parsed = SeatQuery.safeParse({
    seat: new URL(request.url).searchParams.get("seat") ?? undefined,
  });
  if (!parsed.success) return apiError("invalid_request");

  try {
    const caller = await callerFor(token);
    if (!caller) return apiError("unauthorized");
    const t = await getTranslations();
    const inbox = await inboxAsCaller(
      caller.db,
      parsed.data.seat,
      (seatType, term, seat) =>
        t(`seatTypes.${seatType}.byline`, { term, seat }),
    );
    return Response.json(InboxResponse.parse(inbox));
  } catch (error) {
    // The code only: never a question (docs/SPEC.md → Scope rules).
    return failed("GET /api/inbox", error);
  }
}
