// #28 acceptance check (docs/SPEC.md → F4): nothing leaks, shown with numbers. Every persona, and a visitor who isn't
// signed in, tries every way in as itself: questions (POST /api/ask), direct reads (every table, embedded selects, the
// seat page, 自分のメモ, a note by id), search (search_notes with no threshold), the inbox (the route and the functions),
// ids it shouldn't know (withdraw, route, join, draft, seen, the answers trigger), and Realtime, listening from the
// start of the run to the end of its cleanup. tests/leak-judge.ts decides each answer against the hand-written
// visibility table (tests/visibility-table.ts) and the rows the run created, never against what RLS returned. A leak is
// a note the viewer can't read (its id, its body or its canary from seed/notes.csv), someone else's question, answer,
// route, prompt or membership, or an events row it isn't meant to see. The outsider x makes at least 50 attempts. The
// counts go to events (kind "leak", numbers only), and a conclusive run prints its METRICS line for `pnpm metrics`.
// Runs against the seeded database and a running dev server, with Ollama (the search) and the Claude key (answers from
// the notes a persona may read):
//   pnpm dev          (in another terminal)
//   pnpm test:leak
// The personas act through the API and PostgREST with their own tokens. The service-role key, which only scripts/ may
// hold, reads the truth, re-saves the seed notes unchanged (the Realtime probe), adds three demand prompts nobody may
// be offered or join (the join, draft and open-prompt probes), writes the events rows and removes what the run
// created. The run ends with the database as it found it, and says so only when it is.
// Don't run it during a rehearsal: the holders' questions reach a25's inbox for a moment, and an open phone keeps
// showing them until it reloads (deletes aren't sent by Realtime). It writes nothing unless a25's inbox is empty.
// Ids, personas and counts only: never a question, answer or note text, a canary or an email.
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import {
  createClient,
  type RealtimePostgresChangesPayload,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";
import {
  ApiError,
  AskResult,
  EventsRow,
  InboxResponse,
  type Metrics,
} from "@/lib/contracts";
import { EMBEDDING_DIMENSIONS } from "@/lib/embed";
import { reportMetrics } from "@/scripts/metrics-line";
import { removeQuestions } from "@/scripts/remove-questions";
import {
  type Finding,
  type Judge,
  judgeFor,
  type SeedNote,
  sameAnswer,
  type World,
} from "@/tests/leak-judge";
import { reads, seedIds, viewers } from "@/tests/visibility-table";

const BASE_URL = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const OUTSIDER = "x";
const MIN_OUTSIDER_ATTEMPTS = 50; // SPEC F4
const SUBSCRIBE_MS = 20_000; // longer than the server's postgres_changes wait (15 s)
const PROBE_MS = 15_000; // the re-saved seed notes reach every viewer well inside this
const SETTLE_MS = 3_000; // late Realtime messages after the cleanup
const REQUEST_MS = 60_000; // one request, Sonnet included

// Ctrl-C (or pnpm metrics stopping) ends the run after the step in flight, and the cleanup still runs. A run stopped
// early is never conclusive, so it gives no numbers.
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopping = true;
  });
}
function stopIfAsked(): void {
  if (stopping) throw new Error("stopped by a signal before every attempt ran");
}
const SEAT = "smash-kaikei"; // the golden-path seat: the live loop's prompts are here
const MADE_UP_NOTE = "leak-test-no-such-note";
const MADE_UP_UUID = "00000000-0000-4000-8000-000000000000";
const PROBE_TEXT = "leak test probe"; // the text of the rows the oracles write: no note text, no canary
// A unit vector: search_notes ranks by similarity with no threshold, so k = 100 returns every note the caller can find.
const UNIT = JSON.stringify(
  Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0)),
);
const NOTE_COLUMNS =
  "id, seat_id, term_order, scope, status, author_user_id, title, body";

type NoteRow = SeedNote & { seat_slug: string; scope: string };
type QuestionRow = { id: string; seat_slug: string; question: string };
type Channel =
  | "questions"
  | "reads"
  | "search"
  | "inbox"
  | "oracles"
  | "realtime";
const CHANNELS: Channel[] = [
  "questions",
  "reads",
  "search",
  "inbox",
  "oracles",
  "realtime",
];

// One Realtime postgres_changes message as a viewer received it.
type Heard = {
  table?: string;
  eventType?: string;
  new?: Record<string, unknown>;
  old?: Record<string, unknown>;
  errors?: unknown;
};

// One viewer with its own client, as on its own phone.
type Session = {
  key: string; // a24 … x, "signed out"
  userId?: string;
  token?: string;
  db: SupabaseClient;
  judge: Judge;
  heard: Heard[];
  trouble?: string; // the Realtime channel closed or failed after it was ready
  closing?: boolean; // set at the end of the run, before the channels close
};

// One try at getting something out, judged.
type Attempt = {
  viewer: string;
  channel: Channel;
  label: string; // what was tried: a route, table or function and ids, never text
  findings: Finding[];
  inconclusive?: string;
};
const attempts: Attempt[] = [];
// The viewers whose ask_question() gets as far as the join: a holder of SEAT with someone else reachable there. For
// anyone else it routes nowhere before reading join_prompt, so the join probe proves nothing for them (#69).
const joinReached = new Set<string>();

// The attempt got an answer that can't be judged (a server error, a mistyped route or column, a status nobody
// expected), so it proves nothing either way.
class Inconclusive extends Error {}

