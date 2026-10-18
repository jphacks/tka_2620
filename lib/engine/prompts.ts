// GET /api/handover/prompts?seat= (F6.1): the three prompts a holder of the seat is asked next when handing over, each
// with its reason (docs/SPEC.md → F6): newcomers' questions nobody could answer first, the most asked first (demand),
// then what an added text left out (gap), the group's required prompts and the seat type's checklist (core).
// Everything runs as the caller (lib/engine/route.ts), so the database decides what they read: inbox() (0003) gives the
// demand prompts routed to them, the prompts policy gives the seat's other prompts to its holders, and nobody else reads
// any. A prompt the caller already answered through the handover, and a topic a recent note already covers, are skipped
// (SPEC → adding knowledge), but never a demand prompt: someone waits for its answer. Nothing is logged but a code.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  type HandoverPrompt,
  PromptKind,
  type PromptsResponse,
  SeatQuery,
  Timestamp,
  Uuid,
} from "@/lib/contracts";
import { embed } from "@/lib/embed";
import { tokyoToday } from "@/lib/engine/notes";
import { closeEnough, FoundNote, SEARCH_K } from "@/lib/engine/retrieve";
import {
  ApiFailure,
  apiError,
  bearerToken,
  callerFor,
  dbFailure,
  failed,
  logFailure,
} from "@/lib/engine/route";

const ROUTE = "GET /api/handover/prompts";

export const PROMPT_COUNT = 3; // SPEC → F6: three prompts
// The seat's open gap, required and core prompts read at most, oldest first: a seat type has up to 10 core prompts, and
// each 「先輩に聞く」 adds one gap prompt.
const OPEN_PROMPTS = 100;

export type PromptsDeps = {
  embed: (texts: string[]) => Promise<number[][]>;
  today?: string; // Tokyo's date, YYYY-MM-DD: an answer past its valid_until counts no more
};

export async function handlePrompts(request: Request): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return apiError("unauthorized");
  const parsed = SeatQuery.safeParse({
    seat: new URL(request.url).searchParams.get("seat") ?? undefined,
  });
  if (!parsed.success) return apiError("invalid_request");

  try {
    const caller = await callerFor(token);
    if (!caller) return apiError("unauthorized");
    return Response.json(
      await promptsAsCaller(caller.db, parsed.data.seat, { embed }),
    );
  } catch (error) {
    // The code and the error's class only: a message can quote a prompt.
    return failed(ROUTE, error);
  }
}

const SeatRow = z.object({ id: Uuid });
const TermRows = z.array(z.object({ term_order: z.number().int() }));

// inbox()'s rows (0003): the open demand prompts routed to the caller, each with its first question's time.
const DemandRows = z.array(
  z.object({
    prompt_id: Uuid,
    question: z.string(),
    ask_count: z.number().int().positive(),
    asked_at: Timestamp,
  }),
);
export type DemandRow = z.infer<typeof DemandRows>[number];

// seq (0011): the order prompts were added in, a core checklist as seed/core-prompts.csv lists it.
const OpenRows = z.array(
  z.object({
    id: Uuid,
    kind: PromptKind.exclude(["demand"]),
    text: z.string(),
    ask_count: z.number().int().nonnegative(),
    seq: z.number().int(),
  }),
);
export type OpenRow = z.infer<typeof OpenRows>[number];

