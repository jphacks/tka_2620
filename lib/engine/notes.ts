// The author's own notes (F4.2): POST /api/notes/[id]/withdraw and GET /api/me/notes, and one note a citation rests on
// (F2.4): GET /api/notes/[id]. All run as the caller (lib/engine/route.ts), so the database decides: withdraw_note()
// (0006) refuses a note the caller didn't write and answers again every saved answer that cited it, and the notes
// policy (0002/0003) shows the author their own notes, withdrawn ones included, and anyone else only the live notes in
// their scope. Only GET /api/notes/[id] reads a body, and nothing here logs one.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  IsoDate,
  Lang,
  MyNote,
  type MyNotesResponse,
  NoteId,
  NoteKind,
  NoteStatus,
  NoteView,
  Scope,
  SeatSlug,
  Timestamp,
  type WithdrawResponse,
} from "@/lib/contracts";
import {
  ApiFailure,
  apiError,
  bearerToken,
  callerFor,
  dbFailure,
  failed,
} from "@/lib/engine/route";

// A route handler's work once the caller is known, so the handlers stay a few lines and the flow can be tested with
// a stub client.
async function asCaller(
  request: Request,
  route: string,
  work: (client: SupabaseClient, userId: string) => Promise<unknown>,
): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return apiError("unauthorized");
  try {
    const caller = await callerFor(token);
    if (!caller) return apiError("unauthorized");
    return Response.json(await work(caller.db, caller.userId));
  } catch (error) {
    return failed(route, error);
  }
}

// POST /api/notes/[id]/withdraw ---------------------------------------------------------------

export function handleWithdraw(
  request: Request,
  id: string,
): Promise<Response> {
  if (!NoteId.safeParse(id).success) {
    return Promise.resolve(apiError("invalid_request"));
  }
  return asCaller(request, "POST /api/notes/[id]/withdraw", (client) =>
    withdrawAsCaller(client, id),
  );
}

// withdraw_note() answers with the withdrawn_at it set (or set before: withdrawing twice changes nothing). A note the
// caller didn't write is refused with 42501 → forbidden, the same for one that doesn't exist, so the answer never
// tells whether someone else's note is there.
export async function withdrawAsCaller(
  client: SupabaseClient,
  id: string,
): Promise<WithdrawResponse> {
  const { data, error } = await client.rpc("withdraw_note", { note: id });
  if (error) throw dbFailure(error);
  const withdrawnAt = Timestamp.safeParse(data);
  if (!withdrawnAt.success) throw new ApiFailure("unavailable");
  return { withdrawnAt: withdrawnAt.data };
}

// GET /api/me/notes ---------------------------------------------------------------------------

export function handleMyNotes(request: Request): Promise<Response> {
  return asCaller(request, "GET /api/me/notes", (client, userId) =>
    myNotesAsCaller(client, userId),
  );
}

// seat: the seat the note was written at, embedded through notes.seat_id (seats are readable by everyone).
const NoteRow = z.object({
  id: NoteId,
  title: z.string(),
  scope: Scope,
  status: NoteStatus,
  lang: Lang,
  seat: z.object({ slug: SeatSlug }),
});

// 自分のメモ: every note the caller wrote, live and withdrawn, newest first, each with its seat's slug so the scope
// label uses that seat's words. The author filter is the request; the policy is what keeps other people's withdrawn
// notes out.
export async function myNotesAsCaller(
  client: SupabaseClient,
  userId: string,
): Promise<MyNotesResponse> {
  const { data, error } = await client
    .from("notes")
    .select("id, title, scope, status, lang, seat:seats(slug)")
    .eq("author_user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw dbFailure(error);
  const rows = z.array(NoteRow).safeParse(data);
  if (!rows.success) throw new ApiFailure("unavailable");
  return {
    notes: rows.data.map(({ seat, ...row }) =>
      MyNote.parse({ ...row, seat: seat.slug }),
    ),
  };
}

// GET /api/notes/[id] -------------------------------------------------------------------------

export function handleNote(request: Request, id: string): Promise<Response> {
  if (!NoteId.safeParse(id).success) {
    return Promise.resolve(apiError("invalid_request"));
  }
  return asCaller(request, "GET /api/notes/[id]", (client) =>
    noteAsCaller(client, id),
  );
}

const SourceRow = z.object({
  id: NoteId,
  kind: NoteKind,
  title: z.string(),
  body: z.string(),
  deadline_date: IsoDate.nullable(),
  lang: Lang,
  byline: z.string(),
});

// The note a citation's stamp opens. The policy decides what the caller may read; this adds only that the note is
// live, so the author's own withdrawn note is gone here too, as it is from every answer. A note out of scope comes back
// as no row, the same as a missing one, so the answer never tells whether it exists. The author, the scope, the note
// that superseded it and the embedding are never selected.
export async function noteAsCaller(
  client: SupabaseClient,
  id: string,
): Promise<NoteView> {
  const { data, error } = await client
    .from("notes")
    .select("id, kind, title, body, deadline_date, lang, byline")
    .eq("id", id)
    .eq("status", "live")
    .maybeSingle();
  if (error) throw dbFailure(error);
  if (!data) throw new ApiFailure("not_found");
  const row = SourceRow.safeParse(data);
  if (!row.success) throw new ApiFailure("unavailable");
  const { deadline_date, ...note } = row.data;
  return NoteView.parse({
    ...note,
    ...(deadline_date && { deadlineDate: deadline_date }),
  });
}
