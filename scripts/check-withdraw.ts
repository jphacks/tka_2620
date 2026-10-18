// #26 and #29 acceptance checks (docs/SPEC.md → F4): withdrawing a note removes it from every answer, by Realtime,
// timed, ten times. Each run, a25 publishes a throwaway note; a26 has two saved answers citing it (one also cites the
// 2024 deadline note, one cites only the throwaway); a25 withdraws it through POST /api/notes/[id]/withdraw. Then:
//   - a26's phone gets both answers again: the first without the note (the 2024 sentence stays), the second the blank
//     line, routed nowhere; both are AskResults
//   - a26 gets no status change for the note it can no longer read (issue #26: does Realtime reach a pane that can no
//     longer see the note?), a25 (the author) gets it, x and a signed-out client get no answers or notes
//   - every signed-in phone gets the one events row (numbers only); the signed-out client gets nothing and no error
//   - the seconds from the click to the note being absent in every pane, as the console's meter counts them: a25's
//     pane drops it when the API answers, a26's when both answers have come back without it
// The first run also checks the refusals (signed out, someone else's note, a note that doesn't exist), who hears what
// and GET /api/me/notes. After ten runs it prints the median and the slowest, the numbers `pnpm metrics` writes to
// metrics/latest.json (#29); SPEC F4 wants the median under a second.
// Runs against the seeded database with 0006_withdraw applied and a running dev server; no Ollama, no Claude key:
//   pnpm dev          (in another terminal)
//   pnpm test:withdraw            (pnpm metrics runs it too)
// The cleanup uses the service-role key, which only scripts/ may hold, and removes exactly what each run created (its
// note, a26's two questions with their answers, the run's events row) before the next run starts. It never touches the
// demo's own notes, so it is safe next to a rehearsal, though a25's 自分のメモ shows a throwaway note while it runs and
// the console's meter moves once per run. Ctrl-C stops it after the run in flight, cleanup included; a run killed
// harder leaves its note and questions, which the next run sweeps away first (by the texts only this check writes).
// Counts, ids, personas and timings only: never note, question or answer text, never an email.
import {
  createClient,
  type RealtimePostgresChangesPayload,
  type SupabaseClient,
} from "@supabase/supabase-js";
import {
  AskResult,
  EventsRow,
  type Metrics,
  MyNotesResponse,
  NotesRow,
  WithdrawResponse,
} from "@/lib/contracts";
import { reportMetrics } from "@/scripts/metrics-line";

const BASE_URL = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const SUBSCRIBE_MS = 20_000; // longer than the server's postgres_changes wait (15 s)
const ARRIVE_MS = 10_000; // the withdrawal is one function call; SPEC F4 wants it gone in under a second
const GRACE_MS = 3_000; // how long the other phones stay quiet before "nothing" counts
const RUNS = 10; // SPEC F4: the median over 10 runs
const MEDIAN_LIMIT_S = 1; // SPEC F4: under a second
const REQUEST_MS = 60_000; // one request: a hung server stops the check instead of blocking pnpm metrics
// The texts only this check writes: an interrupted run's leftovers are found by them (sweep below).
const NOTE_TITLE = "撤回チェック用のメモ";
const QUESTION_TEXT = "撤回チェック";

// Ctrl-C (or pnpm metrics stopping) ends the check after the run in flight, and the cleanup still runs.
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopping = true;
  });
}

// scripts/seed.ts gives every persona one account at <key>@example.com.
const EMAIL: Record<string, string> = {
  a25: "smash-kaikei-2025",
  a26: "smash-kaikei-2026",
  x: "yamate-outsider",
};
const SEAT = "smash-kaikei";
const BYLINE = "2025年度 会計"; // a25's term at 会計, as the club_role label pack words it
const TERM = 2025;
const KEPT_NOTE = "smash-2024-hokenjo"; // a26 may read it, and it stays live
const KEPT_CITATION = {
  noteId: KEPT_NOTE,
  byline: "2024年度 会計",
  termLabel: "2024",
};
const TABLES = ["answers", "notes", "events"] as const;
type Table = (typeof TABLES)[number];