async function attempt(
  session: Session,
  channel: Channel,
  label: string,
  run: () => Promise<Finding[]>,
): Promise<void> {
  let findings: Finding[] = [];
  let inconclusive: string | undefined;
  try {
    findings = await run();
  } catch (error) {
    // Our own reasons, a network failure, or the error's class: never a message that could quote a row.
    inconclusive =
      error instanceof Inconclusive
        ? error.message
        : error instanceof TypeError
          ? `${error.name}: ${error.message}`
          : error instanceof Error
            ? error.name
            : "error";
  }
  const unknown = findings.filter((finding) => finding.unknown);
  if (unknown.length > 0 && !inconclusive) {
    inconclusive = `rows this run didn't create (${unknown.map((finding) => finding.ref ?? finding.reason).join(", ")}): someone else acting?`;
  }
  attempts.push({
    viewer: session.key,
    channel,
    label,
    findings: findings.filter((finding) => !finding.unknown),
    inconclusive,
  });
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set in .env.local`);
  return value;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition: () => boolean, ms: number): Promise<boolean> {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    if (condition()) return true;
    await pause(100);
  }
  return condition();
}

async function readCsv<Row>(file: string): Promise<Row[]> {
  const text = await readFile(
    new URL(`../seed/${file}`, import.meta.url),
    "utf8",
  );
  try {
    return parse(text, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
    }) as Row[];
  } catch (error) {
    // The parser's message can quote the field it choked on, which may be a note body: its code only.
    const code = (error as { code?: string }).code ?? "parse error";
    throw new Error(`read seed/${file}: ${code}`);
  }
}

// HTTP ---------------------------------------------------------------------------------------

type Reply = { status: number; body: unknown; json: boolean };

async function http(
  session: Session,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Reply> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined && { "content-type": "application/json" }),
      ...(session.token && { authorization: `Bearer ${session.token}` }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_MS), // a hung server fails the attempt, not the whole run
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text), json: true };
  } catch {
    return { status: response.status, body: undefined, json: false };
  }
}

// The reply has one of the expected statuses, as JSON, and an error is exactly the routes' own ({ error: code }, and
// nothing else that could carry a note), so a mistyped path (Next's HTML 404) or a crash can't pass for a refusal.
function expectReply(reply: Reply, statuses: number[]): void {
  if (!statuses.includes(reply.status)) {
    throw new Inconclusive(
      `HTTP ${reply.status}, expected ${statuses.join(" or ")}`,
    );
  }
  if (!reply.json) throw new Inconclusive(`HTTP ${reply.status} without JSON`);
  if (reply.status >= 400 && !ApiError.strict().safeParse(reply.body).success) {
    throw new Inconclusive(`HTTP ${reply.status} with more than an error code`);
  }
}

// PostgREST ----------------------------------------------------------------------------------

type DbResult = { data: unknown; error: { code?: string } | null };

// A PostgREST call's rows, or undefined when the database refused the role (42501) where a refusal is the right
// answer. Anything else (a mistyped column, embed or function, a bad argument) can't be judged.
async function rowsOf(
  query: PromiseLike<DbResult>,
  expect: "rows" | "refused",
): Promise<unknown[] | undefined> {
  const { data, error } = await query;
  if (!error) return Array.isArray(data) ? data : data == null ? [] : [data];
  if (error.code === "42501" && expect === "refused") return undefined;
  throw new Inconclusive(
    `PostgREST ${error.code ?? "error"}, expected ${expect === "rows" ? "rows" : "a refusal"}`,
  );
}

// Sessions and Realtime ------------------------------------------------------------------------

async function signIn(
  url: string,
  anonKey: string,
  key: string,
  email: string | undefined,
  password: string,
  world: World,
): Promise<Session> {
  const db = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (!email) {
    return { key, db, judge: judgeFor(world, { key }), heard: [] };
  }
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(
      `sign in as ${key}: ${error?.code ?? "no session"} (has pnpm seed run?)`,
    );
  }
  return {
    key,
    userId: data.user.id,
    token: data.session.access_token,
    db,
    judge: judgeFor(world, { key, userId: data.user.id }),
    heard: [],
  };
}

// Listens to every change in the public schema that this viewer's policies let through, from now until the end of the
// cleanup. The join waits for the server to confirm the subscription and for the replication-ready system event, so a
// change made right after this resolves is never missed (as in check-loop.ts).
async function listen(session: Session): Promise<void> {
  if (session.token) await session.db.realtime.setAuth(session.token);
  return new Promise((resolve, reject) => {
    let subscribed = false;
    let replicating = false;
    let ready = false;
    const settle = (error?: Error) => {
      clearTimeout(timer);
      if (ready) return;
      ready = !error;
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () => settle(new Error(`${session.key}: Realtime not ready in time`)),
      SUBSCRIBE_MS,
    );
    session.db
      .channel(`check-leak-${session.key.replace(/\s/g, "-")}`, {
        config: {
          broadcast: { replication_ready: true },
          postgres_changes_options: { wait: true },
        },
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public" },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          const message = payload as unknown as Heard;
          session.heard.push({
            table: message.table,
            eventType: message.eventType,
            new: message.new,
            old: message.old,
            errors: message.errors,
          });
        },
      )
      .on("system", {}, (payload: { extension?: string; status?: string }) => {
        if (payload.extension !== "system") return;
        if (payload.status === "ok") {
          replicating = true;
          if (subscribed) settle();
        } else if (ready) {
          if (!session.closing) {
            session.trouble = `Realtime replication ${payload.status} during the run`;
          }
        } else {
          settle(
            new Error(`${session.key}: Realtime replication ${payload.status}`),
          );
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          subscribed = true;
          if (replicating) settle();
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          // Closing at the end of the run is no trouble; anything before it means the viewer stopped listening.
          if (ready) {
            if (!session.closing) {
              session.trouble = `Realtime ${status} during the run`;
            }
          } else settle(new Error(`${session.key}: Realtime ${status}`));
        }
      });
  });
}

// The truth, as the service role reads it -----------------------------------------------------

type Snapshot = {
  counts: Record<string, number>;
  statuses: Record<string, string>;
  questionIds: Set<string>; // never deleted by the cleanup: they were there before the run
};

async function snapshot(service: SupabaseClient): Promise<Snapshot> {
  const counts: Record<string, number> = {};
  for (const table of ["questions", "answers", "prompts", "prompt_routes"]) {
    const { count, error } = await service
      .from(table)
      .select("*", { count: "exact", head: true });
    if (error || count === null)
      throw new Error(`count ${table}: ${error?.code}`);
    counts[table] = count;
  }
  const events = await service.from("events").select("kind");
  if (events.error) throw new Error(`read events: ${events.error.code}`);
  for (const { kind } of events.data as { kind: string }[]) {
    counts[`events:${kind}`] = (counts[`events:${kind}`] ?? 0) + 1;
  }
  const notes = await service
    .from("notes")
    .select("id, status")
    .in("id", [...seedIds]);
  if (notes.error) throw new Error(`read the seed notes: ${notes.error.code}`);
  const statuses = Object.fromEntries(
    (notes.data as { id: string; status: string }[]).map((row) => [
      row.id,
      row.status,
    ]),
  );
  const questions = await service.from("questions").select("id");
  if (questions.error) {
    throw new Error(`read the questions: ${questions.error.code}`);
  }
  const questionIds = new Set(
    (questions.data as { id: string }[]).map((row) => row.id),
  );
  return { counts, statuses, questionIds };
}

// What the run's questions created: who asked each, which prompts exist and to whom they were routed.
async function readRun(service: SupabaseClient, world: World): Promise<void> {
  const [questions, prompts, routes] = await Promise.all([
    service.from("questions").select("id, asker_user_id, prompt_id"),
    service
      .from("prompts")
      .select("id, seat_id, kind, source_question_id, listed, retired"),
    service.from("prompt_routes").select("prompt_id, user_id"),
  ]);
  if (questions.error || prompts.error || routes.error) {
    throw new Error("read the run's questions, prompts and routes");
  }
  world.questions.clear();
  for (const row of questions.data as {
    id: string;
    asker_user_id: string;
    prompt_id: string | null;
  }[]) {
    world.questions.set(row.id, {
      askerUserId: row.asker_user_id,
      promptId: row.prompt_id,
    });
  }
  world.prompts.clear();
  for (const row of prompts.data as {
    id: string;
    seat_id: string;
    kind: string;
    source_question_id: string | null;
    listed: boolean;
    retired: boolean;
  }[]) {
    world.prompts.set(row.id, {
      seatId: row.seat_id,
      kind: row.kind,
      askerUserId: row.source_question_id
        ? (world.questions.get(row.source_question_id)?.askerUserId ?? null)
        : null,
      listed: row.listed,
      retired: row.retired,
    });
  }
  world.routes.clear();
  for (const row of routes.data as { prompt_id: string; user_id: string }[]) {
    world.routes.add(`${row.prompt_id} ${row.user_id}`);
  }
}

// The channels ---------------------------------------------------------------------------------

type Context = {
  world: World;
  seats: Map<string, string>; // slug → id
  asks: { label: string; seat: string; text: string }[];
  personaIds: Map<string, string>; // viewer key → user id
  readIds: Map<string, string[]>; // viewer key → the seed notes its select returned
  // What the run created or changed, so the cleanup removes exactly that.
  runQuestions: Set<string>; // ids from the replies and inserts
  probeQuestions: Map<string, string[]>; // viewer key → its waiting, unrouted probe questions
  withdrawnByProbe: Set<string>; // seed notes a withdraw probe got through on (a leak)
  // The demand prompts the run adds itself, routed to nobody, which nobody may read or join: open and unlisted at SEAT,
  // listed but retired at SEAT, open and listed at a seat no viewer holds and nobody can be reached at (the quiet one).
  probePrompts: { unlisted?: string; retired?: string; quiet?: string };
};

async function questions(session: Session, context: Context): Promise<void> {
  for (const ask of context.asks) {
    if (stopping) return;
    await attempt(
      session,
      "questions",
      `POST /api/ask: ${ask.label} at ${ask.seat}`,
      async () => {
        const reply = await http(session, "POST", "/api/ask", {
          seat: ask.seat,
          question: ask.text,
        });
        expectReply(reply, session.token ? [200] : [401]);
        if (reply.status !== 200) return [];
        const result = AskResult.safeParse(reply.body);
        if (!result.success) throw new Inconclusive("not an AskResult");
        context.runQuestions.add(result.data.questionId);
        return session.judge.ask(reply.body, context.seats.get(ask.seat) ?? "");
      },
    );
  }
}

// The answers trigger (0006) and the questions policy: an asker who saves an answer citing notes it can't read gets
// back exactly what it gets for made-up ids, and nobody saves a question in someone else's name.
async function savedRows(session: Session, context: Context): Promise<void> {
  const seatId = context.seats.get(SEAT) ?? "";
  const other =
    [...context.personaIds].find(([key]) => key !== session.key)?.[1] ??
    MADE_UP_UUID;
  await attempt(
    session,
    "oracles",
    "insert a question in someone else's name",
    async () => {
      const rows = await rowsOf(
        session.db
          .from("questions")
          .insert({
            asker_user_id: other,
            seat_id: seatId,
            text: PROBE_TEXT,
            lang: "en",
          })
          .select("id"),
        "refused",
      );
      if (rows === undefined) return [];
      for (const row of rows as { id: string }[]) {
        context.runQuestions.add(row.id);
      }
      return [
        { reason: "saved a question in someone else's name", ref: "questions" },
      ];
    },
  );
  if (!session.userId) return;
  const unreadable = [...seedIds].filter(
    (id) => reads(session.key, id) === false,
  );
  await attempt(
    session,
    "oracles",
    "answers citing notes it can't read vs made-up ids",
    async () => {
      const saved = await rowsOf(
        session.db
          .from("questions")
          .insert(
            [0, 1].map(() => ({
              asker_user_id: session.userId,
              seat_id: seatId,
              text: PROBE_TEXT,
              lang: "en",
            })),
          )
          .select("id"),
        "rows",
      );
      const [real, madeUp] = (saved ?? []) as { id: string }[];
      for (const row of [real, madeUp]) {
        if (row) context.runQuestions.add(row.id);
      }
      if (!real || !madeUp)
        throw new Inconclusive("the two questions weren't saved");
      // Waiting and routed nowhere: what route_question() would take, if it took someone else's question.
      context.probeQuestions.set(session.key, [real.id, madeUp.id]);
      const answer = (questionId: string, noteIds: string[]) => ({
        status: "answered",
        questionId,
        sentences: noteIds.map((noteId) => ({
          text: PROBE_TEXT,
          citations: [{ noteId, byline: PROBE_TEXT, termLabel: PROBE_TEXT }],
        })),
        language: "en",
      });
      const stored = async (questionId: string, noteIds: string[]) => {
        const rows = await rowsOf(
          session.db
            .from("answers")
            .insert({
              question_id: questionId,
              payload: answer(questionId, noteIds),
            })
            .select("payload"),
          "rows",
        );
        return (rows?.[0] as { payload?: unknown } | undefined)?.payload;
      };
      const fromReal = await stored(real.id, unreadable);
      const fromMadeUp = await stored(
        madeUp.id,
        unreadable.map((_, i) => `${MADE_UP_NOTE}-${i}`),
      );
      const findings = [...session.judge.text(fromReal)];
      if (!sameAnswer(fromReal, fromMadeUp)) {
        findings.push({
          reason:
            "the answers trigger keeps notes it can't read apart from made-up ones",
          ref: "answers",
        });
      }
      return findings;
    },
  );
}

async function directReads(session: Session, context: Context): Promise<void> {
  await attempt(session, "reads", "select notes", async () => {
    const rows =
      (await rowsOf(session.db.from("notes").select(NOTE_COLUMNS), "rows")) ??
      [];
    context.readIds.set(
      session.key,
      (rows as { id: string }[])
        .map((row) => row.id)
        .filter((id) => seedIds.has(id)),
    );
    return session.judge.rows("notes", rows);
  });
  for (const table of [
    "questions",
    "answers",
    "prompts",
    "prompt_routes",
    "events",
    "seat_holders",
    "group_members",
  ]) {
    await attempt(session, "reads", `select ${table}`, async () =>
      session.judge.rows(
        table,
        await rowsOf(session.db.from(table).select("*"), "rows"),
      ),
    );
  }
  await attempt(
    session,
    "reads",
    "select institutions with everything under them",
    async () =>
      session.judge.rows(
        "institutions",
        await rowsOf(
          session.db
            .from("institutions")
            .select(
              `id, groups(id, group_members(*), seats(id, slug, seat_holders(*), notes(${NOTE_COLUMNS}), prompts(*, prompt_routes(*))))`,
            ),
          "rows",
        ),
      ),
  );
  await attempt(
    session,
    "reads",
    "select prompt_routes with prompts, questions and answers",
    async () =>
      session.judge.rows(
        "prompt_routes",
        await rowsOf(
          session.db
            .from("prompt_routes")
            .select(
              "*, prompts(*, questions!questions_prompt_id_fkey(*, answers(*)))",
            ),
          "rows",
        ),
      ),
  );
  for (const [slug, seatId] of context.seats) {
    await attempt(session, "reads", `seat_lineage ${slug}`, async () =>
      session.judge.lineage(
        (await rowsOf(
          session.db.rpc("seat_lineage", { seat: seatId }),
          "rows",
        )) ?? [],
      ),
    );
    await attempt(session, "reads", `GET /api/seats/${slug}`, async () => {
      const reply = await http(session, "GET", `/api/seats/${slug}`);
      expectReply(reply, session.token ? [200] : [401]);
      return reply.status === 200 ? session.judge.seatView(reply.body) : [];
    });
  }
  await attempt(session, "reads", "GET /api/me/notes", async () => {
    const reply = await http(session, "GET", "/api/me/notes");
    expectReply(reply, session.token ? [200] : [401]);
    return reply.status === 200 ? session.judge.myNotes(reply.body) : [];
  });

  // A note by id: one the viewer can't read must look exactly like one that doesn't exist.
  const missing = await http(session, "GET", `/api/notes/${MADE_UP_NOTE}`);
  await attempt(
    session,
    "reads",
    `GET /api/notes/${MADE_UP_NOTE}`,
    async () => {
      expectReply(missing, session.token ? [404] : [401]);
      return [];
    },
  );
  for (const id of seedIds) {
    await attempt(session, "reads", `GET /api/notes/${id}`, async () => {
      const reply = await http(session, "GET", `/api/notes/${id}`);
      // Whatever it gets is judged; a note it reads may still be 404 here (withdrawn, or past its valid_until).
      if (reply.status === 200) return session.judge.rows("notes", reply.body);
      expectReply(reply, session.token ? [404] : [401]);
      if (!reads(session.key, id) && !isDeepStrictEqual(reply, missing)) {
        return [
          {
            reason:
              "answers differently for a note it can't read than for none",
            ref: id,
          },
        ];
      }
      return [];
    });
  }
}

async function search(session: Session, context: Context): Promise<void> {
  for (const slug of context.seats.keys()) {
    await attempt(
      session,
      "search",
      `search_notes ${slug}, k 100, no threshold`,
      async () =>
        session.judge.rows(
          "notes",
          await rowsOf(
            session.db.rpc("search_notes", {
              seat: slug,
              query_embedding: UNIT,
              k: 100,
            }),
            session.token ? "rows" : "refused",
          ),
        ),
    );
  }
}

async function inbox(session: Session, context: Context): Promise<void> {
  const expect = session.token ? "rows" : "refused";
  for (const [slug, seatId] of context.seats) {
    await attempt(session, "inbox", `GET /api/inbox?seat=${slug}`, async () => {
      const reply = await http(session, "GET", `/api/inbox?seat=${slug}`);
      expectReply(reply, session.token ? [200] : [401]);
      if (reply.status !== 200) return [];
      const parsed = InboxResponse.safeParse(reply.body);
      if (!parsed.success) throw new Inconclusive("not an InboxResponse");
      return session.judge.inbox(parsed.data.items);
    });
    await attempt(session, "inbox", `inbox() ${slug}`, async () =>
      session.judge.inbox(
        (await rowsOf(session.db.rpc("inbox", { seat: seatId }), expect)) ?? [],
      ),
    );
    // The prompts a holder is offered to join before asking (open_demand_prompts_at(), 0012): for a holder of the seat
    // only its open, listed demand prompts, id and text, for anyone else none. Their text is a holder's question in
    // Haiku's words, which the seat's holders may read (docs/SPEC.md → Scope rules), so what's judged is which prompts
    // come back and that nothing else (who asked, when, how often) comes with them. The run's probe prompts make sure
    // there is one to refuse at every viewer's reach: unlisted and retired ones at SEAT, a listed one at a seat nobody
    // holds.
    await attempt(
      session,
      "inbox",
      `open_demand_prompts_at() ${slug}`,
      async () => {
        const rows = ((await rowsOf(
          session.db.rpc("open_demand_prompts_at", { seat: seatId }),
          expect,
        )) ?? []) as Record<string, unknown>[];
        const holder =
          session.userId !== undefined &&
          (context.world.seatsHeld.get(session.userId)?.has(seatId) ?? false);
        return rows.flatMap((row): Finding[] => {
          const id = typeof row.id === "string" ? row.id : "";
          const findings: Finding[] =
            Object.keys(row).sort().join() === "id,text"
              ? []
              : [
                  {
                    reason: "offered more than a prompt's id and text",
                    ref: id,
                  },
                ];
          const prompt = context.world.prompts.get(id);
          if (!prompt) {
            return [
              ...findings,
              { reason: "a prompt the run didn't see", ref: id, unknown: true },
            ];
          }
          return holder &&
            prompt.seatId === seatId &&
            prompt.kind === "demand" &&
            prompt.listed === true &&
            prompt.retired === false
            ? findings
            : [
                ...findings,
                { reason: "offered a prompt it may not join", ref: id },
              ];
        });
      },
    );
  }
  // Questions wait only on demand prompts (0003): a core, gap or required prompt has none, so probing one would count
  // an attempt that can't find anything.
  for (const [promptId, prompt] of context.world.prompts) {
    if (prompt.kind !== "demand") continue;
    await attempt(
      session,
      "inbox",
      `waiting_questions() ${promptId}`,
      async () =>
        session.judge.waiting(
          (await rowsOf(
            session.db.rpc("waiting_questions", {
              prompt: promptId,
              note_ids: [...seedIds],
            }),
            expect,
          )) ?? [],
        ),
    );
  }
}

// Ids the viewer shouldn't be able to use: each must be answered exactly like a made-up id, so the answer doesn't
// even tell that the note, question or prompt exists.
async function oracles(session: Session, context: Context): Promise<void> {
  const { world } = context;
  const refused = session.token ? [403] : [401];

  // Withdraw: never a note this viewer wrote (that would really withdraw it).
  const madeUp = await http(
    session,
    "POST",
    `/api/notes/${MADE_UP_NOTE}/withdraw`,
  );
  await attempt(
    session,
    "oracles",
    `POST /api/notes/${MADE_UP_NOTE}/withdraw`,
    async () => {
      expectReply(madeUp, refused);
      return [];
    },
  );
  for (const id of seedIds) {
    const author = world.noteAuthors.get(id);
    if (author === undefined || (session.userId && author === session.userId))
      continue;
    await attempt(
      session,
      "oracles",
      `POST /api/notes/${id}/withdraw`,
      async () => {
        const reply = await http(session, "POST", `/api/notes/${id}/withdraw`);
        if (reply.status === 200) {
          context.withdrawnByProbe.add(id); // the cleanup puts it back
          return [{ reason: "withdrew a note it didn't write", ref: id }];
        }
        expectReply(reply, refused);
        return isDeepStrictEqual(reply, madeUp)
          ? []
          : [
              {
                reason:
                  "answers differently for someone else's note than for none",
                ref: id,
              },
            ];
      },
    );
  }

  // route_question with another persona's waiting, unrouted probe question: only its asker may route it. Never a
  // question this run didn't make.
  const otherQuestion = [...context.probeQuestions].find(
    ([key]) => key !== session.key,
  )?.[1][0];
  if (otherQuestion) {
    const call = (question: string) =>
      session.db.rpc("route_question", { question, prompt_text: PROBE_TEXT });
    const none = await call(MADE_UP_UUID);
    await attempt(
      session,
      "oracles",
      "route_question() a made-up question",
      async () => {
        if (none.error?.code !== "42501")
          throw new Inconclusive(
            `PostgREST ${none.error?.code ?? "rows"}, expected a refusal`,
          );
        return [];
      },
    );
    await attempt(
      session,
      "oracles",
      `route_question() someone else's question ${otherQuestion}`,
      async () => {
        const result = await call(otherQuestion);
        if (!result.error)
          return [
            { reason: "routed someone else's question", ref: otherQuestion },
          ];
        if (result.error.code !== "42501")
          throw new Inconclusive(
            `PostgREST ${result.error.code}, expected a refusal`,
          );
        return result.error.code === none.error?.code &&
          result.error.message === none.error?.message
          ? []
          : [
              {
                reason:
                  "answers differently for someone else's question than for none",
                ref: otherQuestion,
              },
            ];
      },
    );
  }

  // Draft and seen, each with a prompt this viewer may not use, and never one routed to it: that would draft with
  // Sonnet or mark its slip seen.
  // - Draft reads the prompt as the caller (0003's prompts policy). For a holder of the seat that means a demand prompt
  //   that isn't routed to it (for a26, the prompt its own question started; for a25, who gets every other one, the
  //   run's probe prompt). Core, gap and required prompts are for every holder (F6), so a holder drafting one is the
  //   design, not a leak.
  // - Seen marks the caller's own route, so it's any prompt there that isn't routed to it, core prompts included.
  // For anyone else, any prompt at the seat.
  const seatId = context.seats.get(SEAT);
  const holder =
    session.userId !== undefined &&
    seatId !== undefined &&
    (world.seatsHeld.get(session.userId)?.has(seatId) ?? false);
  const unrouted = [...world.prompts].filter(
    ([id, prompt]) =>
      prompt.seatId === seatId && !world.routes.has(`${id} ${session.userId}`),
  );
  const forDraft = unrouted.find(
    ([, prompt]) => !holder || prompt.kind === "demand",
  )?.[0];
  if (holder && !forDraft) {
    console.log(
      `  ${session.key}: no demand prompt at ${SEAT} that isn't routed to it, so draft has no prompt it may not read`,
    );
  }
  const probes: [string, (id: string) => unknown, string, string?][] = [
    [
      "/api/handover/draft",
      (id) => ({ seat: SEAT, promptId: id, answer: PROBE_TEXT }),
      "a prompt it may not read",
      forDraft,
    ],
    [
      "/api/inbox/seen",
      (id) => ({ promptId: id }),
      "a prompt not routed to it",
      unrouted[0]?.[0],
    ],
  ];
  for (const [path, body, what, promptId] of probes) {
    if (!promptId) continue;
    const none = await http(session, "POST", path, body(MADE_UP_UUID));
    await attempt(
      session,
      "oracles",
      `POST ${path} a made-up prompt`,
      async () => {
        expectReply(none, session.token ? [404] : [401]);
        return [];
      },
    );
    await attempt(
      session,
      "oracles",
      `POST ${path} prompt ${promptId}`,
      async () => {
        const reply = await http(session, "POST", path, body(promptId));
        if (reply.status === 200)
          return [{ reason: `${path} works on ${what}`, ref: promptId }];
        expectReply(reply, session.token ? [404] : [401]);
        return isDeepStrictEqual(reply, none)
          ? []
          : [
              {
                reason: `answers differently for ${what} than for none`,
                ref: promptId,
              },
            ];
      },
    );
  }

  // ask_question joining prompts this viewer may not join (the run's probe prompts: unlisted at SEAT, retired at SEAT,
  // and one at another seat) and a made-up one, with no prompt text, so nothing reaches a25 whatever happens (#69). Each
  // must route nowhere and answer like the made-up one apart from the new question's id. The questions it saves go to
  // the cleanup.
  const targets = [
    context.probePrompts.unlisted,
    context.probePrompts.retired,
    context.probePrompts.quiet,
  ].filter((id): id is string => id !== undefined);
  if (targets.length > 0 && seatId) {
    const othersReachable = [...world.reachable].some(
      (key) =>
        key.startsWith(`${seatId} `) && key !== `${seatId} ${session.userId}`,
    );
    if (holder && othersReachable) joinReached.add(session.key);
    const askJoining = async (prompt: string) => {
      const { data, error } = await session.db.rpc("ask_question", {
        seat: seatId,
        question: PROBE_TEXT,
        lang: "en",
        join_prompt: prompt,
      });
      const row = (Array.isArray(data) ? data[0] : data) as
        | {
            question_id?: string;
            prompt_id?: string | null;
            routed_to?: number;
          }
        | null
        | undefined;
      if (row?.question_id) context.runQuestions.add(row.question_id);
      return {
        error: error && { code: error.code, message: error.message },
        promptId: row?.prompt_id,
        routedTo: row?.routed_to,
      };
    };
    const none = await askJoining(MADE_UP_UUID);
    await attempt(
      session,
      "oracles",
      "ask_question() joining a made-up prompt",
      async () => {
        const expected = session.token
          ? !none.error && none.promptId === null && none.routedTo === 0
          : none.error?.code === "42501";
        if (!expected)
          throw new Inconclusive(
            `${none.error ? `PostgREST ${none.error.code}` : `prompt ${none.promptId ? "set" : "none"}, routedTo ${none.routedTo}`}, expected ${session.token ? "routed nowhere" : "a refusal"}`,
          );
        return [];
      },
    );
    for (const target of targets) {
      await attempt(
        session,
        "oracles",
        `ask_question() joining prompt ${target}`,
        async () => {
          const reply = await askJoining(target);
          if (reply.promptId === target)
            return [{ reason: "joined a prompt it may not join", ref: target }];
          return isDeepStrictEqual(reply, none)
            ? []
            : [
                {
                  reason:
                    "answers differently for a prompt it may not join than for none",
                  ref: target,
                },
              ];
        },
      );
    }
  }

  // The console's sign-in route hands out a25's and a26's sessions: never without the passphrase.
  if (session.key === OUTSIDER || !session.token) {
    const wrongKey = randomBytes(16).toString("hex");
    for (const [label, headers] of [
      ["no key", {}],
      ["a wrong key", { "x-console-key": wrongKey }],
    ] as const) {
      await attempt(
        session,
        "oracles",
        `POST /api/console/session as a25, ${label}`,
        async () => {
          const reply = await http(
            session,
            "POST",
            "/api/console/session",
            { persona: "a25" },
            headers,
          );
          if (reply.status === 200)
            return [
              { reason: "handed out a25's session", ref: "console/session" },
            ];
          expectReply(reply, [404]);
          return [];
        },
      );
    }
  }
}