export async function promptsAsCaller(
  client: SupabaseClient,
  slug: string,
  deps: PromptsDeps,
): Promise<PromptsResponse> {
  const { data: seatRow, error: seatError } = await client
    .from("seats")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (seatError) throw dbFailure(seatError);
  if (!seatRow) throw new ApiFailure("not_found");
  const seat = SeatRow.safeParse(seatRow);
  if (!seat.success) throw new ApiFailure("unavailable");

  // The caller's own rows only (RLS); the latest term is the one a publish signs with. Someone who never held the seat
  // reads none of its prompts, as the prompts policy would answer anyway.
  const { data: terms, error: termError } = await client
    .from("seat_holders")
    .select("term_order")
    .eq("seat_id", seat.data.id)
    .order("term_order", { ascending: false })
    .limit(1);
  if (termError) throw dbFailure(termError);
  const held = TermRows.safeParse(terms ?? []);
  if (!held.success) throw new ApiFailure("unavailable");
  const term = held.data[0]?.term_order;
  if (term === undefined) return { prompts: [] };

  const [demand, open] = await Promise.all([
    client.rpc("inbox", { seat: seat.data.id }),
    client
      .from("prompts")
      .select("id, kind, text, ask_count, seq")
      .eq("seat_id", seat.data.id)
      .eq("retired", false)
      .in("kind", ["gap", "required", "core"])
      .order("seq")
      .limit(OPEN_PROMPTS),
  ]);
  if (demand.error) throw dbFailure(demand.error);
  if (open.error) throw dbFailure(open.error);
  const demandRows = DemandRows.safeParse(demand.data ?? []);
  const openRows = OpenRows.safeParse(open.data ?? []);
  if (!demandRows.success || !openRows.success) {
    throw new ApiFailure("unavailable");
  }
  const answered = await answeredPrompts(client, {
    seatId: seat.data.id,
    term,
    promptIds: openRows.data.map((row) => row.id),
    today: deps.today ?? tokyoToday(),
  });

  const prompts = await choosePrompts(
    rankPrompts(
      demandRows.data,
      openRows.data.filter((row) => !answered.has(row.id)),
    ),
    (batch) =>
      coveredByNotes(client, {
        seat: { id: seat.data.id, slug },
        term,
        prompts: batch,
        embed: deps.embed,
      }),
  );
  return { prompts };
}

// The prompts the caller already answered through the handover, or a later holder did in a note they can read: a live
// note of the seat that names the prompt (notes.prompt_id, 0011), from the caller's latest term or later, and not past
// its valid_until (Tokyo's date, as search_notes, 0004). As the caller, so the notes policy decides which notes count.
// Withdrawing the note, or its expiry, brings the prompt back. Without a term, a note of any term counts: the handover
// guide (lib/engine/guide.ts) lists what nobody has written yet, not what this holder is still to be asked.
export async function answeredPrompts(
  client: SupabaseClient,
  input: { seatId: string; term?: number; promptIds: string[]; today: string },
): Promise<Set<string>> {
  if (input.promptIds.length === 0) return new Set();
  const live = client
    .from("notes")
    .select("prompt_id")
    .eq("seat_id", input.seatId)
    .eq("status", "live");
  const { data, error } = await (input.term === undefined
    ? live
    : live.gte("term_order", input.term)
  )
    .or(`valid_until.is.null,valid_until.gte.${input.today}`)
    .in("prompt_id", input.promptIds);
  if (error) throw dbFailure(error);
  const rows = z.array(z.object({ prompt_id: Uuid })).safeParse(data ?? []);
  if (!rows.success) throw new ApiFailure("unavailable");
  return new Set(rows.data.map((row) => row.prompt_id));
}

const RANK = PromptKind.options; // demand, gap, required, core

// Prompts by kind in rank order, each kind in the order it was added (seq).
export function byRank(
  a: { kind: PromptKind; seq: number },
  b: { kind: PromptKind; seq: number },
): number {
  return RANK.indexOf(a.kind) - RANK.indexOf(b.kind) || a.seq - b.seq;
}

// Demand prompts by how many newcomers asked, the longest waiting first among equals; then gap, required and core
// prompts, each kind in the order it was added.
export function rankPrompts(
  demand: DemandRow[],
  open: OpenRow[],
): HandoverPrompt[] {
  const asked = demand
    .toSorted(
      (a, b) =>
        b.ask_count - a.ask_count ||
        Date.parse(a.asked_at) - Date.parse(b.asked_at),
    )
    .map(
      (row): HandoverPrompt => ({
        id: row.prompt_id,
        text: row.question,
        reason: "demand",
        askCount: row.ask_count,
      }),
    );
  const others = open.toSorted(byRank).map(
    (row): HandoverPrompt => ({
      id: row.id,
      text: row.text,
      reason: row.kind,
      askCount: row.ask_count,
    }),
  );
  return [...asked, ...others];
}