let checks = 0;
let failed = false;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set in .env.local`);
  return value;
}

function check(what: string, ok: boolean, detail = ""): void {
  checks += 1;
  if (!ok) failed = true;
  console.log(`${ok ? "✓" : "✗"} ${what}${detail ? ` — ${detail}` : ""}`);
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition: () => boolean, ms: number): Promise<boolean> {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    if (condition()) return true;
    await pause(20);
  }
  return condition();
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

// A row as one phone received it. errors holds Realtime's own, such as "Error 401: Unauthorized".
type Received = {
  at: number;
  table: Table;
  event: string;
  row: Record<string, unknown>;
  errors: string[];
};
type Phone = {
  persona: string;
  db: SupabaseClient;
  token: string;
  userId: string;
  received: Received[];
};

const from = (phone: Phone, table: Table) =>
  phone.received.filter((received) => received.table === table);

// What a phone heard, for a failed check: table, event and Realtime's errors, never a value.
function heard(phone: Phone, tables: readonly Table[] = TABLES): string {
  const lines = phone.received
    .filter((received) => tables.includes(received.table))
    .map(
      (received) =>
        `${received.table} ${received.event}${received.errors.length > 0 ? ` (${received.errors.join("; ")})` : ""}`,
    );
  return lines.length > 0 ? lines.join(", ") : "nothing";
}

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
    email: `${EMAIL[persona]}@example.com`,
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
    received: [],
  };
}

// Listens to every answers, notes and events row this phone may read, with its own token (none when signed out) and
// no filter: RLS alone decides. Waits for the subscription and for replication, as scripts/check-publish.ts does, so a
// phone that hears nothing was really listening.
async function listen(phone: Phone): Promise<void> {
  if (phone.token) await phone.db.realtime.setAuth(phone.token);
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
    let channel = phone.db.channel(`check-withdraw-${phone.persona}`, {
      config: {
        broadcast: { replication_ready: true },
        postgres_changes_options: { wait: true },
      },
    });
    for (const table of TABLES) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
          phone.received.push({
            at: performance.now(),
            table,
            event: payload.eventType,
            row: payload.new as Record<string, unknown>,
            errors: payload.errors ?? [],
          }),
      );
    }
    channel
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
  options: { token?: string; post?: boolean } = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.post ? "POST" : "GET",
    headers: options.token ? { authorization: `Bearer ${options.token}` } : {},
    signal: AbortSignal.timeout(REQUEST_MS),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => undefined),
  };
}

// eventsBefore: the newest withdraw row's id just before the withdrawal (0 for none), for finding the run's own row;
// set only once the withdrawal succeeded, so a failed one never removes a row it didn't make.
// cleaned: the run's rows are gone already (each run cleans up before the next one starts).
type Run = {
  noteId?: string;
  questionIds: string[];
  eventsBefore?: number;
  cleaned?: boolean;
};

// Removes exactly what one run created. Deletes are never published (0005), so this reaches no phone. Answers what
// went wrong, or undefined.
async function cleanUp(
  service: SupabaseClient,
  run: Run,
): Promise<string | undefined> {
  if (run.questionIds.length > 0) {
    const { error } = await service
      .from("questions")
      .delete()
      .in("id", run.questionIds); // their answers rows go with them
    if (error) return `delete questions: ${error.code}`;
  }
  if (run.noteId) {
    const { error } = await service.from("notes").delete().eq("id", run.noteId);
    if (error) return `delete the note: ${error.code}`;
  }
  if (run.eventsBefore !== undefined) {
    // The run's row, found in the table rather than in what a phone heard: the withdraw row after the request with this
    // run's counts (two answers, one abstained). Only when exactly one matches, so a rehearsal's own withdrawal with
    // the same counts is never removed by mistake.
    const found = await service
      .from("events")
      .select("id")
      .eq("kind", "withdraw")
      .gt("id", run.eventsBefore)
      .contains("payload", { answers: 2, abstained: 1 });
    if (found.error) return `find the events row: ${found.error.code}`;
    if (found.data.length > 1) {
      return `${found.data.length} withdraw rows could be this run's: left them`;
    }
    const id = found.data[0]?.id;
    if (id !== undefined) {
      const { error } = await service.from("events").delete().eq("id", id);
      if (error) return `delete the events row: ${error.code}`;
    }
  }
  return undefined;
}

