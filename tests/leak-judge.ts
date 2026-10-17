// Decides whether a response leaked something to the viewer who got it (`pnpm test:leak`, F4.4 #28). Pure: the truth
// comes in as data — who may read each seed note (tests/visibility-table.ts, written by hand) and the rows the run
// created, as the service role reads them — so nothing here trusts the RLS it checks. A finding names ids and reasons
// only, never the text that leaked.
import { isDeepStrictEqual } from "node:util";
import { reads, seedIds, viewers } from "./visibility-table";

// The length of a quoted passage that counts as a leak, in normalised characters: long enough that two notes don't
// share it by chance (strings shared with a note the viewer reads are left out anyway).
export const PASSAGE = 16;

// Every PASSAGE-character window of a text, or the text itself when it is shorter.
function passages(text: string): string[] {
  if (text.length <= PASSAGE) return [text];
  const out = new Set<string>();
  for (let at = 0; at + PASSAGE <= text.length; at++) {
    out.add(text.slice(at, at + PASSAGE));
  }
  return [...out];
}

export type Finding = {
  reason: string;
  ref?: string; // the note, question, prompt or table it concerns: an id or a name, never text
  // Not a leak: a row this run didn't create and the table doesn't list (someone else acting during the run). The
  // attempt it came from can't be judged.
  unknown?: true;
};

// A seed note as seed/notes.csv has it. Its canary and its body must never reach a viewer who can't read it.
export type SeedNote = {
  id: string;
  title: string;
  body: string;
  canary: string;
};

// The truth for one run, read with the service role. Ids only, except the seed notes from the CSV.
export type World = {
  seedNotes: SeedNote[];
  noteAuthors: Map<string, string | null>; // every note's author_user_id
  seatsHeld: Map<string, Set<string>>; // user id → the seats they hold
  reachable: Set<string>; // `${seat_id} ${user_id}` of each holder who agreed to get newcomers' questions
  questions: Map<string, { askerUserId: string; promptId: string | null }>;
  // askerUserId: who asked the question that started the prompt (null once that question is gone)
  prompts: Map<
    string,
    { seatId: string; kind: string; askerUserId: string | null }
  >;
  routes: Set<string>; // `${prompt_id} ${user_id}`, as the database made them
  personas: Map<string, string>; // user id → viewer key (a24 … x), for checking an asker's view
};

// The scope rule a route must follow (docs/SPEC.md → Scope rules), whatever the database did: a newcomer's question
// reaches only reachable holders of the same seat, never the asker.
export function routeAllowed(
  world: World,
  promptId: string,
  userId: string | undefined,
): boolean {
  const prompt = world.prompts.get(promptId);
  return (
    prompt !== undefined &&
    userId !== undefined &&
    world.reachable.has(`${prompt.seatId} ${userId}`) &&
    prompt.askerUserId !== userId
  );
}

// The viewer an answer went to: a key of tests/visibility-table.ts and, when signed in, the user id.
export type Viewpoint = { key: string; userId?: string };

// Both sides of a text comparison: NFKC (full-width letters and digits become plain), upper case, and no spaces or
// dashes, so 「ｋｉｋｙｏ ７７３１」 still matches its canary.
export function normalise(text: string): string {
  return text
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s\p{Pd}]/gu, "");
}

// Every string in a JSON value (keys left out).
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, out);
  else if (value && typeof value === "object") {
    for (const item of Object.values(value)) strings(item, out);
  }
  return out;
}

// One finding per reason and ref.
function unique(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.reason}|${finding.ref ?? ""}|${finding.unknown ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const TABLES = new Set([
  "institutions",
  "groups",
  "seats",
  "seat_holders",
  "group_members",
  "notes",
  "questions",
  "answers",
  "prompts",
  "prompt_routes",
  "events",
]);
// What everyone may read (seats, groups and institutions: opening a seat page joins nothing).
const PUBLIC_TABLES = new Set(["institutions", "groups", "seats"]);

export type Row = { table: string; row: Record<string, unknown> };

// The rows of a PostgREST answer, embedded resources included: `institutions?select=id,groups(seats(notes(*)))`
// gives one row per institution, group, seat and note, each without its embeds.
export function collectRows(
  table: string,
  value: unknown,
  out: Row[] = [],
): Row[] {
  const items = Array.isArray(value) ? value : value == null ? [] : [value];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const own: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(item)) {
      if (TABLES.has(key) && field && typeof field === "object") {
        collectRows(key, field, out);
      } else {
        own[key] = field;
      }
    }
    out.push({ table, row: own });
  }
  return out;
}

