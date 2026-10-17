// #26 acceptance check (docs/SPEC.md → F4): withdrawing a note removes it from every answer, by Realtime, timed. a25
// publishes a throwaway note; a26 has two saved answers citing it (one also cites the 2024 deadline note, one cites only
// the throwaway); a25 withdraws it through POST /api/notes/[id]/withdraw. Then:
//   - a26's phone gets both answers again: the first without the note (the 2024 sentence stays), the second the blank
//     line, routed nowhere; both are AskResults
//   - a26 gets no notes row for the note it can no longer read (issue #26: does Realtime reach a pane that can no
//     longer see the note?), a25 (the author) gets its status change, x and a signed-out client get no answers or notes
//   - every signed-in phone gets the one events row (numbers only); the signed-out client gets nothing and no error
//   - the time from the request to a26's last answers row, which is what the console's meter shows
// Also the refusals (signed out, someone else's note, a note that doesn't exist) and GET /api/me/notes.
// Runs against the seeded database with 0006_withdraw applied and a running dev server; no Ollama, no Claude key:
//   pnpm dev          (in another terminal)
//   pnpm test:withdraw
// The cleanup uses the service-role key, which only scripts/ may hold, and removes exactly what this run created (its
// note, a26's two questions with their answers, the run's events row). It never touches the demo's own notes, so it is
// safe next to a rehearsal, though a25's 自分のメモ shows the throwaway note while it runs.
// Counts, ids, personas and timings only: never note, question or answer text, never an email.
import {
  createClient,
  type RealtimePostgresChangesPayload,
  type SupabaseClient,
} from "@supabase/supabase-js";
import {
  AskResult,
  EventsRow,
  MyNotesResponse,
  NotesRow,
  WithdrawResponse,
} from "@/lib/contracts";

const BASE_URL = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const SUBSCRIBE_MS = 20_000; // longer than the server's postgres_changes wait (15 s)
const ARRIVE_MS = 10_000; // the withdrawal is one function call; SPEC F4 wants it gone in under a second
const GRACE_MS = 3_000; // how long the other phones stay quiet before "nothing" counts

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
  });
  return {
    status: response.status,
    body: await response.json().catch(() => undefined),
  };
}

type Run = { noteId?: string; questionIds: string[]; eventIds: number[] };