// What an interrupted run (killed before its cleanup) left: a25's throwaway notes and a26's check questions, found by
// the texts only this check writes. A rehearsal never makes them. Their withdraw events rows can't be told apart from
// a rehearsal's, so they stay. Answers how many rows went.
async function sweep(world: World): Promise<number> {
  const notes = await world.service
    .from("notes")
    .delete()
    .eq("author_user_id", world.author.userId)
    .eq("title", NOTE_TITLE)
    .select("id");
  const questions = await world.service
    .from("questions")
    .delete()
    .eq("asker_user_id", world.asker.userId)
    .eq("text", QUESTION_TEXT)
    .select("id");
  if (notes.error || questions.error) {
    throw new Error(
      `sweep an earlier run's rows: ${notes.error?.code ?? questions.error?.code}`,
    );
  }
  return notes.data.length + questions.data.length;
}

// a26's saved answer, as POST /api/ask stores one: an AnsweredResult whose sentences cite the given notes.
function answered(questionId: string, citations: object[][]): object {
  return {
    status: "answered",
    questionId,
    sentences: citations.map((cited, i) => ({
      text: `文${i + 1}。`,
      citations: cited,
    })),
    language: "ja",
  };
}

// What every run shares.
type World = {
  service: SupabaseClient;
  seatId: string;
  author: Phone; // a25
  asker: Phone; // a26
};

// One run's throwaway note and a26's two questions: mixed cites the note and the 2024 note, only cites just the note.
type Prepared = { noteId: string; mixed: string; only: string; path: string };

// 1–2. a25 publishes a throwaway note, for the newcomers after them (as the live loop's card would be), and a26 has
// two saved answers citing it. Each id goes into run as soon as it exists, so the cleanup finds it after an error.
async function prepare(world: World, run: Run): Promise<Prepared> {
  const { author, asker } = world;
  const note = await author.db
    .from("notes")
    .insert({
      seat_id: world.seatId,
      term_order: TERM,
      author_user_id: author.userId,
      byline: BYLINE,
      kind: "rule_of_thumb",
      title: NOTE_TITLE,
      body: "撤回チェックのためのメモです。",
      lang: "ja",
      scope: "successor",
      source: "handover",
    })
    .select("id")
    .single();
  if (note.error) throw new Error(`a25 publishes a note: ${note.error.code}`);
  run.noteId = String(note.data.id);
  const throwaway = {
    noteId: run.noteId,
    byline: BYLINE,
    termLabel: String(TERM),
  };

  for (const citations of [
    [[throwaway], [KEPT_CITATION], [throwaway, KEPT_CITATION]],
    [[throwaway]],
  ]) {
    const question = await asker.db
      .from("questions")
      .insert({
        asker_user_id: asker.userId,
        seat_id: world.seatId,
        text: QUESTION_TEXT,
        lang: "ja",
        status: "answered",
      })
      .select("id")
      .single();
    if (question.error) {
      throw new Error(`a26 saves a question: ${question.error.code}`);
    }
    const questionId = String(question.data.id);
    run.questionIds.push(questionId);
    const saved = await asker.db.from("answers").insert({
      question_id: questionId,
      payload: answered(questionId, citations),
    });
    if (saved.error)
      throw new Error(`a26 saves an answer: ${saved.error.code}`);
  }
  const [mixed, only] = run.questionIds;
  return {
    noteId: run.noteId,
    mixed,
    only,
    path: `/api/notes/${encodeURIComponent(run.noteId)}/withdraw`,
  };
}

// a26's answers rows that came back after the click: withdrawing updates each answer that cited the note. The phones
// listen through every run, so the inserts of a26's own saved answers arrive too, earlier, and don't count.
function answersBack(
  asker: Phone,
  questionId: string,
  since: number,
): Received[] {
  return from(asker, "answers").filter(
    (received) =>
      received.event === "UPDATE" &&
      received.at >= since &&
      received.row.question_id === questionId,
  );
}