// Two stored answers alike apart from their question id: what the answers trigger (0006) must make of a citation of
// a note the asker can't read and one of a note that doesn't exist.
export function sameAnswer(a: unknown, b: unknown): boolean {
  const strip = (payload: unknown) => {
    if (!payload || typeof payload !== "object") return payload;
    const { questionId: _, ...rest } = payload as Record<string, unknown>;
    return rest;
  };
  return isDeepStrictEqual(strip(a), strip(b));
}

export function judgeFor(world: World, viewer: Viewpoint) {
  const canRead = (noteId: string) => reads(viewer.key, noteId);
  const unreadable = [...seedIds].filter((id) => canRead(id) === false);
  const idPatterns = unreadable.map((id) => ({
    id,
    pattern: new RegExp(`(?<![a-z0-9-])${escapeRegExp(id)}(?![a-z0-9-])`),
  }));

  // What must never reach this viewer as text: the canaries of the seed notes it can't read, every passage of
  // PASSAGE characters of their bodies (a quote need not be whole), and the other personas' emails. A string that also
  // occurs in a note it can read is left out (it would prove nothing), and so is one too short to be specific.
  const readable = world.seedNotes
    .filter((note) => canRead(note.id))
    .map((note) => normalise(`${note.title}\n${note.body}`));
  const forbidden = [
    ...world.seedNotes
      .filter((note) => canRead(note.id) === false)
      .flatMap((note) => [
        {
          ref: note.id,
          reason: "the canary of a note it can't read",
          text: normalise(note.canary),
        },
        ...passages(normalise(note.body)).map((text) => ({
          ref: note.id,
          reason: "a passage of a note it can't read",
          text,
        })),
      ]),
    ...viewers
      .filter((other) => other.email && other.key !== viewer.key)
      .map((other) => ({
        ref: other.key,
        reason: "another persona's email",
        text: normalise(other.email ?? ""),
      })),
  ].filter(
    (item) =>
      item.text.length >= 6 &&
      !readable.some((text) => text.includes(item.text)),
  );

  const holds = (seatId: string) =>
    viewer.userId !== undefined &&
    (world.seatsHeld.get(viewer.userId)?.has(seatId) ?? false);
  // A prompt reached the viewer, and the rules say it may: a route the database made to anyone else is itself a leak.
  const routedToViewer = (promptId: string) =>
    world.routes.has(`${promptId} ${viewer.userId}`) &&
    routeAllowed(world, promptId, viewer.userId);
  const own = (userId: unknown) =>
    viewer.userId !== undefined && userId === viewer.userId;

  // A note id the viewer gets: a seed note it can't read is a leak; a note the seed doesn't have can't be judged.
  function note(noteId: unknown): Finding[] {
    if (typeof noteId !== "string")
      return [{ reason: "a note row without an id", unknown: true }];
    const allowed = canRead(noteId);
    if (allowed === false)
      return [{ reason: "a note it can't read", ref: noteId }];
    if (allowed === undefined)
      return [
        { reason: "a note the seed doesn't have", ref: noteId, unknown: true },
      ];
    return [];
  }

  // Unreadable seed ids, canaries and note text anywhere in a value.
  function text(value: unknown): Finding[] {
    const findings: Finding[] = [];
    for (const raw of strings(value)) {
      for (const { id, pattern } of idPatterns) {
        if (pattern.test(raw))
          findings.push({ reason: "a note it can't read", ref: id });
      }
      const flat = normalise(raw);
      for (const item of forbidden) {
        if (flat.includes(item.text))
          findings.push({ reason: item.reason, ref: item.ref });
      }
    }
    return unique(findings);
  }

  // One table row, by the scope rules of docs/SPEC.md: whose row it is, not what RLS said.
  function row({ table, row: fields }: Row): Finding[] {
    switch (table) {
      case "notes":
        return note(fields.id);
      case "questions": {
        const question = world.questions.get(String(fields.id));
        if (!question)
          return [
            {
              reason: "a question the run didn't see",
              ref: String(fields.id),
              unknown: true,
            },
          ];
        return own(question.askerUserId)
          ? []
          : [{ reason: "someone else's question", ref: String(fields.id) }];
      }
      case "answers": {
        const question = world.questions.get(String(fields.question_id));
        if (!question) {
          return [
            {
              reason: "an answer the run didn't see",
              ref: String(fields.question_id),
              unknown: true,
            },
          ];
        }
        return own(question.askerUserId)
          ? []
          : [
              {
                reason: "someone else's answer",
                ref: String(fields.question_id),
              },
            ];
      }
      case "prompts": {
        const prompt = world.prompts.get(String(fields.id));
        if (!prompt)
          return [
            {
              reason: "a prompt the run didn't see",
              ref: String(fields.id),
              unknown: true,
            },
          ];
        const allowed =
          holds(prompt.seatId) &&
          (prompt.kind !== "demand" || routedToViewer(String(fields.id)));
        return allowed
          ? []
          : [{ reason: "a prompt it may not read", ref: String(fields.id) }];
      }
      case "prompt_routes": {
        const promptId = String(fields.prompt_id);
        if (!own(fields.user_id)) {
          return [{ reason: "someone else's inbox route", ref: promptId }];
        }
        if (!world.prompts.has(promptId)) {
          return [
            {
              reason: "a route the run didn't see",
              ref: promptId,
              unknown: true,
            },
          ];
        }
        return routeAllowed(world, promptId, viewer.userId)
          ? []
          : [
              {
                reason: "a question routed to it that it shouldn't get",
                ref: promptId,
              },
            ];
      }
      case "seat_holders":
        return own(fields.user_id)
          ? []
          : [{ reason: "someone else's seat", ref: "seat_holders" }];
      case "group_members":
        return own(fields.user_id)
          ? []
          : [{ reason: "someone else's membership", ref: "group_members" }];
      case "events":
        return fields.kind === "withdraw"
          ? []
          : [
              {
                reason: "an events row it may not read",
                ref: String(fields.kind),
              },
            ];
      default:
        return PUBLIC_TABLES.has(table)
          ? []
          : [
              {
                reason: "a row of a table the judge doesn't know",
                ref: table,
                unknown: true,
              },
            ];
    }
  }

  return {
    text,

    // A PostgREST answer for `table`, embedded resources included.
    rows(table: string, data: unknown): Finding[] {
      return unique([...collectRows(table, data).flatMap(row), ...text(data)]);
    },

    // POST /api/ask at a seat (an AskResult): every citation a note the asker reads; a question from someone who holds
    // no seat there reaches no predecessor (docs/SPEC.md → Scope rules).
    ask(result: unknown, seatId: string): Finding[] {
      const findings = text(result);
      const answer = result as {
        status?: string;
        promptId?: string;
        routedTo?: number;
        sentences?: { citations?: { noteId?: string }[] }[];
      };
      for (const sentence of answer.sentences ?? []) {
        for (const citation of sentence.citations ?? [])
          findings.push(...note(citation.noteId));
      }
      if (
        answer.status === "abstained" &&
        !holds(seatId) &&
        (answer.promptId || (answer.routedTo ?? 0) > 0)
      ) {
        findings.push({
          reason:
            "its question reached a predecessor at a seat it doesn't hold",
          ref: answer.promptId,
        });
      }
      return unique(findings);
    },

    // GET /api/inbox items ({ promptId }) or inbox() rows ({ prompt_id }): only prompts routed to the viewer.
    inbox(items: unknown[]): Finding[] {
      const findings = text(items);
      for (const item of items as { promptId?: string; prompt_id?: string }[]) {
        const promptId = item.promptId ?? item.prompt_id ?? "";
        if (!world.prompts.has(promptId)) {
          findings.push({
            reason: "an inbox item the run didn't see",
            ref: promptId,
            unknown: true,
          });
        } else if (!world.routes.has(`${promptId} ${viewer.userId}`)) {
          findings.push({
            reason: "an inbox item routed to someone else",
            ref: promptId,
          });
        } else if (!routedToViewer(promptId)) {
          findings.push({
            reason: "a question routed to it that it shouldn't get",
            ref: promptId,
          });
        }
      }
      return unique(findings);
    },

    // waiting_questions() rows: questions waiting on a prompt routed to the viewer, each offered only the viewer's own
    // notes that the asker may read.
    waiting(rows: unknown[]): Finding[] {
      const findings = text(rows);
      for (const item of rows as {
        question_id?: string;
        readable_note_ids?: string[];
      }[]) {
        const question = world.questions.get(item.question_id ?? "");
        if (!question) {
          findings.push({
            reason: "a waiting question the run didn't see",
            ref: item.question_id,
            unknown: true,
          });
          continue;
        }
        if (!question.promptId || !routedToViewer(question.promptId)) {
          findings.push({
            reason: "a question waiting on a prompt not routed to it",
            ref: item.question_id,
          });
        }
        const asker = world.personas.get(question.askerUserId);
        for (const noteId of item.readable_note_ids ?? []) {
          if (world.noteAuthors.get(noteId) !== viewer.userId) {
            findings.push({
              reason: "a note it didn't write, offered for an answer",
              ref: noteId,
            });
          }
          if (asker && reads(asker, noteId) === false) {
            findings.push({
              reason: "a note the asker can't read, offered for the answer",
              ref: noteId,
            });
          }
        }
      }
      return unique(findings);
    },

    // GET /api/seats/[slug] (SeatView): its upcoming deadlines are notes the viewer reads.
    seatView(view: unknown): Finding[] {
      const findings = text(view);
      for (const item of (view as { upcoming?: { noteId?: string }[] })
        .upcoming ?? []) {
        findings.push(...note(item.noteId));
      }
      return unique(findings);
    },

    // GET /api/me/notes: only notes the viewer wrote.
    myNotes(response: unknown): Finding[] {
      const findings = text(response);
      for (const item of (response as { notes?: { id?: string }[] }).notes ??
        []) {
        if (world.noteAuthors.get(item.id ?? "") !== viewer.userId) {
          findings.push({
            reason: "someone else's note in its own list",
            ref: item.id,
          });
        }
      }
      return unique(findings);
    },

    // seat_lineage(): terms only, never who held them.
    lineage(rows: unknown[]): Finding[] {
      const findings = text(rows);
      for (const item of rows as Record<string, unknown>[]) {
        for (const key of Object.keys(item)) {
          if (key !== "term_label" && key !== "term_order") {
            findings.push({
              reason: "seat_lineage gives more than the terms",
              ref: key,
            });
          }
        }
      }
      return unique(findings);
    },

    // One Realtime postgres_changes message: Realtime checks each change against the viewer's select policy, so it
    // must bring only rows the viewer reads. A deleted row can't be checked, so the publication never sends deletes
    // (0005); an error notice tells the viewer that something changed.
    realtime(message: {
      table?: string;
      eventType?: string;
      new?: Record<string, unknown>;
      old?: Record<string, unknown>;
      errors?: unknown;
    }): Finding[] {
      const table = message.table ?? "unknown";
      const findings: Finding[] = [];
      if (message.eventType === "DELETE")
        findings.push({ reason: "a deleted row", ref: table });
      if (
        Array.isArray(message.errors)
          ? message.errors.length > 0
          : Boolean(message.errors)
      ) {
        findings.push({ reason: "an error notice about a change", ref: table });
      }
      if (message.new && Object.keys(message.new).length > 0) {
        findings.push(...row({ table, row: message.new }));
      }
      findings.push(...text(message.new), ...text(message.old));
      return unique(findings);
    },
  };
}

export type Judge = ReturnType<typeof judgeFor>;