// Realtime: each re-saved seed note, the events probe, and everything else the viewer heard during the run.
function judgeRealtime(
  session: Session,
  touched: string[],
  probeEventId: number,
): void {
  const isNote = (message: Heard, id: string) =>
    message.table === "notes" && message.new?.id === id;
  for (const id of touched) {
    const messages = session.heard.filter((message) => isNote(message, id));
    const findings = messages.flatMap((message) =>
      session.judge.realtime(message),
    );
    attempts.push({
      viewer: session.key,
      channel: "realtime",
      label: `notes ${id} re-saved`,
      findings: findings.filter((finding) => !finding.unknown),
      inconclusive:
        reads(session.key, id) && messages.length === 0
          ? "never arrived, so Realtime wasn't really listening"
          : undefined,
    });
  }
  const isProbe = (message: Heard) =>
    message.table === "events" && message.new?.id === probeEventId;
  attempts.push({
    viewer: session.key,
    channel: "realtime",
    label: "events row of kind leak",
    findings: session.heard
      .filter(isProbe)
      .flatMap((message) => session.judge.realtime(message))
      .filter((finding) => !finding.unknown),
  });
  const rest = session.heard.filter(
    (message) =>
      !isProbe(message) && !touched.some((id) => isNote(message, id)),
  );
  const findings = rest.flatMap((message) => session.judge.realtime(message));
  const unknown = findings.filter((finding) => finding.unknown);
  attempts.push({
    viewer: session.key,
    channel: "realtime",
    label: `everything else it heard (${rest.length} messages)`,
    findings: findings.filter((finding) => !finding.unknown),
    inconclusive:
      session.trouble ??
      (unknown.length > 0
        ? `rows this run didn't create (${unknown.length}): someone else acting?`
        : undefined),
  });
}