// 5. a25 withdraws the note, timed from the click until it is absent in every pane: a25's pane drops it when the API
// answers (as the console does), a26's when both its answers have come back by Realtime. Answers the seconds and the
// two answers as a26's phone got them, or what went wrong.
type Timed = {
  s: number;
  replyMs: number;
  kept: ReturnType<typeof AskResult.safeParse>;
  blank: ReturnType<typeof AskResult.safeParse>;
};
async function withdraw(
  world: World,
  run: Run,
  prepared: Prepared,
): Promise<Timed | { problem: string }> {
  const newest = await world.service
    .from("events")
    .select("id")
    .eq("kind", "withdraw")
    .order("id", { ascending: false })
    .limit(1);
  if (newest.error) return { problem: `read the events: ${newest.error.code}` };
  const eventsBefore = Number(newest.data?.[0]?.id ?? 0);

  const started = performance.now();
  const withdrawn = await call(prepared.path, {
    post: true,
    token: world.author.token,
  });
  const replied = performance.now();
  if (
    withdrawn.status !== 200 ||
    !WithdrawResponse.safeParse(withdrawn.body).success
  ) {
    return {
      problem:
        withdrawn.status === 503
          ? "HTTP 503: is supabase/migrations/0006_withdraw.sql applied?"
          : `withdrawing answered HTTP ${withdrawn.status}`,
    };
  }
  run.eventsBefore = eventsBefore; // withdrawn: the run's events row exists, and the cleanup may look for it
  const back = (questionId: string) =>
    answersBack(world.asker, questionId, started);
  const arrived = await waitFor(
    () => back(prepared.mixed).length > 0 && back(prepared.only).length > 0,
    ARRIVE_MS,
  );
  if (!arrived) {
    return {
      problem: `a26's phone didn't get both answers again within ${ARRIVE_MS} ms (heard: ${heard(world.asker)})`,
    };
  }
  const last = Math.max(
    ...[prepared.mixed, prepared.only].flatMap((id) =>
      back(id).map((received) => received.at),
    ),
  );
  return {
    s: (Math.max(last, replied) - started) / 1000,
    replyMs: replied - started,
    kept: AskResult.safeParse(back(prepared.mixed).at(-1)?.row.payload),
    blank: AskResult.safeParse(back(prepared.only).at(-1)?.row.payload),
  };
}

// The first answer keeps its 2024 sentence and cites the withdrawn note nowhere; the second is the blank line again,
// routed nowhere, with its own question id.
function rightAnswers(prepared: Prepared, timed: Timed) {
  const { kept, blank } = timed;
  const cited =
    kept.success && kept.data.status === "answered"
      ? kept.data.sentences.flatMap((s) => s.citations.map((c) => c.noteId))
      : [];
  return {
    kept:
      kept.success &&
      kept.data.status === "answered" &&
      kept.data.sentences.length === 1 &&
      cited.includes(KEPT_NOTE) &&
      !cited.includes(prepared.noteId),
    blank:
      blank.success &&
      blank.data.status === "abstained" &&
      blank.data.questionId === prepared.only &&
      blank.data.routedTo === 0,
  };
}

// 4. The refusals, before the first withdrawal: none of them changes the note.
async function refusals(world: World, prepared: Prepared): Promise<void> {
  const cases = [
    ["signed out", await call(prepared.path, { post: true }), 401],
    [
      "a26, who didn't write it",
      await call(prepared.path, { post: true, token: world.asker.token }),
      403,
    ],
    [
      "a note that doesn't exist, the same way",
      await call("/api/notes/no-such-note/withdraw", {
        post: true,
        token: world.author.token,
      }),
      403,
    ],
  ] as const;
  for (const [what, response, status] of cases) {
    check(
      `withdrawing refuses ${what}`,
      response.status === status,
      `HTTP ${response.status}`,
    );
  }
  const still = await world.service
    .from("notes")
    .select("status")
    .eq("id", prepared.noteId)
    .single();
  check(
    "the note is still live after the refusals",
    still.data?.status === "live",
  );
}

