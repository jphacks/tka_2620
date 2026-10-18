// POST /api/import (F5.5): text extracted and redacted on the device becomes dated note cards for the author to review
// and a list of what it leaves out (docs/SPEC.md → adding knowledge, steps 6–8). Nothing is stored: the text, the cards
// and the missing list live only in this request and its response, and publishing is POST /api/handover/publish. Only
// counts go to events.
//
// Everything runs as the caller (lib/engine/route.ts): only a holder of the seat adds to it, the seat's prompts are
// the ones its policy lets the caller read, the similar notes are the ones search_notes (0004) lets them find
// (lib/engine/similar.ts, F5.6), and the counts go through record_import() (0008).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { sonnet } from "@/lib/ai";
import {
  ImportRequest,
  ImportResponse,
  PromptKind,
  SeatType,
  Uuid,
} from "@/lib/contracts";
import { embed } from "@/lib/embed";
import { extractNotes } from "@/lib/engine/extract-notes";
import {
  ApiFailure,
  apiError,
  bearerToken,
  callerFor,
  dbFailure,
  failed,
  logFailure,
} from "@/lib/engine/route";
import { screenImport, seedCanaries } from "@/lib/engine/safety-net";
import { similarNotes } from "@/lib/engine/similar";

const ROUTE = "POST /api/import";

// The models, passed in so a test can fake them (Sonnet for the cards, bge-m3 for the similar notes), and the canaries
// the safety net looks for.
export type ImportDeps = {
  model: () => LanguageModel;
  embed: (texts: string[]) => Promise<number[][]>;
  canaries: readonly string[];
  today?: string; // YYYY-MM-DD; the day in Japan unless a test sets it
};

export async function handleImport(request: Request): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return apiError("unauthorized");
  const parsed = ImportRequest.safeParse(
    await request.json().catch(() => undefined),
  );
  if (!parsed.success) return apiError("invalid_request");

  try {
    const caller = await callerFor(token);
    if (!caller) return apiError("unauthorized");
    return Response.json(
      await importAsCaller(caller.db, caller.userId, parsed.data, {
        model: sonnet,
        embed,
        canaries: seedCanaries(),
      }),
    );
  } catch (error) {
    // The code and the error's class only: a message can quote the text, a card or the model's reply.
    return failed(ROUTE, error);
  }
}

const SeatRow = z.object({ id: Uuid, name: z.string(), seat_type: SeatType });
const PromptRows = z.array(z.object({ kind: PromptKind, text: z.string() }));

export async function importAsCaller(
  client: SupabaseClient,
  userId: string,
  request: ImportRequest,
  deps: ImportDeps,
): Promise<ImportResponse> {
  const { data: seatRow, error: seatError } = await client
    .from("seats")
    .select("id, name, seat_type")
    .eq("slug", request.seat)
    .maybeSingle();
  if (seatError) throw dbFailure(seatError);
  if (!seatRow) throw new ApiFailure("not_found");
  const seat = SeatRow.parse(seatRow);

  // Only a holder of the seat adds to it, as only a holder publishes there, so no one else's text reaches the model.
  // The latest term is the one a publish signs with, which decides the notes a card may update (lib/engine/similar.ts).
  const { data: terms, error: termError } = await client
    .from("seat_holders")
    .select("term_order")
    .eq("seat_id", seat.id)
    .eq("user_id", userId)
    .order("term_order", { ascending: false })
    .limit(1);
  if (termError) throw dbFailure(termError);
  const term = z
    .array(z.object({ term_order: z.number().int() }))
    .parse(terms ?? [])[0];
  if (!term) throw new ApiFailure("forbidden");

  const kind = {
    chat: Number(request.kind === "chat"),
    file: Number(request.kind === "file"),
  };
  const screened = screenImport(request.text, deps.canaries);
  if (!screened.ok) {
    await record(client, seat.id, {
      ...kind,
      ...request.redaction,
      rejected: 1,
      phones_left: screened.phones,
      emails_left: screened.emails,
      canaries_left: screened.canaries,
    });
    throw new ApiFailure("unredacted");
  }

  // The checklist is what every holder of the seat should know (core and required prompts); asked is what someone
  // still waits to hear (demand and gap prompts). The prompts policy decides which the caller reads: a demand prompt
  // only where it was routed to them.
  const { data: promptRows, error: promptError } = await client
    .from("prompts")
    .select("kind, text")
    .eq("seat_id", seat.id)
    .eq("retired", false)
    .limit(50);
  if (promptError) throw dbFailure(promptError);
  const prompts = PromptRows.parse(promptRows ?? []);
  const texts = (kinds: PromptKind[]) =>
    prompts
      .filter((prompt) => kinds.includes(prompt.kind))
      .map((prompt) => prompt.text);

  const extracted = await extractNotes({
    model: deps.model(),
    text: screened.text,
    kind: request.kind,
    seat: { name: seat.name, seatType: seat.seat_type },
    checklist: texts(["core", "required"]),
    asked: texts(["demand", "gap"]),
    today: deps.today ?? today(),
  });
  await record(client, seat.id, {
    ...kind,
    ...request.redaction,
    rehidden: screened.rehidden,
    cards: extracted.cards.length,
    blocked: extracted.blocked.length,
    missing: extracted.missing.length,
    dates_dropped: extracted.datesDropped,
    dates_fixed: extracted.datesFixed,
  });
  // Only advice for the review: without it (Ollama stopped, a failed search) the cards still come back, each to be
  // published as a note of its own.
  const duplicates = await similarNotes(client, {
    seat: { id: seat.id, slug: request.seat },
    term: term.term_order,
    cards: extracted.cards,
    embed: deps.embed,
  }).catch((error: unknown) => {
    logFailure(`${ROUTE}: similar notes`, error);
    return [];
  });
  return ImportResponse.parse({
    cards: extracted.cards,
    missing: extracted.missing,
    blocked: extracted.blocked,
    duplicates,
  });
}

// One events row per import, numbers only: never the text, a card or a missing item. A record, not part of the answer:
// a failure (before 0008 is applied, record_import doesn't exist) is logged by its code and the import goes on. The
// counts the browser sent are the caller's word, so they're capped at what a request can hold.
async function record(
  client: SupabaseClient,
  seat: string,
  counts: Record<string, number>,
): Promise<void> {
  const capped = Object.fromEntries(
    Object.entries(counts).map(([key, count]) => [
      key,
      Math.min(count, 100_000),
    ]),
  );
  const { error } = await client.rpc("record_import", { seat, counts: capped });
  if (error) logFailure(`${ROUTE}: counts`, dbFailure(error));
}

// The day of the import in Japan: a date the text gives without any year takes this year or the next.
function today(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(
    new Date(),
  );
}