// Cleanup ------------------------------------------------------------------------------------------

// Removes what the run created: the events probe, the prompts its questions started and the questions themselves
// (their answers and routes go with them; Realtime sends no deletes). A seed note a withdraw probe took is restored.
// Then the counts and the seed notes' statuses must be what they were before. Answers what isn't; never throws.
async function cleanUp(
  service: SupabaseClient,
  before: Snapshot,
  run: {
    since: string;
    askers: string[];
    questions: Set<string>;
    withdrawnByProbe: Set<string>;
    probeEventId?: number;
    probePromptText: string;
  },
): Promise<string[]> {
  const problems: string[] = [];
  if (run.probeEventId !== undefined) {
    const { error } = await service
      .from("events")
      .delete()
      .eq("id", run.probeEventId);
    if (error) problems.push(`delete the events probe: ${error.code}`);
  }
  // The questions the run made: the ids its replies and inserts gave, and probe-text rows from an insert whose reply
  // was lost. Never a question that was there before the run, and never someone else's real question: one asked during
  // the run with the same text stays, and the counts below then say the database isn't as the run found it.
  const probes = await service
    .from("questions")
    .select("id")
    .in("asker_user_id", run.askers)
    .eq("text", PROBE_TEXT)
    .gte("created_at", run.since);
  if (probes.error)
    return [
      ...problems,
      `find the run's probe questions: ${probes.error.code}`,
    ];
  const ids = [
    ...new Set([
      ...run.questions,
      ...(probes.data as { id: string }[]).map((row) => row.id),
    ]),
  ].filter((id) => !before.questionIds.has(id));
  // With them the prompts they started, unless a rehearsal's question joined one (scripts/remove-questions.ts).
  problems.push(...(await removeQuestions(service, ids)));
  // The probe prompts, after the questions: a question that joined one (a leak, already reported) is gone by now. By
  // this run's own text, so one whose insert reply was lost goes too.
  const swept = await service
    .from("prompts")
    .delete()
    .eq("text", run.probePromptText);
  if (swept.error)
    problems.push(`delete the probe prompts: ${swept.error.code}`);

  // Only the notes a withdraw probe got through on (a leak, already reported) go back to live; a withdrawal anyone
  // else made during the run stays. Its events row stays too, and so do the answers it rewrote, so the counts below
  // say the database isn't as the run found it.
  const taken = [...run.withdrawnByProbe];
  if (taken.length > 0) {
    const { error } = await service
      .from("notes")
      .update({ status: "live", withdrawn_at: null })
      .in("id", taken);
    if (error) problems.push(`restore ${taken.join(", ")}: ${error.code}`);
  }

  const after = await snapshot(service);
  const keys = new Set([
    ...Object.keys(before.counts),
    ...Object.keys(after.counts),
  ]);
  for (const key of keys) {
    if ((before.counts[key] ?? 0) !== (after.counts[key] ?? 0)) {
      problems.push(
        `${key}: ${before.counts[key] ?? 0} before, ${after.counts[key] ?? 0} after`,
      );
    }
  }
  if (!isDeepStrictEqual(before.statuses, after.statuses)) {
    problems.push("the seed notes' statuses changed");
  }
  return problems;
}