// 7–8. Who hears what (issue #26), after the first withdrawal: the author gets the status change; a26 can no longer
// read the note, so gets no status change for it; x and the signed-out client get no answers and no notes; every
// signed-in phone gets the one events row. Then a25's 自分のメモ lists the note as withdrawn, with its seat.
async function whoHearsWhat(
  world: World,
  prepared: Prepared,
  outsider: Phone,
  signedOut: Phone,
): Promise<void> {
  const { author, asker } = world;
  const statusOf = (phone: Phone) =>
    from(phone, "notes").filter(
      (received) =>
        received.event === "UPDATE" && received.row.id === prepared.noteId,
    );
  const statusChange = await waitFor(
    () => statusOf(author).length > 0,
    ARRIVE_MS,
  );
  const authorRow = NotesRow.safeParse(statusOf(author).at(-1)?.row);
  check(
    "a25, the author, gets the note's status change",
    statusChange && authorRow.success && authorRow.data.status === "withdrawn",
    statusChange ? "" : `heard: ${heard(author, ["notes"])}`,
  );
  const eventsArrived = await waitFor(
    () => [author, asker, outsider].every((p) => from(p, "events").length > 0),
    ARRIVE_MS,
  );
  const outsiderEvents = from(outsider, "events").map((r) =>
    EventsRow.safeParse(r.row),
  );
  check(
    "every signed-in phone gets the one events row, numbers only",
    eventsArrived &&
      outsiderEvents.length === 1 &&
      outsiderEvents[0].success &&
      outsiderEvents[0].data.kind === "withdraw",
    eventsArrived ? "" : `x heard: ${heard(outsider, ["events"])}`,
  );
  await pause(GRACE_MS);
  check(
    "a26 gets no status change for the note it can no longer read",
    statusOf(asker).length === 0,
    `heard: ${heard(asker, ["notes"])}`,
  );
  check(
    "a25 gets no answers row (only askers do)",
    from(author, "answers").length === 0,
    `heard: ${heard(author, ["answers"])}`,
  );
  for (const phone of [outsider, signedOut]) {
    check(
      `${phone.persona} gets no answers and no notes`,
      from(phone, "answers").length === 0 && from(phone, "notes").length === 0,
      `heard: ${heard(phone, ["answers", "notes"])}`,
    );
  }
  check(
    "the signed-out client gets nothing at all, not even an error",
    signedOut.received.length === 0,
    `heard: ${heard(signedOut)}`,
  );

  const mine = await call("/api/me/notes", { token: author.token });
  const notes = MyNotesResponse.safeParse(mine.body);
  const listed = notes.success
    ? notes.data.notes.find((n) => n.id === prepared.noteId)
    : undefined;
  check(
    "GET /api/me/notes shows a25 the note as withdrawn, at its seat",
    mine.status === 200 &&
      listed?.status === "withdrawn" &&
      listed.seat === SEAT,
    `HTTP ${mine.status}`,
  );
}

