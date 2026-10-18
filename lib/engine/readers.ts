// GET /api/handover/readers?seat=&scope= (F6.1): how many people besides the caller could read a note they publish at the
// seat with that scope, for the scope picker (「{n}人が読めます」, docs/SPEC.md → F6). Counts only, never who: the rings
// are other people's memberships, so scope_readers() (0011) counts them with the notes policy's own check, for a holder
// of the seat (42501, forbidden, for anyone else). Runs as the caller (lib/engine/route.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ReadersQuery, ReadersResponse, Uuid } from "@/lib/contracts";
import {
  ApiFailure,
  apiError,
  bearerToken,
  callerFor,
  dbFailure,
  failed,
} from "@/lib/engine/route";

const ROUTE = "GET /api/handover/readers";

export async function handleReaders(request: Request): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return apiError("unauthorized");
  const params = new URL(request.url).searchParams;
  const parsed = ReadersQuery.safeParse({
    seat: params.get("seat") ?? undefined,
    scope: params.get("scope") ?? undefined,
  });
  if (!parsed.success) return apiError("invalid_request");

  try {
    const caller = await callerFor(token);
    if (!caller) return apiError("unauthorized");
    return Response.json(await readersAsCaller(caller.db, parsed.data));
  } catch (error) {
    return failed(ROUTE, error);
  }
}

const SeatRow = z.object({ id: Uuid });

export async function readersAsCaller(
  client: SupabaseClient,
  query: ReadersQuery,
): Promise<ReadersResponse> {
  const { data: seatRow, error: seatError } = await client
    .from("seats")
    .select("id")
    .eq("slug", query.seat)
    .maybeSingle();
  if (seatError) throw dbFailure(seatError);
  if (!seatRow) throw new ApiFailure("not_found");
  const seat = SeatRow.safeParse(seatRow);
  if (!seat.success) throw new ApiFailure("unavailable");

  const { data, error } = await client.rpc("scope_readers", {
    seat: seat.data.id,
    note_scope: query.scope,
  });
  if (error) throw dbFailure(error);
  const readers = ReadersResponse.safeParse({ count: data });
  if (!readers.success) throw new ApiFailure("unavailable");
  return readers.data;
}