// Report -----------------------------------------------------------------------------------------

const camel = (key: string) =>
  key.replace(/\s+(\w)/g, (_, letter: string) => letter.toUpperCase());
const cell = (text: string | number, width: number) =>
  String(text).padEnd(width);

function report(sessions: Session[], notes: NoteRow[], context: Context): void {
  const width = 12;
  console.log(
    `\n${cell("viewer", width)}${CHANNELS.map((channel) => cell(channel, 11)).join("")}${cell("total", 8)}leaks`,
  );
  for (const session of sessions) {
    const mine = attempts.filter((item) => item.viewer === session.key);
    const leaked = mine.filter((item) => item.findings.length > 0).length;
    const counts = CHANNELS.map((channel) =>
      cell(mine.filter((item) => item.channel === channel).length, 11),
    ).join("");
    const outsider =
      session.key === OUTSIDER
        ? ` (outsider, at least ${MIN_OUTSIDER_ATTEMPTS})`
        : "";
    console.log(
      `${cell(session.key, width)}${counts}${cell(mine.length, 8)}${leaked}${outsider}`,
    );
  }

  // What each viewer's own select returned, by scope ring: the persona × scope matrix of docs/SPEC.md.
  const rings = ["successor", "group", "institution", "public"];
  console.log(`\nseed notes each viewer read (select notes), by scope ring`);
  console.log(
    `${cell("viewer", width)}${rings.map((ring) => cell(ring, 13)).join("")}`,
  );
  for (const session of sessions) {
    const read = new Set(context.readIds.get(session.key) ?? []);
    const cells = rings.map((ring) => {
      const inRing = notes.filter((note) => note.scope === ring);
      return cell(
        `${inRing.filter((note) => read.has(note.id)).length}/${inRing.length}`,
        13,
      );
    });
    console.log(`${cell(session.key, width)}${cells.join("")}`);
  }

  const leaks = attempts.filter((item) => item.findings.length > 0);
  if (leaks.length > 0) console.log(`\nleaks:`);
  for (const item of leaks) {
    for (const finding of item.findings) {
      console.log(
        `  ✗ ${item.viewer} · ${item.channel} · ${item.label}: ${finding.reason}${finding.ref ? ` (${finding.ref})` : ""}`,
      );
    }
  }
  const unsure = attempts.filter((item) => item.inconclusive);
  if (unsure.length > 0)
    console.log(`\ninconclusive (they prove nothing either way):`);
  for (const item of unsure.slice(0, 20)) {
    console.log(
      `  ? ${item.viewer} · ${item.channel} · ${item.label}: ${item.inconclusive}`,
    );
  }
  if (unsure.length > 20) console.log(`  … and ${unsure.length - 20} more`);
}

