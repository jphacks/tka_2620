// #8 acceptance check (docs/SPEC.md → F3): the predecessor's inbox. When the 2026 treasurer asks q04, the 2025
// treasurer's Realtime subscription gets the route at once, and the asker, the 2024 treasurer, another club's member,
// an outsider and a signed-out client get nothing, though each subscribes to every prompt_routes and answers row it
// may read: no filter, so RLS alone decides. Then GET /api/inbox, POST /api/inbox/seen, an answers row that reaches
// its asker alone, and a cleanup whose deletes reach no phone.
// Runs against the seeded database and a running dev server, with 0005_realtime applied:
//   pnpm dev          (in another terminal)
//   pnpm test:inbox
// The reads that must see past a persona's own rows use the service-role key, which only scripts/ may hold.
// Everything this check creates is removed afterwards, and it says the demo data is back only when it is.
// Don't run it during a rehearsal: it puts a slip in a25's inbox, and its cleanup removes a26's q04 questions from the
// last minutes.
// Counts, ids, personas and timings only: never the question text, never an email.
import { readFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";
import {
  AnswersRow,
  AskResult,
  InboxResponse,
  PromptRoutesRow,
  SeenResponse,
} from "@/lib/contracts";

type QuestionRow = {
  id: string;
  persona: string;
  seat_slug: string;
  question: string;
};

const BASE_URL = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const SUBSCRIBE_MS = 10_000;
const ARRIVE_MS = 10_000; // a new question must reach the phone well inside this
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
const RECIPIENT = "a25"; // the seat's only reachable holder
// An earlier-term holder, another club's member and an outsider; the asker and a signed-out client are checked as well.
const OTHERS = ["a24", "b", "x"];
// a26 holds 会計 for 2026 (scripts/seed.ts), worded by the club_role byline of each label pack.
const ASKED_BY = { ja: "2026年度 会計", en: "2026 会計" };

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

// A Realtime row as one phone received it.
type Received = {
  at: number;
  event: string;
  row: Record<string, unknown>;
};
type Phone = {
  persona: string;
  db: SupabaseClient;
  token: string;
  userId: string;
  routes: Received[];
  answers: Received[];
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
    routes: [],
    answers: [],
  };
}