// The prompts to ask, in rank order: the demand prompts that fit, then the first others no recent note covers, each text
// once (a missing item can repeat a checklist prompt word for word, or a newcomer's question). Only as many prompts as
// there are places left are checked at a time, so a seat whose recent notes cover none of the first few costs one
// embedding call. A failed check (Ollama stopped, a failed search) is logged by its code and skips nothing.
export async function choosePrompts(
  ranked: HandoverPrompt[],
  covered: (prompts: HandoverPrompt[]) => Promise<boolean[]>,
): Promise<HandoverPrompt[]> {
  const chosen = ranked
    .filter((prompt) => prompt.reason === "demand")
    .slice(0, PROMPT_COUNT);
  const texts = new Set(chosen.map((prompt) => prompt.text));
  let rest = ranked.filter((prompt) => {
    if (prompt.reason === "demand" || texts.has(prompt.text)) return false;
    texts.add(prompt.text);
    return true;
  });
  let checking = true;
  while (chosen.length < PROMPT_COUNT && rest.length > 0) {
    const batch = rest.slice(0, PROMPT_COUNT - chosen.length);
    rest = rest.slice(batch.length);
    let skip: boolean[] = [];
    if (checking) {
      try {
        skip = await covered(batch);
      } catch (error) {
        logFailure(`${ROUTE}: covered topics`, error);
        checking = false;
      }
    }
    chosen.push(...batch.filter((_, i) => !skip[i]));
  }
  return chosen;
}

type CoverInput = {
  seat: { id: string; slug: string };
  term?: number; // the caller's latest term at the seat; without one, a note of any term covers (coversPrompt)
  prompts: { text: string }[];
  embed: (texts: string[]) => Promise<number[][]>;
};

// Each prompt asked as a question, with search_notes (0004) as the caller: the notes policy decides which notes can
// cover anything, so a note the caller can't read never hides a prompt. One embedding call for all of them.
export async function coveredByNotes(
  client: SupabaseClient,
  input: CoverInput,
): Promise<boolean[]> {
  const vectors = await input.embed(input.prompts.map((prompt) => prompt.text));
  if (vectors.length !== input.prompts.length) {
    throw new ApiFailure("unavailable");
  }
  return Promise.all(
    vectors.map(async (vector) => {
      const { data, error } = await client.rpc("search_notes", {
        seat: input.seat.slug,
        query_embedding: JSON.stringify(vector),
        k: SEARCH_K,
      });
      if (error) throw dbFailure(error);
      return coversPrompt(
        z.array(FoundNote).parse(data ?? []),
        input.seat.id,
        input.term,
      );
    }),
  );
}

// A recent note covers a prompt when the prompt, asked as a question, would be answered from the seat's own notes
// (closeEnough(), lib/engine/retrieve.ts: one reaches MATCH, notes on the topic come along) and one of those is from the
// caller's latest term or later. Another seat's note never counts, not even as the clear match: an institution-wide note
// could otherwise pull in a loosely related note of the seat. An older predecessor's note doesn't count either, since a
// rule may have changed since (the 2025 保健所 deadline).
// Measured with bge-m3 (prompt text against title and body, lib/embed.ts) on seed/core-prompts.csv and seed/notes.csv:
//   club_role core prompts score 0.39–0.58 against every seed note, except receipts against 「領収書は月末にまとめて精算」
//   (2025) at 0.682: covered for a25, asked of a26.
//   the old handover's missing item 「模擬店の保健所申請の締切はいつですか？」 scores 0.774 against the 2024 deadline note, so
//   the 2025 note comes along at 0.596: covered for a25, still asked of a26, who holds 2026.
//   「口座の代表者を変えるとき、銀行に何を持っていけばいいですか？」 reaches 0.557 at most: never covered.
// Without a term, any of the seat's notes that would answer it covers it: the handover guide (lib/engine/guide.ts) lists
// what isn't written at all, so an older predecessor's note counts there.
export function coversPrompt(
  found: FoundNote[],
  seatId: string,
  term?: number,
): boolean {
  return closeEnough(found.filter((note) => note.seat_id === seatId)).some(
    (note) => term === undefined || note.term_order >= term,
  );
}