// The run ---------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const password = env("DEMO_PASSWORD");
  const service = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const notes = await readCsv<NoteRow>("notes.csv");
  const csvQuestions = await readCsv<QuestionRow>("questions.csv");
  const seatRows = await service.from("seats").select("id, slug");
  if (seatRows.error) throw new Error(`read the seats: ${seatRows.error.code}`);
  const seats = new Map(
    (seatRows.data as { id: string; slug: string }[]).map((row) => [
      row.slug,
      row.id,
    ]),
  );
  const [authors, holders] = await Promise.all([
    service.from("notes").select("id, author_user_id"),
    service.from("seat_holders").select("user_id, seat_id, reachable"),
  ]);
  if (authors.error || holders.error)
    throw new Error("read the notes' authors and the seat holders");

  const world: World = {
    seedNotes: notes,
    noteAuthors: new Map(
      (authors.data as { id: string; author_user_id: string | null }[]).map(
        (row) => [row.id, row.author_user_id],
      ),
    ),
    seatsHeld: new Map(),
    reachable: new Set(),
    questions: new Map(),
    prompts: new Map(),
    routes: new Set(),
    personas: new Map(),
  };
  for (const row of holders.data as {
    user_id: string;
    seat_id: string;
    reachable: boolean;
  }[]) {
    const held = world.seatsHeld.get(row.user_id) ?? new Set<string>();
    held.add(row.seat_id);
    world.seatsHeld.set(row.user_id, held);
    if (row.reachable) world.reachable.add(`${row.seat_id} ${row.user_id}`);
  }

  const sessions = await Promise.all(
    viewers.map((viewer) =>
      signIn(url, anonKey, viewer.key, viewer.email, password, world),
    ),
  );
  const personaIds = new Map<string, string>();
  for (const session of sessions) {
    if (session.userId) {
      personaIds.set(session.key, session.userId);
      world.personas.set(session.userId, session.key);
    }
  }

  // Nothing is written unless a25's inbox is empty, as the seed leaves it: otherwise someone may be rehearsing.
  const a25 = sessions.find((session) => session.key === "a25");
  if (!a25) throw new Error("no a25 in tests/visibility-table.ts");
  const waiting = await http(a25, "GET", `/api/inbox?seat=${SEAT}`);
  const items = InboxResponse.safeParse(waiting.body);
  if (!items.success)
    throw new Error(
      `read a25's inbox: HTTP ${waiting.status} (is pnpm dev running?)`,
    );
  if (items.data.items.length > 0) {
    throw new Error(
      `a25's inbox holds ${items.data.items.length} question(s): someone may be rehearsing. If not, run pnpm demo:reset first`,
    );
  }

  // The visibility table is the seed state: with a seed note withdrawn (an F4 rehearsal without a reset), a policy that
  // still served it would look allowed.
  const before = await snapshot(service);
  const notLive = [...seedIds].filter((id) => before.statuses[id] !== "live");
  if (notLive.length > 0) {
    throw new Error(
      `seed note(s) not live: ${notLive.join(", ")}. The visibility table is the seed state: run pnpm demo:reset first`,
    );
  }
  const context: Context = {
    world,
    seats,
    asks: [
      ...csvQuestions.map((row) => ({
        label: row.id,
        seat: row.seat_slug,
        text: row.question,
      })),
      ...notes.map((note) => ({
        label: `the title of ${note.id}`,
        seat: note.seat_slug,
        text: note.title,
      })),
    ],
    personaIds,
    readIds: new Map(),
    runQuestions: new Set(),
    probeQuestions: new Map(),
    withdrawnByProbe: new Set(),
    probePrompts: {},
  };
  const run = {
    since: new Date(Date.now() - 60_000).toISOString(), // a minute of slack for the clocks
    askers: [...personaIds.values()],
    questions: context.runQuestions,
    withdrawnByProbe: context.withdrawnByProbe,
    probeEventId: undefined as number | undefined,
    probePromptText: `leak test probe prompt ${randomBytes(6).toString("hex")}`,
  };

  let touched: string[] = [];
  let problems: string[] = [];
  let stopped: string | undefined;
  try {
    await Promise.all(sessions.map(listen));
    console.log(
      `✓ ${sessions.length} viewers listen to every Realtime change they're allowed`,
    );

    // The Realtime probe: the live seed notes saved again unchanged, and an events row nobody signed in may read.
    const saved = await service
      .from("notes")
      .update({ status: "live" })
      .in("id", [...seedIds])
      .eq("status", "live")
      .select("id");
    if (saved.error)
      throw new Error(`re-save the seed notes: ${saved.error.code}`);
    touched = (saved.data as { id: string }[]).map((row) => row.id).sort();
    const probe = await service
      .from("events")
      .insert({
        kind: "leak",
        payload: EventsRow.shape.payload.parse({ probe: 1 }),
      })
      .select("id")
      .single();
    if (probe.error)
      throw new Error(`write the events probe: ${probe.error.code}`);
    run.probeEventId = (probe.data as { id: number }).id;
    const heardAll = (session: Session) =>
      touched
        .filter((id) => reads(session.key, id))
        .every((id) =>
          session.heard.some(
            (message) => message.table === "notes" && message.new?.id === id,
          ),
        );
    await waitFor(() => sessions.every(heardAll), PROBE_MS);
    console.log(
      `✓ Realtime probe: ${touched.length} seed notes re-saved, 1 events row`,
    );

    stopIfAsked();
    const started = performance.now();
    await Promise.all(sessions.map((session) => questions(session, context)));
    stopIfAsked();
    await Promise.all(sessions.map((session) => savedRows(session, context)));
    console.log(
      `✓ questions asked (${Math.round((performance.now() - started) / 1000)} s)`,
    );

    stopIfAsked();
    // The probe prompts, added after the questions so none of them could join one, with this run's own text so the
    // cleanup finds them even if an insert's reply was lost:
    // - at SEAT, open and unlisted: nobody may read or join it;
    // - at SEAT, listed but retired: no holder is offered it;
    // - open and listed at a seat that no viewer holds and nobody can be reached at, so nobody can join a prompt there:
    //   no viewer may be offered it, whether or not Haiku worded any of the run's own prompts.
    // Each is also a prompt the join probe (oracles) must not join.
    const smashId = context.seats.get(SEAT);
    const heldByViewers = new Set(
      [...context.personaIds.values()].flatMap((userId) => [
        ...(world.seatsHeld.get(userId) ?? []),
      ]),
    );
    const quietSeat = [...context.seats.values()].find(
      (id) =>
        id !== smashId &&
        !heldByViewers.has(id) &&
        ![...world.reachable].some((key) => key.startsWith(`${id} `)),
    );
    const probePrompts: {
      seat_id: string;
      retired: boolean;
      listed: boolean;
    }[] = [];
    if (smashId) {
      probePrompts.push(
        { seat_id: smashId, retired: false, listed: false },
        { seat_id: smashId, retired: true, listed: true },
      );
    }
    if (quietSeat) {
      probePrompts.push({ seat_id: quietSeat, retired: false, listed: true });
    }
    const added = await service
      .from("prompts")
      .insert(
        probePrompts.map((prompt) => ({
          ...prompt,
          kind: "demand",
          text: run.probePromptText,
          ask_count: 1,
        })),
      )
      .select("id, seat_id, listed, retired");
    if (added.error)
      throw new Error(`write the probe prompts: ${added.error.code}`);
    const rows = added.data as {
      id: string;
      seat_id: string;
      listed: boolean;
      retired: boolean;
    }[];
    context.probePrompts = {
      unlisted: rows.find((row) => row.seat_id === smashId && !row.listed)?.id,
      retired: rows.find((row) => row.seat_id === smashId && row.retired)?.id,
      quiet: rows.find((row) => row.seat_id === quietSeat)?.id,
    };
    await readRun(service, world);
    await Promise.all(
      sessions.map(async (session) => {
        await directReads(session, context);
        await search(session, context);
        await inbox(session, context);
        await oracles(session, context);
      }),
    );
    // Rows an oracle may have created (only if it leaked) are known before the cleanup removes them.
    await readRun(service, world);
    console.log(`✓ reads, search, inbox and oracles done`);
  } catch (error) {
    // Still clean up below: the run may have written something before the error.
    stopped = error instanceof Error ? error.message : String(error);
  } finally {
    // Whatever happens here, the channels still close below, or the open sockets keep the process alive.
    try {
      problems = await cleanUp(service, before, run);
    } catch (error) {
      problems = [
        `the cleanup stopped: ${error instanceof Error ? error.message : "error"}`,
      ];
    }
    await pause(SETTLE_MS);
    for (const session of sessions) {
      session.closing = true;
      await session.db.removeAllChannels();
      session.db.realtime.disconnect();
    }
  }
  if (run.probeEventId !== undefined) {
    for (const session of sessions)
      judgeRealtime(session, touched, run.probeEventId);
  }

  report(sessions, notes, context);

  const outsiderAttempts = attempts.filter(
    (item) => item.viewer === OUTSIDER,
  ).length;
  const found = attempts.filter((item) => item.findings.length > 0).length;
  const inconclusive = attempts.filter((item) => item.inconclusive).length;
  const payload = EventsRow.shape.payload.parse({
    outsiderAttempts,
    totalAttempts: attempts.length,
    found,
    inconclusive,
    ...Object.fromEntries(
      sessions.flatMap((session) => {
        const mine = attempts.filter((item) => item.viewer === session.key);
        return [
          [`${camel(session.key)}Attempts`, mine.length],
          [
            `${camel(session.key)}Found`,
            mine.filter((item) => item.findings.length > 0).length,
          ],
        ];
      }),
    ),
  });
  const recorded = await service
    .from("events")
    .insert({ kind: "leak", payload });

  const enough = outsiderAttempts >= MIN_OUTSIDER_ATTEMPTS;
  const joinTested = joinReached.size > 0;
  // Without the quiet seat's listed prompt, open_demand_prompts_at() may have had nothing to refuse anyone.
  const quietTested = context.probePrompts.quiet !== undefined;
  const conclusive =
    !stopped && inconclusive === 0 && enough && joinTested && quietTested;
  console.log(
    `\n${found === 0 ? "✓" : "✗"} ${found} leak(s) in ${attempts.length} attempts, ${outsiderAttempts} by the outsider x${enough ? "" : ` (fewer than ${MIN_OUTSIDER_ATTEMPTS})`}${inconclusive > 0 ? `; ${inconclusive} inconclusive` : ""}`,
  );
  if (stopped) console.log(`✗ stopped early: ${stopped}`);
  console.log(
    joinTested
      ? `✓ ask_question()'s join was probed for ${[...joinReached].join(", ")}`
      : `✗ no viewer's ask_question() reached the join (a holder of ${SEAT} with someone else reachable there), so the join probe tested nothing`,
  );
  if (!quietTested) {
    console.log(
      "✗ no seat that no viewer holds and nobody can be reached at, so open_demand_prompts_at() had no listed prompt to refuse there",
    );
  }
  console.log(
    recorded.error
      ? `✗ write the events row: ${recorded.error.code}`
      : `✓ 1 events row of kind leak (numbers only)`,
  );
  console.log(
    problems.length === 0
      ? "✓ the database is as the run found it"
      : `✗ the database isn't as the run found it:\n  ${problems.join("\n  ")}`,
  );
  // Only a conclusive run gives numbers for `pnpm metrics`: a missing number is honest, a 0 from a run that proved
  // nothing is not. A conclusive run that found leaks gives them too: the README never rounds a leak count down.
  if (conclusive) {
    const leaks: NonNullable<Metrics["leaks"]> = {
      outsiderAttempts,
      totalAttempts: attempts.length,
      found,
    };
    reportMetrics({ leaks });
  }
  process.exitCode =
    conclusive && found === 0 && problems.length === 0 && !recorded.error
      ? 0
      : 1;
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