async function main(): Promise<void> {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const password = env("DEMO_PASSWORD");
  const service = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const seat = await service
    .from("seats")
    .select("id")
    .eq("slug", SEAT)
    .single();
  if (seat.error) throw new Error(`read the seat: ${seat.error.code}`);

  const author = await signIn(url, anonKey, "a25", password);
  const asker = await signIn(url, anonKey, "a26", password);
  const outsider = await signIn(url, anonKey, "x", password);
  const signedOut: Phone = {
    persona: "a signed-out client",
    db: createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    token: "",
    userId: "",
    received: [],
  };
  const phones = [author, asker, outsider, signedOut];
  const world: World = { service, seatId: seat.data.id, author, asker };
  const runs: Run[] = [];
  const seconds: number[] = [];
  let measured: NonNullable<Metrics["withdraw"]> | undefined;
  let listening = false;
  let finished = false; // every step ran: an early stop or a thrown error never reads as "all passed"
  let problem: string | undefined;

  try {
    // An earlier run that was killed before its cleanup leaves its throwaway rows; they go first.
    const swept = await sweep(world);
    if (swept > 0) {
      console.log(
        `✓ removed ${swept} row(s) an interrupted earlier run left behind`,
      );
    }

    // 3. Every phone listens through all the runs; Realtime confirms each subscription.
    await Promise.all(phones.map((phone) => listen(phone)));
    listening = true;
    check(
      "a25, a26, x and a signed-out client listen to answers, notes and events",
      true,
      "each subscription confirmed and replicating",
    );

    for (let n = 1; n <= RUNS; n += 1) {
      if (stopping) {
        check(`stopped after ${n - 1} of ${RUNS} runs`, false);
        break;
      }
      const run: Run = { questionIds: [] };
      runs.push(run);
      const prepared = await prepare(world, run);
      if (n === 1) await refusals(world, prepared);

      const timed = await withdraw(world, run, prepared);
      if ("problem" in timed) {
        check(`run ${n}: a25 withdraws the note`, false, timed.problem);
        break;
      }
      const right = rightAnswers(prepared, timed);
      if (n === 1) {
        check(
          "a25 withdraws the note, and a26's phone gets both answers again",
          true,
          `${timed.s.toFixed(2)} s from the click to absent in every pane (${Math.round(timed.replyMs)} ms to the reply)`,
        );
        check(
          "the first keeps its 2024 sentence and cites the withdrawn note nowhere",
          right.kept,
          timed.kept.success ? timed.kept.data.status : "not an AskResult",
        );
        check(
          "the second is the blank line again, routed nowhere",
          right.blank,
          timed.blank.success ? timed.blank.data.status : "not an AskResult",
        );
        await whoHearsWhat(world, prepared, outsider, signedOut);
      } else {
        check(
          `run ${n}: absent in every pane after ${timed.s.toFixed(2)} s, both answers right`,
          right.kept && right.blank,
          `${Math.round(timed.replyMs)} ms to the reply`,
        );
      }
      // A run whose answers came back wrong measured the wrong thing: no number from it.
      if (!right.kept || !right.blank) break;
      seconds.push(timed.s);

      // The run's rows go before the next run, so the runs never pile up throwaway notes in a25's 自分のメモ.
      const runProblem = await cleanUp(service, run);
      if (runProblem) throw new Error(`run ${n}'s cleanup: ${runProblem}`);
      run.cleaned = true;
    }

    if (seconds.length === RUNS) {
      // Across every run: the panes that can't read the note heard nothing of it.
      check(
        `x and the signed-out client got no answers and no notes in ${RUNS} runs`,
        [outsider, signedOut].every(
          (phone) =>
            from(phone, "answers").length === 0 &&
            from(phone, "notes").length === 0,
        ),
        `x heard: ${heard(outsider, ["answers", "notes"])}`,
      );
      check(
        `a26 got no status change for a note it could no longer read in ${RUNS} runs`,
        !from(asker, "notes").some(
          (received) =>
            received.event === "UPDATE" &&
            runs.some((run) => run.noteId === received.row.id),
        ),
        `heard: ${heard(asker, ["notes"])}`,
      );
      measured = {
        runs: RUNS,
        medianS: round2(median(seconds)),
        maxS: round2(Math.max(...seconds)),
      };
      check(
        `the median is under ${MEDIAN_LIMIT_S} s over ${RUNS} runs (SPEC F4)`,
        measured.medianS < MEDIAN_LIMIT_S,
        `median ${measured.medianS} s, slowest ${measured.maxS} s`,
      );
    }
    finished = true;
  } finally {
    for (const run of runs.filter((run) => !run.cleaned)) {
      problem = (await cleanUp(service, run)) ?? problem;
    }
    if (listening) {
      await pause(GRACE_MS);
      const deletes = phones
        .flatMap((phone) => phone.received)
        .filter((received) => received.event === "DELETE").length;
      check(
        "the cleanup's deletes reach no phone",
        deletes === 0,
        `${deletes} delete row(s)`,
      );
    }
    for (const phone of phones) {
      await phone.db.removeAllChannels();
      phone.db.realtime.disconnect();
    }
    const outcome = !finished
      ? "stopped early"
      : failed
        ? "failed"
        : "all passed";
    const passed = finished && !failed && !problem;
    console.log(
      problem
        ? `\n✗ #26 check: ${checks} checks, ${outcome}, but the cleanup failed (${problem}): remove the runs' notes and questions by hand`
        : `\n${passed ? "✓" : "✗"} #26 check: ${checks} checks, ${outcome} (everything the runs created is gone)`,
    );
    // Ten runs with the right answers are the number, whatever else failed: a slow median is still the median.
    if (measured) reportMetrics({ withdraw: measured });
    process.exitCode = passed ? 0 : 1;
  }
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