// Listens to every prompt_routes and answers row this phone may read, with its own token (none when signed out) and no
// filter. Answers "refused" when Realtime turns the subscription down and that's allowed (a signed-out client).
async function listen(
  phone: Phone,
  refusable = false,
): Promise<"listening" | "refused"> {
  if (phone.token) await phone.db.realtime.setAuth(phone.token);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(`${phone.persona}: Realtime didn't subscribe in time`),
        ),
      SUBSCRIBE_MS,
    );
    phone.db
      .channel(`check-inbox-${phone.persona}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "prompt_routes" },
        (payload) =>
          phone.routes.push({
            at: performance.now(),
            event: payload.eventType,
            row: payload.new as Record<string, unknown>,
          }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "answers" },
        (payload) =>
          phone.answers.push({
            at: performance.now(),
            event: payload.eventType,
            row: payload.new as Record<string, unknown>,
          }),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          resolve("listening");
        } else if (status === "CHANNEL_ERROR" && refusable) {
          clearTimeout(timer);
          resolve("refused");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timer);
          reject(new Error(`${phone.persona}: Realtime ${status}`));
        }
      });
  });
}

async function call(
  path: string,
  options: { token?: string; body?: unknown; locale?: string } = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.body === undefined ? "GET" : "POST",
    headers: {
      ...(options.body !== undefined && { "content-type": "application/json" }),
      ...(options.token && { authorization: `Bearer ${options.token}` }),
      ...(options.locale && { cookie: `NEXT_LOCALE=${options.locale}` }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => undefined),
  };
}

type Created = { questionIds: string[] };
type Run = { askerIds: string[]; seatId: string; text: string; since: string };

// Removes what this run created, as in scripts/check-ask.ts: every q04 question its askers saved at the seat since it
// started (their answers rows go with them) and the demand prompts those questions started (their routes go with
// them). Answers what went wrong, or undefined.
async function cleanUp(
  service: SupabaseClient,
  created: Created,
  run: Run,
): Promise<string | undefined> {
  const asked = await service
    .from("questions")
    .select("id")
    .in("asker_user_id", run.askerIds)
    .eq("seat_id", run.seatId)
    .eq("text", run.text)
    .gte("created_at", run.since);
  if (asked.error) return `find the run's questions: ${asked.error.code}`;
  const questionIds = [
    ...new Set([
      ...created.questionIds,
      ...(asked.data ?? []).map((row) => row.id),
    ]),
  ];
  if (questionIds.length === 0) return undefined;

  // Before the questions go: deleting one sets its prompts' source_question_id to null.
  const started = await service
    .from("prompts")
    .select("id")
    .in("source_question_id", questionIds);
  if (started.error) return `find the run's prompts: ${started.error.code}`;
  // Only these: once dedupe (F2.5) lets a question join an open prompt, the prompt it joined isn't the run's to delete.
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
  const seatId: string = seat.data.id;

  // A minute of slack, in case this laptop's clock is ahead of the database's.
  const since = new Date(Date.now() - 60_000).toISOString();
  const asker = await signIn(url, anonKey, question.persona, password);
  const recipient = await signIn(url, anonKey, RECIPIENT, password);
  const others = await Promise.all(
    OTHERS.map((persona) => signIn(url, anonKey, persona, password)),
  );
  const bystanders = [asker, ...others]; // everyone who must get no route
  const phones = [recipient, ...bystanders];
  // The public key and no sign-in, as any web page could do.
  const signedOut: Phone = {
    persona: "a signed-out client",
    db: createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    token: "",
    userId: "",
    routes: [],
    answers: [],
  };
  const created: Created = { questionIds: [] };
  let listening = false;

  try {
    // 1. Every phone listens, and so does the signed-out client, unless Realtime refuses it.
    await Promise.all(phones.map((phone) => listen(phone)));
    const signedOutListens = await listen(signedOut, true);
    listening = true;
    check(
      `${phones.length} phones listen by Realtime, each with its own token`,
      true,
      `the signed-out client: ${signedOutListens}`,
    );

    // 2. The newcomer asks q04 (POST /api/ask): nobody knew, so it goes to the reachable predecessor.
    const askedAt = performance.now();
    const asked = await call("/api/ask", {
      token: asker.token,
      body: { seat: question.seat_slug, question: question.question },
    });
    const result = AskResult.safeParse(asked.body);
    const abstained =
      result.success && result.data.status === "abstained"
        ? result.data
        : undefined;
    if (abstained) created.questionIds.push(abstained.questionId);
    const promptId = abstained?.promptId;
    check(
      "a26 asks q04 and it reaches one predecessor",
      asked.status === 200 && abstained?.routedTo === 1 && Boolean(promptId),
      `HTTP ${asked.status}${abstained ? `, routedTo ${abstained.routedTo}` : ""}`,
    );
    if (!abstained || !promptId) return;

    // 3. a25's phone gets the route at once; nobody else's gets anything.
    const isRoute = (received: Received) =>
      received.event === "INSERT" && received.row.prompt_id === promptId;
    const arrived = await waitFor(
      () => recipient.routes.some(isRoute),
      ARRIVE_MS,
    );
    const route = recipient.routes.find(isRoute);
    check(
      "a25's phone gets the new question by Realtime",
      arrived,
      route
        ? `${Math.round(route.at - askedAt)} ms after a26 asked`
        : `nothing within ${ARRIVE_MS} ms`,
    );
    const row = PromptRoutesRow.safeParse(route?.row);
    check(
      "the row is a25's route, with ids only and not yet seen",
      row.success &&
        row.data.user_id === recipient.userId &&
        row.data.seen_at === null &&
        Object.keys(route?.row ?? {}).every((key) =>
          ["prompt_id", "user_id", "created_at", "seen_at"].includes(key),
        ),
    );
    await pause(GRACE_MS);
    for (const phone of bystanders) {
      check(
        `${phone.persona}'s phone gets nothing`,
        phone.routes.length === 0,
        `${phone.routes.length} route row(s)`,
      );
    }

    // 4. GET /api/inbox: a25 reads the question, the asker by seat and term only; nobody else reads anything.
    const inbox = InboxResponse.safeParse(
      (
        await call(`/api/inbox?seat=${question.seat_slug}`, {
          token: recipient.token,
        })
      ).body,
    );
    const item = inbox.success
      ? inbox.data.items.find((candidate) => candidate.promptId === promptId)
      : undefined;
    check(
      "a25's inbox holds the question, asked by seat and term",
      item?.question === question.question &&
        item.askedBy === ASKED_BY.ja &&
        item.askCount === 1 &&
        item.lang === "ja",
      item ? `askedBy ${item.askedBy}` : "not in the inbox",
    );
    const english = InboxResponse.safeParse(
      (
        await call(`/api/inbox?seat=${question.seat_slug}`, {
          token: recipient.token,
          locale: "en",
        })
      ).body,
    );
    const englishItem = english.success
      ? english.data.items.find((candidate) => candidate.promptId === promptId)
      : undefined;
    check(
      "with NEXT_LOCALE=en, askedBy uses the English label pack",
      englishItem?.askedBy === ASKED_BY.en,
      englishItem ? `askedBy ${englishItem.askedBy}` : "not in the inbox",
    );
    for (const phone of bystanders) {
      const theirs = await call(`/api/inbox?seat=${question.seat_slug}`, {
        token: phone.token,
      });
      const items = InboxResponse.safeParse(theirs.body);
      check(
        `${phone.persona}'s inbox is empty`,
        theirs.status === 200 && items.success && items.data.items.length === 0,
        `HTTP ${theirs.status}`,
      );
    }
    const refusals = [
      ["signed out", await call(`/api/inbox?seat=${question.seat_slug}`), 401],
      [
        "a malformed seat",
        await call("/api/inbox?seat=Smash%20Kaikei", {
          token: recipient.token,
        }),
        400,
      ],
      [
        "an unknown seat",
        await call("/api/inbox?seat=no-such-seat", { token: recipient.token }),
        404,
      ],
    ] as const;
    for (const [what, response, status] of refusals) {
      check(
        `the inbox refuses ${what}`,
        response.status === status,
        `HTTP ${response.status}`,
      );
    }

    // 5. POST /api/inbox/seen: opening the slip records the time once.
    const opened = await call("/api/inbox/seen", {
      token: recipient.token,
      body: { promptId },
    });
    const first = SeenResponse.safeParse(opened.body);
    check(
      "a25 opening the slip records when",
      opened.status === 200 && first.success,
      `HTTP ${opened.status}`,
    );
    const reopened = SeenResponse.safeParse(
      (
        await call("/api/inbox/seen", {
          token: recipient.token,
          body: { promptId },
        })
      ).body,
    );
    check(
      "opening it again keeps the first time",
      first.success &&
        reopened.success &&
        reopened.data.seenAt === first.data.seenAt,
    );
    const stored = await service
      .from("prompt_routes")
      .select("seen_at")
      .eq("prompt_id", promptId)
      .eq("user_id", recipient.userId)
      .single();
    check(
      "the route holds that time",
      first.success &&
        typeof stored.data?.seen_at === "string" &&
        Date.parse(stored.data.seen_at) === Date.parse(first.data.seenAt),
    );
    for (const phone of bystanders) {
      const theirs = await call("/api/inbox/seen", {
        token: phone.token,
        body: { promptId },
      });
      check(
        `${phone.persona} can't mark it seen`,
        theirs.status === 404,
        `HTTP ${theirs.status}`,
      );
    }

    // 6. An answers row reaches its asker alone: the way the signed answer comes back (F3.8).
    const answerSent = performance.now();
    const saved = await asker.db.from("answers").insert({
      question_id: abstained.questionId,
      payload: abstained,
    });
    check(
      "a26 saves an answers row for its own question",
      !saved.error,
      saved.error?.code ?? "",
    );
    const isAnswer = (received: Received) =>
      received.row.question_id === abstained.questionId;
    const answered = await waitFor(
      () => asker.answers.some(isAnswer),
      ARRIVE_MS,
    );
    const answer = asker.answers.find(isAnswer);
    check(
      "a26's phone gets the answers row by Realtime",
      answered && AnswersRow.safeParse(answer?.row).success,
      answer
        ? `${Math.round(answer.at - answerSent)} ms after it was saved`
        : `nothing within ${ARRIVE_MS} ms`,
    );
    await pause(GRACE_MS);
    for (const phone of [recipient, ...others]) {
      check(
        `${phone.persona}'s phone gets no answers row`,
        phone.answers.length === 0,
        `${phone.answers.length} answers row(s)`,
      );
    }
  } finally {
    // 7. Leave the demo database as it was, with every phone still listening: a delete can't be checked against a
    //    policy, so 0005 publishes none, and the cleanup's deletes must reach nobody.
    const problem = await cleanUp(service, created, {
      askerIds: [asker.userId],
      seatId,
      text: question.question,
      since,
    });
    if (listening) {
      await pause(GRACE_MS);
      const deletes = [...phones, signedOut]
        .flatMap((phone) => [...phone.routes, ...phone.answers])
        .filter((received) => received.event === "DELETE").length;
      check(
        "the cleanup's deletes reach no phone",
        deletes === 0,
        `${deletes} delete row(s)`,
      );
      for (const phone of [...others, signedOut]) {
        const received = phone.routes.length + phone.answers.length;
        check(
          `${phone.persona} got nothing in the whole run`,
          received === 0,
          `${received} row(s)`,
        );
      }
    }
    for (const phone of [...phones, signedOut]) {
      await phone.db.removeAllChannels();
      phone.db.realtime.disconnect();
    }
    console.log(
      problem
        ? `\n✗ #8 check: ${checks} checks, ${failed ? "failed" : "all passed"}, but the cleanup failed (${problem}): the demo data may not be as it was`
        : `\n${failed ? "✗" : "✓"} #8 check: ${checks} checks, ${failed ? "failed" : "all passed"} (the demo data is back as it was)`,
    );
    process.exitCode = failed || problem ? 1 : 0;
  }
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
