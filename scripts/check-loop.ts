// #11 acceptance check (docs/SPEC.md → F3): the live loop works every time, with timings. Five runs in a row, as the
// phones do it: a26 asks q04, which nobody can answer (「誰も知りません」); the question reaches a25's phone by Realtime;
// a25 opens the inbox, answers with seed/live-answer.txt, which is drafted into a card, and publishes it; a26's phone
// gets the answer by Realtime, signed 「2025年度 会計」, every sentence citing the new note. Each run's seconds from
// 「誰も知りません」 to the signed answer go to events (kind "loop", numbers only), and the median is printed. Then it
// runs `pnpm demo:reset` and checks that a25's inbox is empty again; the reset keeps the loop rows (scripts/seed.ts).
// Runs against the seeded database and a running dev server, with Ollama (the search and the note's embedding) and the
// Claude key (the draft and the answer, Sonnet):
//   pnpm dev          (in another terminal)
//   pnpm test:loop
// The phones act through the API with their own tokens. The service-role key, which only scripts/ may hold, writes
// the events rows and removes each run's rows, so the next run starts from the seed state again.
// Don't run it during a rehearsal: it writes nothing unless a25's inbox is empty, but the reset at the end replaces
// all demo data and demo users.
// Counts, ids, personas and timings only: never the question, answer or note text, never an email.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  createClient,
  type RealtimePostgresChangesPayload,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";
import {
  AnswersRow,
  AskResult,
  DraftResponse,
  EventsRow,
  InboxResponse,
  LiveAnswer,
  type Metrics,
  PublishResponse,
} from "@/lib/contracts";
import { reportMetrics } from "@/scripts/metrics-line";

type QuestionRow = {
  id: string;
  persona: string;
  seat_slug: string;
  question: string;
};

const BASE_URL = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const RUNS = 5; // SPEC F3: 5 runs in a row
const STAGE_S = 45; // SPEC F3: on stage under 45 s from 「誰も知りません」 to the signed answer
const SUBSCRIBE_MS = 20_000; // longer than the server's postgres_changes wait (15 s)
const ROUTE_MS = 10_000; // a new question must reach a25's phone well inside this
const ANSWER_MS = 30_000; // publishing embeds the note and asks Sonnet before the answer goes out
const REQUEST_MS = 60_000; // one request: a hung server fails the run instead of blocking pnpm metrics

// Ctrl-C (or pnpm metrics stopping) ends the check after the run in flight; its cleanup and the reset still run.
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopping = true;
  });
}

// scripts/seed.ts gives every persona one account at <key>@example.com; seed/questions.csv calls them by alias.
const EMAIL: Record<string, string> = {
  a25: "smash-kaikei-2025",
  a26: "smash-kaikei-2026",
};
const PUBLISHER = "a25"; // the seat's reachable 2025 treasurer
const BYLINE = "2025年度 会計"; // a25's term at 会計, worded by the club_role label pack

function email(persona: string): string {
  const key = EMAIL[persona];
  if (!key) throw new Error(`unknown persona ${persona}: add it to EMAIL`);
  return `${key}@example.com`;
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

const seconds = (ms: number) => (ms / 1000).toFixed(1);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function readQuestions(): Promise<QuestionRow[]> {
  const text = await readFile(
    new URL("../seed/questions.csv", import.meta.url),
    "utf8",
  );
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  }) as QuestionRow[];
}

// A Realtime row as one phone received it.
type Received = { at: number; row: Record<string, unknown> };
type Phone = {
  persona: string;
  db: SupabaseClient;
  token: string;
  userId: string;
  heard: Received[];
};

// One signed-in persona per client, as on its own phone.
async function signIn(
  url: string,
  anonKey: string,
  persona: string,
  password: string,
): Promise<Phone> {
  const db = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.signInWithPassword({
    email: email(persona),
    password,
  });
  if (error || !data.session) {
    throw new Error(`sign in as ${persona}: ${error?.message ?? "no session"}`);
  }
  return {
    persona,
    db,
    token: data.session.access_token,
    userId: data.user.id,
    heard: [],
  };
}

