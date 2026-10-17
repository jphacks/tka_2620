// #10 acceptance check (docs/SPEC.md → F3): publishing answers the newcomer. a26 asks q04, which nobody can answer, so
// it waits on a demand prompt routed to a25; a25 publishes the live card for that prompt, and a26's phone gets the
// answer by Realtime, signed 「2025年度 会計」, every sentence citing the new note. Nobody else gets an answers row,
// though each listens to every one it may read (no filter: RLS alone decides). Also the refusals, the stored note and
// the retired prompt.
// Runs against the seeded database and a running dev server, with Ollama (the search and the note's embedding) and the
// Claude key (the answer, one Sonnet call):
//   pnpm dev          (in another terminal)
//   pnpm test:publish
// The reads that must see past a persona's own rows use the service-role key, which only scripts/ may hold.
// Everything this check creates is removed afterwards, and it says the demo data is back only when it is.
// Don't run it during a rehearsal: it puts a slip in a25's inbox and answers a26's q04, and its cleanup removes a26's
// q04 questions and a25's live notes from the last minutes.
// Counts, ids, personas and timings only: never the question, note or answer text, never an email.
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
  InboxResponse,
  LiveAnswer,
  type PublishCard,
  PublishResponse,
} from "@/lib/contracts";
import { mockLiveCard } from "@/lib/mocks";

type QuestionRow = {
  id: string;
  persona: string;
  seat_slug: string;
  question: string;
};

const BASE_URL = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const SUBSCRIBE_MS = 20_000; // longer than the server's postgres_changes wait (15 s)
const ANSWER_MS = 30_000; // publishing embeds the note and asks Sonnet before the answer goes out
const GRACE_MS = 3_000; // how long the others' phones stay quiet before "nothing" counts

// scripts/seed.ts gives every persona one account at <key>@example.com; seed/questions.csv and lib/mocks.ts call
// the same five personas by alias.
const EMAIL: Record<string, string> = {
  a24: "smash-kaikei-2024",
  a25: "smash-kaikei-2025",
  a26: "smash-kaikei-2026",
  b: "keion-member",
  x: "yamate-outsider",
};
const PUBLISHER = "a25"; // the seat's reachable 2025 treasurer
const OTHERS = ["a24", "b", "x"]; // an earlier-term holder, another club's member, an outsider
const BYLINE = "2025年度 会計"; // a25's term at 会計, worded by the club_role label pack
const TERM = "2025";
// What a25 says in the live loop, drafted (lib/mocks.ts, from seed/live-answer.txt), for the newcomers after them.
const CARD: PublishCard = { ...mockLiveCard, scope: "successor" };

function email(persona: string): string {
  const key = EMAIL[persona];
  if (!key) throw new Error(`unknown persona ${persona}: add it to EMAIL`);
  return `${key}@example.com`;
}

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
    await pause(100);
  }
  return condition();
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

// An answers row as one phone received it. errors holds Realtime's own, such as "Error 401: Unauthorized".
type Received = {
  at: number;
  event: string;
  row: Record<string, unknown>;
  errors: string[];
};
type Phone = {
  persona: string;
  db: SupabaseClient;
  token: string;
  userId: string;
  answers: Received[];
};

// What a phone heard, for a failed check: event and Realtime's errors, never a value.
function heard(phone: Phone): string {
  const lines = phone.answers.map(
    (received) =>
      `answers ${received.event}${received.errors.length > 0 ? ` (${received.errors.join("; ")})` : ""}`,
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
    answers: [],
  };
}

// Listens to every answers row this phone may read, with its own token (none when signed out) and no filter. The
// join waits for the server to confirm the postgres_changes subscription, and this waits for the replication-ready
// system event as well, so a phone that hears nothing was really listening (as in scripts/check-inbox.ts).
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
    phone.db
      .channel(`check-publish-${phone.persona}`, {
        config: {
          broadcast: { replication_ready: true },
          postgres_changes_options: { wait: true },
        },
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "answers" },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
          phone.answers.push({
            at: performance.now(),
            event: payload.eventType,
            row: payload.new as Record<string, unknown>,
            errors: payload.errors ?? [],
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
  });
  return {
    status: response.status,
    body: await response.json().catch(() => undefined),
  };
}

type Run = {
  seatId: string;
  askerId: string;
  publisherId: string;
  text: string;
  noteIds: string[];
  since: string;
};

// a25's live notes at the seat since the run started: the ones it published, and any from a request that failed after
// the insert.
async function runNotes(service: SupabaseClient, run: Run) {
  return service
    .from("notes")
    .select("id")
    .eq("seat_id", run.seatId)
    .eq("author_user_id", run.publisherId)
    .eq("source", "live")
    .gte("created_at", run.since);
}