// Removes exactly what this run created. Deletes are never published (0005), so this reaches no phone. Answers what
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
  if (run.eventIds.length > 0) {
    const { error } = await service
      .from("events")
      .delete()
      .in("id", run.eventIds);
    if (error) return `delete the events row: ${error.code}`;
  }
  return undefined;
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
  const run: Run = { questionIds: [], eventIds: [] };
  let listening = false;
  let finished = false; // every step ran: an early stop or a thrown error never reads as "all passed"

  try {
    // 1. a25 publishes a throwaway note, for the newcomers after them (as the live loop's card would be).
    const note = await author.db
      .from("notes")
      .insert({
        seat_id: seat.data.id,
        term_order: TERM,
        author_user_id: author.userId,
        byline: BYLINE,
        kind: "rule_of_thumb",
        title: "撤回チェック用のメモ",
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

    // 2. a26 has two saved answers citing it: one also cites the 2024 note, one cites only the throwaway note.
    for (const citations of [
      [[throwaway], [KEPT_CITATION], [throwaway, KEPT_CITATION]],
      [[throwaway]],
    ]) {
      const question = await asker.db
        .from("questions")
        .insert({
          asker_user_id: asker.userId,
          seat_id: seat.data.id,
          text: "撤回チェック",
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

    // 3. Every phone listens; Realtime confirms each subscription.
    await Promise.all(phones.map((phone) => listen(phone)));
    listening = true;
    check(
      "a25, a26, x and a signed-out client listen to answers, notes and events",
      true,
      "each subscription confirmed and replicating",
    );

    // 4. Refusals, before the withdrawal: none of them changes the note.
    const path = `/api/notes/${encodeURIComponent(run.noteId)}/withdraw`;
    const refusals = [
      ["signed out", await call(path, { post: true }), 401],
      [
        "a26, who didn't write it",
        await call(path, { post: true, token: asker.token }),
        403,
      ],
      [
        "a note that doesn't exist, the same way",
        await call("/api/notes/no-such-note/withdraw", {
          post: true,
          token: author.token,
        }),
        403,
      ],
    ] as const;
    for (const [what, response, status] of refusals) {
      check(
        `withdrawing refuses ${what}`,
        response.status === status,
        `HTTP ${response.status}`,
      );
    }
    const still = await service
      .from("notes")
      .select("status")
      .eq("id", run.noteId)
      .single();
    check(
      "the note is still live after the refusals",
      still.data?.status === "live",
    );

    // 5. a25 withdraws it, timed from the request.
    const started = performance.now();
    const withdrawn = await call(path, { post: true, token: author.token });
    const replied = performance.now();
    const parsed = WithdrawResponse.safeParse(withdrawn.body);
    check(
      "a25 withdraws the note",
      withdrawn.status === 200 && parsed.success,
      withdrawn.status === 503
        ? "HTTP 503: is supabase/migrations/0006_withdraw.sql applied?"
        : `HTTP ${withdrawn.status}`,
    );
    if (!parsed.success) return;

    // 6. a26's phone gets both answers again.
    const answersFor = (questionId: string) =>
      from(asker, "answers").filter(
        (received) => received.row.question_id === questionId,
      );
    const arrived = await waitFor(
      () => answersFor(mixed).length > 0 && answersFor(only).length > 0,
      ARRIVE_MS,
    );
    const last = Math.max(
      ...[mixed, only].flatMap((id) => answersFor(id).map((r) => r.at)),
    );
    check(
      "a26's phone gets both answers again",
      arrived,
      arrived
        ? `${Math.round(last - started)} ms from the request (${Math.round(replied - started)} ms to the reply)`
        : `heard: ${heard(asker)}`,
    );
    const payload = (questionId: string) =>
      AskResult.safeParse(answersFor(questionId).at(-1)?.row.payload);
    const kept = payload(mixed);
    const cited = (result: typeof kept) =>
      result.success && result.data.status === "answered"
        ? result.data.sentences.flatMap((s) => s.citations.map((c) => c.noteId))
        : [];
    check(
      "the first keeps its 2024 sentence and cites the withdrawn note nowhere",
      kept.success &&
        kept.data.status === "answered" &&
        kept.data.sentences.length === 1 &&
        cited(kept).includes(KEPT_NOTE) &&
        !cited(kept).includes(run.noteId),
      kept.success ? kept.data.status : "not an AskResult",
    );
    const blank = payload(only);
    check(
      "the second is the blank line again, routed nowhere",
      blank.success &&
        blank.data.status === "abstained" &&
        blank.data.questionId === only &&
        blank.data.routedTo === 0,
      blank.success ? blank.data.status : "not an AskResult",
    );

    // 7. Who hears what (issue #26): the author gets the status change; a26 can no longer read the note, so gets
    //    nothing for it; x and the signed-out client get no answers and no notes.
    const statusChange = await waitFor(
      () => from(author, "notes").some((r) => r.row.id === run.noteId),
      ARRIVE_MS,
    );
    const authorRow = NotesRow.safeParse(
      from(author, "notes").find((r) => r.row.id === run.noteId)?.row,
    );
    check(
      "a25, the author, gets the note's status change",
      statusChange &&
        authorRow.success &&
        authorRow.data.status === "withdrawn",
      statusChange ? "" : `heard: ${heard(author, ["notes"])}`,
    );
    const eventsArrived = await waitFor(
      () =>
        [author, asker, outsider].every((p) => from(p, "events").length > 0),
      ARRIVE_MS,
    );
    const outsiderEvents = from(outsider, "events").map((r) =>
      EventsRow.safeParse(r.row),
    );
    run.eventIds = outsiderEvents.flatMap((r) =>
      r.success ? [r.data.id] : [],
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
      "a26 gets nothing for the note it can no longer read",
      from(asker, "notes").length === 0,
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
        from(phone, "answers").length === 0 &&
          from(phone, "notes").length === 0,
        `heard: ${heard(phone, ["answers", "notes"])}`,
      );
    }
    check(
      "the signed-out client gets nothing at all, not even an error",
      signedOut.received.length === 0,
      `heard: ${heard(signedOut)}`,
    );

    // 8. a25's 自分のメモ lists it as withdrawn, with its seat.
    const mine = await call("/api/me/notes", { token: author.token });
    const notes = MyNotesResponse.safeParse(mine.body);
    const listed = notes.success
      ? notes.data.notes.find((n) => n.id === run.noteId)
      : undefined;
    check(
      "GET /api/me/notes shows a25 the note as withdrawn, at its seat",
      mine.status === 200 &&
        listed?.status === "withdrawn" &&
        listed.seat === SEAT,
      `HTTP ${mine.status}`,
    );
    finished = true;
  } finally {
    const problem = await cleanUp(service, run);
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
        ? `\n✗ #26 check: ${checks} checks, ${outcome}, but the cleanup failed (${problem}): remove the run's note and questions by hand`
        : `\n${passed ? "✓" : "✗"} #26 check: ${checks} checks, ${outcome} (everything the run created is gone)`,
    );
    process.exitCode = passed ? 0 : 1;
  }
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