// Listens to every row of one table this phone may read, as its screen does: a25's inbox to prompt_routes, a26's
// answer pane to answers. The join waits for the server to confirm the postgres_changes subscription and for the
// replication-ready system event, so a change made right after this resolves is never lost (as in check-inbox.ts).
async function listen(
  phone: Phone,
  table: "prompt_routes" | "answers",
): Promise<void> {
  await phone.db.realtime.setAuth(phone.token);
  return new Promise((resolve, reject) => {
    let subscribed = false;
    let replicating = false;
    const settle = (error?: Error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () =>
        settle(
          new Error(
            `${phone.persona}: Realtime not ready in time (${subscribed ? "subscribed" : "not subscribed"}, ${replicating ? "replicating" : "no replication"})`,
          ),
        ),
      SUBSCRIBE_MS,
    );
    phone.db
      .channel(`check-loop-${phone.persona}`, {
        config: {
          broadcast: { replication_ready: true },
          postgres_changes_options: { wait: true },
        },
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
          phone.heard.push({
            at: performance.now(),
            row: payload.new as Record<string, unknown>,
          }),
      )
      .on("system", {}, (payload: { extension?: string; status?: string }) => {
        if (payload.extension !== "system") return;
        if (payload.status === "ok") {
          replicating = true;
          if (subscribed) settle();
        } else {
          settle(
            new Error(
              `${phone.persona}: Realtime replication ${payload.status}`,
            ),
          );
        }
      })
      .subscribe((status, error) => {
        if (status === "SUBSCRIBED") {
          subscribed = true;
          if (replicating) settle();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          settle(
            new Error(
              `${phone.persona}: Realtime ${status}${error ? ` (${error.message})` : ""}`,
            ),
          );
        }
      });
  });
}

async function call(
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.body === undefined ? "GET" : "POST",
    headers: {
      ...(options.body !== undefined && { "content-type": "application/json" }),
      ...(options.token && { authorization: `Bearer ${options.token}` }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(REQUEST_MS),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => undefined),
  };
}

async function inboxItems(phone: Phone, seat: string): Promise<number> {
  const response = await call(`/api/inbox?seat=${seat}`, {
    token: phone.token,
  });
  const inbox = InboxResponse.safeParse(response.body);
  if (!inbox.success) {
    throw new Error(`read ${phone.persona}'s inbox: HTTP ${response.status}`);
  }
  return inbox.data.items.length;
}

// What both phones share across the runs.
type World = {
  service: SupabaseClient;
  seat: { id: string; slug: string };
  question: string; // q04, as a26 asks it
  answer: string; // seed/live-answer.txt, as a25 says it
  asker: Phone; // a26
  publisher: Phone; // a25
};

// What one run wrote, for its cleanup.
type Run = {
  since: string;
  titles: string[]; // the drafted cards' titles
  noteIds: string[]; // what the publish answered
  publishedSince?: string; // set just before a25 publishes
};

// Milliseconds of each step, a step that never ran left out: the question reaching a25's phone after
// 「誰も知りません」 (0 when it was there first), a25's inbox, the draft, and 公開 until the answer is on a26's phone.
type Steps = Partial<
  Record<"routeMs" | "inboxMs" | "draftMs" | "answerMs", number>
>;
type Outcome =
  | { ok: true; s: number; steps: Steps }
  | { ok: false; problem: string; steps: Steps };

async function runOnce(world: World, run: Run): Promise<Outcome> {
  const { asker, publisher } = world;
  const seat = world.seat.slug;
  const steps: Steps = {};
  const fail = (problem: string): Outcome => ({ ok: false, problem, steps });

  // 1. a26 asks q04: no note answers it, so 「誰も知りません」 and a prompt routed to a25.
  const asked = await call("/api/ask", {
    token: asker.token,
    body: { seat, question: world.question },
  });
  const abstainedAt = performance.now();
  const result = AskResult.safeParse(asked.body);
  const abstained =
    result.success && result.data.status === "abstained"
      ? result.data
      : undefined;
  const promptId = abstained?.promptId;
  if (asked.status !== 200 || !abstained || !promptId) {
    return fail(
      `a26's q04 isn't 「誰も知りません」 with a prompt (HTTP ${asked.status}${result.success ? `, ${result.data.status}` : ""})`,
    );
  }
  if (abstained.routedTo !== 1) {
    return fail(`q04 was routed to ${abstained.routedTo} holders, not a25`);
  }

  // 2. The question reaches a25's phone by Realtime.
  const isRoute = (received: Received) =>
    received.row.prompt_id === promptId &&
    received.row.user_id === publisher.userId;
  if (!(await waitFor(() => publisher.heard.some(isRoute), ROUTE_MS))) {
    return fail(`the question didn't reach a25's phone within ${ROUTE_MS} ms`);
  }
  const route = publisher.heard.find(isRoute);
  steps.routeMs = Math.max(0, (route?.at ?? abstainedAt) - abstainedAt);

  // 3. a25 opens the inbox: the question is there.
  let started = performance.now();
  const opened = await call(`/api/inbox?seat=${seat}`, {
    token: publisher.token,
  });
  steps.inboxMs = performance.now() - started;
  const inbox = InboxResponse.safeParse(opened.body);
  if (
    !inbox.success ||
    !inbox.data.items.some((item) => item.promptId === promptId)
  ) {
    return fail(`the question isn't in a25's inbox (HTTP ${opened.status})`);
  }

  // 4. a25 answers, and the answer is drafted into cards.
  started = performance.now();
  const drafted = await call("/api/handover/draft", {
    token: publisher.token,
    body: { seat, promptId, answer: world.answer },
  });
  steps.draftMs = performance.now() - started;
  const draft = DraftResponse.safeParse(drafted.body);
  if (drafted.status !== 200 || !draft.success) {
    return fail(`drafting failed (HTTP ${drafted.status})`);
  }
  const { cards } = draft.data;
  if (cards.length === 0) return fail("drafting gave no card");
  run.titles = cards.map((card) => card.title);

  // 5. 公開: every card, at its suggested scope, as a25's phone publishes it (components/VoiceAnswer.tsx).
  run.publishedSince = new Date(Date.now() - 10_000).toISOString(); // a little slack for the clocks
  started = performance.now();
  const published = await call("/api/handover/publish", {
    token: publisher.token,
    body: {
      seat,
      promptId,
      cards: cards.map((card) => ({ ...card, scope: card.suggested_scope })),
    },
  });
  const response = PublishResponse.safeParse(published.body);
  if (response.success) run.noteIds.push(...response.data.noteIds);
  if (
    published.status !== 200 ||
    !response.success ||
    !response.data.reanswered.includes(abstained.questionId)
  ) {
    return fail(
      `publishing didn't answer a26's question (HTTP ${published.status})`,
    );
  }

  // 6. a26's phone gets the answer by Realtime: signed by a25, every sentence citing a note a25 just published.
  const isAnswer = (received: Received) =>
    received.row.question_id === abstained.questionId;
  if (!(await waitFor(() => asker.heard.some(isAnswer), ANSWER_MS))) {
    return fail(`a26's phone got no answer within ${ANSWER_MS} ms of 公開`);
  }
  const received = asker.heard.find(isAnswer);
  const answeredAt = received?.at ?? performance.now();
  steps.answerMs = answeredAt - started;
  const row = AnswersRow.safeParse(received?.row);
  const live = LiveAnswer.safeParse(row.success ? row.data.payload : undefined);
  if (!live.success || live.data.live.byline !== BYLINE) {
    return fail(`the answer isn't signed 「${BYLINE}」`);
  }
  const noteIds = new Set(response.data.noteIds);
  if (
    live.data.sentences.length === 0 ||
    !live.data.sentences.every((sentence) =>
      sentence.citations.some((citation) => noteIds.has(citation.noteId)),
    )
  ) {
    return fail("a sentence doesn't cite a note a25 just published");
  }
  return { ok: true, s: (answeredAt - abstainedAt) / 1000, steps };
}

// One events row per run, numbers only: EventsRow's payload type refuses anything else before it is written.
async function record(
  service: SupabaseClient,
  n: number,
  outcome: Outcome,
): Promise<number | string> {
  const payload = EventsRow.shape.payload.parse({
    run: n,
    ok: outcome.ok ? 1 : 0,
    ...(outcome.ok && { s: Math.round(outcome.s * 100) / 100 }),
    ...Object.fromEntries(
      Object.entries(outcome.steps).map(([step, ms]) => [step, Math.round(ms)]),
    ),
  });
  const { data, error } = await service
    .from("events")
    .insert({ kind: "loop", payload })
    .select("id")
    .single();
  return error || !data ? `record the timing: ${error?.code}` : data.id;
}

// The notes this run published. Only when the publish answered no ids (a request that failed after the insert) does
// it look for them: a25's live notes at the seat with the drafted titles, written from the publish on.
async function runNotes(
  world: World,
  run: Run,
): Promise<{ ids: string[] } | { problem: string }> {
  if (run.noteIds.length > 0 || !run.publishedSince || run.titles.length === 0)
    return { ids: run.noteIds };
  const found = await world.service
    .from("notes")
    .select("id")
    .eq("seat_id", world.seat.id)
    .eq("author_user_id", world.publisher.userId)
    .eq("source", "live")
    .in("title", run.titles)
    .gte("created_at", run.publishedSince);
  if (found.error)
    return { problem: `find the run's notes: ${found.error.code}` };
  return { ids: (found.data ?? []).map((row) => row.id) };
}

// Removes what one run created, as scripts/check-publish.ts does: a26's q04 questions at the seat since the run
// started (their answers rows go with them), the demand prompts those questions started (their routes go with them),
// and the notes a25 published. Answers what went wrong, or undefined.
async function cleanUp(world: World, run: Run): Promise<string | undefined> {
  const { service } = world;
  const notes = await runNotes(world, run);
  if ("problem" in notes) return notes.problem;
  const asked = await service
    .from("questions")
    .select("id")
    .eq("asker_user_id", world.asker.userId)
    .eq("seat_id", world.seat.id)
    .eq("text", world.question)
    .gte("created_at", run.since);
  if (asked.error) return `find the run's questions: ${asked.error.code}`;
  const questionIds = (asked.data ?? []).map((row) => row.id);
  if (questionIds.length > 0) {
    // Before the questions go: deleting one sets its prompts' source_question_id to null.
    const started = await service
      .from("prompts")
      .select("id")
      .in("source_question_id", questionIds);
    if (started.error) return `find the run's prompts: ${started.error.code}`;
    const promptIds = (started.data ?? []).map((row) => row.id);
    if (promptIds.length > 0) {
      const { error } = await service
        .from("prompts")
        .delete()
        .in("id", promptIds);
      if (error) return `delete prompts: ${error.code}`;
    }
    const { error } = await service
      .from("questions")
      .delete()
      .in("id", questionIds);
    if (error) return `delete questions: ${error.code}`;
  }
  if (notes.ids.length > 0) {
    const { error } = await service.from("notes").delete().in("id", notes.ids);
    if (error) return `delete notes: ${error.code}`;
  }
  return undefined;
}

// pnpm demo:reset, as the team runs it; its output is counts only. Answers its exit code.
function demoReset(): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["demo:reset"], { stdio: "inherit" });
    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main(): Promise<void> {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const password = env("DEMO_PASSWORD");
  const service = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const q04 = (await readQuestions()).find((row) => row.id === "q04");
  if (!q04) throw new Error("seed/questions.csv has no q04");
  const answer = (
    await readFile(new URL("../seed/live-answer.txt", import.meta.url), "utf8")
  ).trim();
  const seat = await service
    .from("seats")
    .select("id, slug")
    .eq("slug", q04.seat_slug)
    .single();
  if (seat.error) throw new Error(`read the seat: ${seat.error.code}`);

  const asker = await signIn(url, anonKey, q04.persona, password);
  const publisher = await signIn(url, anonKey, PUBLISHER, password);
  const world: World = {
    service,
    seat: seat.data,
    question: q04.question,
    answer,
    asker,
    publisher,
  };

  // Nothing is written unless a25's inbox is empty, as the seed leaves it: otherwise someone may be rehearsing (the
  // reset would wipe it), and q04 would join their open prompt instead of starting one.
  const waiting = await inboxItems(publisher, seat.data.slug);
  if (waiting > 0) {
    throw new Error(
      `a25's inbox holds ${waiting} question(s): someone may be rehearsing. If not, run pnpm demo:reset first`,
    );
  }

  const outcomes: Outcome[] = [];
  const recorded: number[] = [];
  let stopped: string | undefined;
  try {
    // The phones stay open through all the runs, as on stage; each run matches its own question and prompt.
    await Promise.all([
      listen(publisher, "prompt_routes"),
      listen(asker, "answers"),
    ]);
    console.log(
      `✓ a25's inbox is empty, and both phones listen by Realtime (${RUNS} runs to go)\n`,
    );

    for (let n = 1; n <= RUNS; n++) {
      if (stopping) {
        stopped = `stopped by a signal after ${n - 1} run(s)`;
        break;
      }
      // A minute of slack, in case this laptop's clock is ahead of the database's.
      const run: Run = {
        since: new Date(Date.now() - 60_000).toISOString(),
        titles: [],
        noteIds: [],
      };
      let outcome: Outcome;
      try {
        outcome = await runOnce(world, run);
      } catch (error) {
        outcome = {
          ok: false,
          problem: error instanceof Error ? error.message : String(error),
          steps: {},
        };
      }
      const id = await record(service, n, outcome);
      if (typeof id === "number") recorded.push(id);
      else if (outcome.ok) outcome = { ok: false, problem: id, steps: {} };
      outcomes.push(outcome);
      const { routeMs, inboxMs, draftMs, answerMs } = outcome.steps;
      console.log(
        outcome.ok
          ? `✓ run ${n}: ${outcome.s.toFixed(1)} s (route ${seconds(routeMs ?? 0)}, inbox ${seconds(inboxMs ?? 0)}, draft ${seconds(draftMs ?? 0)}, 公開 → answer ${seconds(answerMs ?? 0)})`
          : `✗ run ${n}: ${outcome.problem}`,
      );
      // The next run must start from the seed state: if this run's rows can't be removed, stop here.
      const problem = await cleanUp(world, run);
      if (problem) {
        stopped = `run ${n}'s cleanup failed (${problem})`;
        break;
      }
    }
  } catch (error) {
    // Still reset below: a run may have written something before the error.
    stopped = error instanceof Error ? error.message : String(error);
  } finally {
    for (const phone of [asker, publisher]) {
      await phone.db.removeAllChannels();
      phone.db.realtime.disconnect();
    }
  }

  const times = outcomes.flatMap((outcome) => (outcome.ok ? [outcome.s] : []));
  const allPassed = !stopped && times.length === RUNS;
  console.log(
    `\n${allPassed ? "✓" : "✗"} ${times.length}/${RUNS} runs passed${stopped ? `, then stopped: ${stopped}` : ""}; ${recorded.length} events row(s) of kind loop`,
  );
  // No run passed, no median: a missing number is honest, a 0 is not.
  if (times.length > 0) {
    const loop: NonNullable<Metrics["loop"]> = {
      runs: outcomes.length,
      failures: outcomes.length - times.length,
      medianS: Math.round(median(times) * 10) / 10,
    };
    const slowest = Math.max(...times);
    console.log(
      `  median ${loop.medianS.toFixed(1)} s from 「誰も知りません」 to the signed answer (min ${Math.min(...times).toFixed(1)}, max ${slowest.toFixed(1)})`,
    );
    console.log(
      slowest < STAGE_S
        ? `  leaves ${Math.floor(STAGE_S - slowest)} s of the ${STAGE_S} s on stage for a25 to speak, even in the slowest run`
        : `  the slowest run alone takes longer than the ${STAGE_S} s on stage`,
    );
    reportMetrics({ loop }); // the line `pnpm metrics` reads
  }
  console.log();

  // The demo goes back to the seed state, and the inbox is empty again (SPEC F3). The reset recreates the demo users,
  // so a25 signs in again.
  const code = await demoReset();
  const reset = code === 0;
  let emptyInbox = false;
  let kept = 0;
  if (reset) {
    const again = await signIn(url, anonKey, PUBLISHER, password);
    emptyInbox = (await inboxItems(again, q04.seat_slug)) === 0;
    if (recorded.length > 0) {
      const rows = await service
        .from("events")
        .select("id", { count: "exact", head: true })
        .in("id", recorded);
      kept = rows.count ?? 0;
    }
  }
  console.log(
    reset
      ? `\n${emptyInbox ? "✓" : "✗"} pnpm demo:reset: a25's inbox is ${emptyInbox ? "empty" : "not empty"}, ${kept}/${recorded.length} loop row(s) kept in events`
      : `\n✗ pnpm demo:reset exited with ${code}: the demo data may not be as it was`,
  );
  process.exitCode =
    allPassed && reset && emptyInbox && kept === recorded.length ? 0 : 1;
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