// Removes what this run created: a26's q04 questions at the seat since it started (their answers rows go with them),
// the demand prompts those questions started (their routes go with them; never a prompt a question only joined), and
// a25's live notes from the run. Answers what went wrong, or undefined.
async function cleanUp(
  service: SupabaseClient,
  run: Run,
): Promise<string | undefined> {
  const notes = await runNotes(service, run);
  if (notes.error) return `find the run's notes: ${notes.error.code}`;
  const noteIds = [
    ...new Set([...run.noteIds, ...(notes.data ?? []).map((row) => row.id)]),
  ];
  const asked = await service
    .from("questions")
    .select("id")
    .eq("asker_user_id", run.askerId)
    .eq("seat_id", run.seatId)
    .eq("text", run.text)
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
  if (noteIds.length > 0) {
    const { error } = await service.from("notes").delete().in("id", noteIds);
    if (error) return `delete notes: ${error.code}`;
  }
  return undefined;
}

async function main(): Promise<void> {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const password = env("DEMO_PASSWORD");
  const service = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const question = (await readQuestions()).find((row) => row.id === "q04");
  if (!question) throw new Error("seed/questions.csv has no q04");
  const seat = await service
    .from("seats")
    .select("id")
    .eq("slug", question.seat_slug)
    .single();
  if (seat.error) throw new Error(`read the seat: ${seat.error.code}`);

  // A minute of slack, in case this laptop's clock is ahead of the database's.
  const since = new Date(Date.now() - 60_000).toISOString();
  const asker = await signIn(url, anonKey, question.persona, password);
  const publisher = await signIn(url, anonKey, PUBLISHER, password);
  const others = await Promise.all(
    OTHERS.map((persona) => signIn(url, anonKey, persona, password)),
  );
  // The public key and no sign-in, as any web page could do.
  const signedOut: Phone = {
    persona: "a signed-out client",
    db: createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    token: "",
    userId: "",
    answers: [],
  };
  const bystanders = [publisher, ...others, signedOut]; // everyone but the asker: no answers row, ever
  const phones = [asker, ...bystanders];
  const run: Run = {
    seatId: seat.data.id,
    askerId: asker.userId,
    publisherId: publisher.userId,
    text: question.question,
    noteIds: [],
    since,
  };
  let listening = false;
  let finished = false; // every step ran: an early stop or a thrown error never reads as "all passed"

  try {
    // 1. Every phone listens; Realtime confirms each subscription.
    await Promise.all(phones.map((phone) => listen(phone)));
    listening = true;
    check(
      `${phones.length - 1} phones and a signed-out client listen to answers by Realtime`,
      true,
      "each subscription confirmed and replicating",
    );

    // 2. The newcomer asks q04 (POST /api/ask): no note answers it, so it waits on a prompt routed to a25.
    const asked = await call("/api/ask", {
      token: asker.token,
      body: { seat: question.seat_slug, question: question.question },
    });
    const result = AskResult.safeParse(asked.body);
    const abstained =
      result.success && result.data.status === "abstained"
        ? result.data
        : undefined;
    const promptId = abstained?.promptId;
    check(
      "a26 asks q04 and it waits on a prompt routed to a25",
      asked.status === 200 && abstained?.routedTo === 1 && Boolean(promptId),
      `HTTP ${asked.status}${abstained ? `, routedTo ${abstained.routedTo}` : ""}`,
    );
    if (!abstained || !promptId) return;
    const publish = (cards: PublishCard[]) => ({
      seat: question.seat_slug,
      promptId,
      cards,
    });

    // 3. Refusals, before anything is written: none of them leaves a note.
    const refusals = [
      [
        "signed out",
        await call("/api/handover/publish", { body: publish([CARD]) }),
        401,
      ],
      [
        "b, who holds no seat there",
        await call("/api/handover/publish", {
          token: others[1].token,
          body: publish([CARD]),
        }),
        403,
      ],
      [
        "a24, who holds the seat but wasn't routed the question",
        await call("/api/handover/publish", {
          token: others[0].token,
          body: publish([CARD]),
        }),
        404,
      ],
      [
        "a card with a phone number in it",
        await call("/api/handover/publish", {
          token: publisher.token,
          body: publish([
            { ...CARD, body: "学生課（03-1234-5678）に電話する。" },
          ]),
        }),
        422,
      ],
    ] as const;
    for (const [what, response, status] of refusals) {
      check(
        `publishing refuses ${what}`,
        response.status === status,
        `HTTP ${response.status}`,
      );
    }
    const early = await service
      .from("notes")
      .select("id", { count: "exact", head: true })
      .eq("seat_id", run.seatId)
      .gte("created_at", since);
    check(
      "no refusal wrote a note",
      !early.error && early.count === 0,
      early.error
        ? `query failed: ${early.error.code}`
        : `${early.count} note(s)`,
    );

    // 4. a25 publishes the card for the prompt: the note is saved and a26's question answered again.
    const publishedAt = performance.now();
    const published = await call("/api/handover/publish", {
      token: publisher.token,
      body: publish([CARD]),
    });
    const response = PublishResponse.safeParse(published.body);
    if (response.success) run.noteIds.push(...response.data.noteIds);
    const noteId = response.success ? response.data.noteIds[0] : undefined;
    check(
      "a25 publishes the card, and a26's question is answered again",
      published.status === 200 &&
        response.success &&
        response.data.noteIds.length === 1 &&
        response.data.reanswered.length === 1 &&
        response.data.reanswered[0] === abstained.questionId,
      `HTTP ${published.status}${response.success ? `, ${response.data.noteIds.length} note(s), ${response.data.reanswered.length} answered` : ""}`,
    );
    if (!noteId) return;

    // 5. a26's phone gets the signed answer by Realtime, every sentence citing the new note.
    const isAnswer = (received: Received) =>
      received.row.question_id === abstained.questionId;
    const arrived = await waitFor(
      () => asker.answers.some(isAnswer),
      ANSWER_MS,
    );
    const received = asker.answers.find(isAnswer);
    check(
      "a26's phone gets the answer by Realtime",
      arrived,
      received
        ? `${Math.round(received.at - publishedAt)} ms after a25 pressed 公開`
        : `nothing matching within ${ANSWER_MS} ms; heard: ${heard(asker)}`,
    );
    const row = AnswersRow.safeParse(received?.row);
    const live = LiveAnswer.safeParse(
      row.success ? row.data.payload : undefined,
    );
    check(
      `signed 「${BYLINE}」, in a26's language`,
      live.success &&
        live.data.live.byline === BYLINE &&
        live.data.language === "ja",
      live.success
        ? `live.byline ${live.data.live.byline}`
        : "not a live answer",
    );
    const citations = live.success
      ? live.data.sentences.flatMap((sentence) => sentence.citations)
      : [];
    check(
      "every sentence cites the new note, with its byline and term",
      live.success &&
        live.data.sentences.every((sentence) =>
          sentence.citations.some((citation) => citation.noteId === noteId),
        ) &&
        citations.every(
          (citation) =>
            citation.noteId === noteId &&
            citation.byline === BYLINE &&
            citation.termLabel === TERM,
        ),
      live.success ? `${live.data.sentences.length} sentence(s)` : "",
    );

    // 6. The database agrees: the question is answered, the prompt retired, the note stored as published.
    const saved = await service
      .from("questions")
      .select("status")
      .eq("id", abstained.questionId)
      .single();
    check("a26's question is answered", saved.data?.status === "answered");
    const prompt = await service
      .from("prompts")
      .select("retired")
      .eq("id", promptId)
      .single();
    check("the prompt is retired", prompt.data?.retired === true);
    const note = await service
      .from("notes")
      .select("author_user_id, byline, term_order, kind, scope, source, status")
      .eq("id", noteId)
      .not("embedding", "is", null)
      .maybeSingle();
    check(
      "the note is a25's, signed with its term, live, for its successors, with an embedding",
      note.data?.author_user_id === publisher.userId &&
        note.data.byline === BYLINE &&
        note.data.term_order === Number(TERM) &&
        note.data.kind === CARD.kind &&
        note.data.scope === "successor" &&
        note.data.source === "live" &&
        note.data.status === "live",
      note.error
        ? `query failed: ${note.error.code}`
        : note.data
          ? ""
          : "no such note with an embedding",
    );
    const inbox = InboxResponse.safeParse(
      (
        await call(`/api/inbox?seat=${question.seat_slug}`, {
          token: publisher.token,
        })
      ).body,
    );
    check(
      "the question is gone from a25's inbox",
      inbox.success &&
        !inbox.data.items.some((item) => item.promptId === promptId),
    );

    // 7. Nobody but the asker gets the answer.
    await pause(GRACE_MS);
    for (const phone of bystanders) {
      check(
        `${phone.persona}'s phone gets no answers row`,
        phone.answers.length === 0,
        phone.answers.length > 0 ? `heard: ${heard(phone)}` : "0 answers rows",
      );
    }
    finished = true;
  } finally {
    // 8. Leave the demo database as it was, with every phone still listening: deletes are never published (0005), so
    //    the cleanup must reach nobody.
    const problem = await cleanUp(service, run);
    if (listening) {
      await pause(GRACE_MS);
      for (const phone of bystanders) {
        check(
          `${phone.persona} got nothing in the whole run`,
          phone.answers.length === 0,
          phone.answers.length > 0 ? `heard: ${heard(phone)}` : "0 rows",
        );
      }
      const deletes = phones
        .flatMap((phone) => phone.answers)
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
        ? `\n✗ #10 check: ${checks} checks, ${outcome}, but the cleanup failed (${problem}): the demo data may not be as it was`
        : `\n${passed ? "✓" : "✗"} #10 check: ${checks} checks, ${outcome} (the demo data is back as it was)`,
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
