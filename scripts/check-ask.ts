// #7, #20 and #21 acceptance checks (docs/SPEC.md → F3, F2) through POST /api/ask: q04, asked by the 2026 treasurer,
// creates one route, for the 2025 treasurer and nobody else; q01 is answered from the notes, every sentence citing the
// 2024 or 2025 note, with the 2025 rule change flagged. Runs against the seeded database and a running dev server, with
// Ollama for the search and the Claude key for q01's answer:
//   pnpm dev          (in another terminal)
//   pnpm test:ask
// The asks go over HTTP with a26's own token, as a phone would, so the route handler and RLS are exercised for
// real. The reads that must see past a persona's own rows use the service-role key, which only scripts/ may hold.
// Everything this check creates is removed afterwards, and it says the demo data is back only when it is.
// Don't run it during a rehearsal: it puts a slip in a25's inbox, and its cleanup removes a26's q01 and q04 questions
// from the last minutes.
// Counts, ids and personas only: never the question or answer text, never an email.
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";
import { AskResult } from "@/lib/contracts";

type QuestionRow = {
  id: string;
  persona: string;
  seat_slug: string;
  question: string;
};

const BASE_URL = process.env.CHECK_BASE_URL ?? "http://localhost:3000";

// scripts/seed.ts gives every persona one account at <key>@example.com; seed/questions.csv and lib/mocks.ts call
// the same five personas by alias.
const EMAIL: Record<string, string> = {
  a24: "smash-kaikei-2024",
  a25: "smash-kaikei-2025",
  a26: "smash-kaikei-2026",
  b: "keion-member",
  x: "yamate-outsider",
};
const REACHABLE = "a25"; // the seat's only reachable holder
const STRANGER = "b"; // another club's member: holds no seat at smash-kaikei
// The asker (holds the seat, but an asker is never a recipient), an earlier-term holder, another club's member and an
// outsider.
const MUST_SEE_NOTHING = ["a26", "a24", "b", "x"];
// Every sentence of q01's answer cites one of these, and the deadline moved between them (docs/SPEC.md → F2).
const Q01_NOTES = ["smash-2024-hokenjo", "smash-2025-hokenjo"];
const Q01_RULE_CHANGE = { termLabel: "2025", summary: "10/27 → 10/20" };

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

// For a "sees nothing" check: only a query that worked and came back empty counts. A failed query proves nothing.
function sawNothing(result: {
  data: unknown[] | null;
  error: { code: string } | null;
}): { ok: boolean; detail: string } {
  if (result.error) {
    return { ok: false, detail: `query failed: ${result.error.code}` };
  }
  const rows = result.data?.length ?? 0;
  return { ok: rows === 0, detail: `${rows} row(s)` };
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

type Session = { db: SupabaseClient; token: string; userId: string };

// One signed-in persona per client: a session belongs to the client that created it, as in a browser pane.
async function signIn(
  url: string,
  anonKey: string,
  persona: string,
  password: string,
): Promise<Session> {
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
  return { db, token: data.session.access_token, userId: data.user.id };
}

async function ask(token: string | undefined, question: QuestionRow) {
  return fetch(`${BASE_URL}/api/ask`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token && { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({
      seat: question.seat_slug,
      question: question.question,
    }),
  });
}

async function openDemandPrompts(
  service: SupabaseClient,
  seatId: string,
): Promise<number> {
  const { count, error } = await service
    .from("prompts")
    .select("id", { count: "exact", head: true })
    .eq("seat_id", seatId)
    .eq("kind", "demand")
    .eq("retired", false);
  if (error) throw new Error(`count demand prompts: ${error.code}`);
  return count ?? 0;
}

type Created = { questionIds: string[] };
type Run = {
  askerIds: string[];
  seatId: string;
  texts: string[];
  since: string;
};

// Removes what this run created: every question it asked (q01, q04) that its askers saved at the seat since it
// started, also one from a request that failed after the insert (routed or not), and the demand prompts those
// questions started (their routes go with them; an answer goes with its question). A prompt a question only joined is
// left alone. Answers what went wrong, or undefined.
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
    .in("text", run.texts)
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

// q01 (F2, #20): answered from the notes the asker may read, every sentence citing the 2024 or 2025 note. The question
// is saved as answered with its answer, both readable by the asker, and starts no demand prompt.
async function checkAnswered(
  question: QuestionRow,
  asker: Session,
  service: SupabaseClient,
  created: Created,
): Promise<void> {
  const response = await ask(asker.token, question);
  check(
    `${question.id}: POST /api/ask answers 200`,
    response.ok,
    response.ok ? "" : `HTTP ${response.status}`,
  );
  if (!response.ok) return;
  const result = AskResult.parse(await response.json());
  created.questionIds.push(result.questionId);
  check(
    `${question.id}: it is answered from the notes`,
    result.status === "answered",
    result.status,
  );
  if (result.status !== "answered") return;

  const cited = result.sentences.map((sentence) =>
    sentence.citations.map((citation) => citation.noteId),
  );
  check(
    `${question.id}: every sentence cites the 2024 or 2025 note`,
    cited.every((ids) => ids.some((id) => Q01_NOTES.includes(id))),
    cited.map((ids) => `[${ids.join(", ")}]`).join(" "),
  );
  check(
    `${question.id}: the 2025 rule change is flagged (10/27 → 10/20)`,
    isDeepStrictEqual(result.ruleChange, Q01_RULE_CHANGE),
    result.ruleChange
      ? `${result.ruleChange.termLabel}: ${result.ruleChange.summary}`
      : "none",
  );
  check(
    `${question.id}: in the asker's language`,
    result.language === "ja",
    result.language,
  );

  const saved = await asker.db
    .from("questions")
    .select("status, prompt_id")
    .eq("id", result.questionId)
    .maybeSingle();
  check(
    `${question.id}: the asker's question is saved as answered, linked to no prompt`,
    saved.data?.status === "answered" && saved.data.prompt_id === null,
  );
  const stored = await asker.db
    .from("answers")
    .select("payload")
    .eq("question_id", result.questionId)
    .maybeSingle();
  check(
    `${question.id}: the asker reads the answer it was given`,
    isDeepStrictEqual(stored.data?.payload, result),
  );
  const started = await service
    .from("prompts")
    .select("id", { count: "exact", head: true })
    .eq("source_question_id", result.questionId);
  check(`${question.id}: it starts no demand prompt`, started.count === 0);
}

async function main(): Promise<void> {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const password = env("DEMO_PASSWORD");
  const service = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const questions = await readQuestions();
  const question = questions.find((row) => row.id === "q04");
  const q01 = questions.find((row) => row.id === "q01");
  if (!question || !q01)
    throw new Error("seed/questions.csv needs q01 and q04");

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
  const reachable = await signIn(url, anonKey, REACHABLE, password);
  const stranger = await signIn(url, anonKey, STRANGER, password);
  const q01Asker =
    q01.persona === question.persona
      ? asker
      : await signIn(url, anonKey, q01.persona, password);
  const created: Created = { questionIds: [] };

  try {
    // q01 first, so a failing q04 can't hide whether it's answered.
    await checkAnswered(q01, q01Asker, service, created);

    // 1. The newcomer asks, with their own token: POST /api/ask.
    const response = await ask(asker.token, question);
    const responseError = response.ok
      ? undefined
      : ((await response.json()) as { error?: string });
    check(
      "POST /api/ask answers 200",
      response.ok,
      response.ok
        ? ""
        : `HTTP ${response.status} ${responseError?.error ?? ""}`,
    );
    if (!response.ok) return;

    const result = AskResult.parse(await response.json());
    check(
      "it abstains: no note is close enough to answer it",
      result.status === "abstained",
    );
    if (result.status !== "abstained") return;
    created.questionIds.push(result.questionId);
    const promptId = result.promptId;
    check(
      "the question became one demand prompt that reached predecessors",
      result.routedTo === 1 && Boolean(promptId),
      `routedTo ${result.routedTo}`,
    );
    if (!promptId) return;

    // 2. The database agrees: one prompt, one route, and it is the reachable predecessor.
    const prompt = await service
      .from("prompts")
      .select("kind, ask_count, retired, seat_id")
      .eq("id", promptId)
      .single();
    check(
      "the prompt is an open demand prompt asking once",
      prompt.data?.kind === "demand" &&
        prompt.data?.ask_count === 1 &&
        prompt.data?.retired === false,
    );
    check(
      "the prompt belongs to the seat asked",
      prompt.data?.seat_id === seatId,
    );

    const routes = await service
      .from("prompt_routes")
      .select("user_id")
      .eq("prompt_id", promptId);
    if (routes.error)
      throw new Error(`read prompt_routes: ${routes.error.code}`);
    const recipients = [
      ...new Set((routes.data ?? []).map((row) => row.user_id)),
    ];
    check(
      "exactly one route exists",
      recipients.length === 1,
      `${recipients.length} route(s)`,
    );
    check(
      `the only recipient is the 2025 treasurer (${REACHABLE})`,
      recipients.length === 1 && recipients[0] === reachable.userId,
      recipients.length === 1 && recipients[0] !== reachable.userId
        ? "it went to someone else"
        : "",
    );

    // 3. The asker sees their own question, linked to the prompt (RLS, as themselves).
    const mine = await asker.db
      .from("questions")
      .select("id, lang, status, prompt_id")
      .eq("id", result.questionId)
      .maybeSingle();
    check(
      "the asker reads their own question, waiting and linked",
      mine.data?.prompt_id === promptId &&
        mine.data?.status === "waiting" &&
        mine.data?.lang === "ja",
    );

    // 4. Nobody else sees the route or the demand prompt, not even the asker.
    for (const persona of MUST_SEE_NOTHING) {
      const peek =
        persona === question.persona
          ? asker
          : persona === STRANGER
            ? stranger
            : await signIn(url, anonKey, persona, password);
      const seenRoute = await peek.db
        .from("prompt_routes")
        .select("user_id")
        .eq("prompt_id", promptId);
      const seenPrompt = await peek.db
        .from("prompts")
        .select("id")
        .eq("id", promptId);
      const route = sawNothing(seenRoute);
      check(`${persona} sees no route`, route.ok, route.detail);
      const prompt = sawNothing(seenPrompt);
      check(
        `${persona} can't read the demand prompt`,
        prompt.ok,
        prompt.detail,
      );
    }

    // 5. A signed-out caller is refused, and a question from someone who holds no seat at the seat routes nowhere.
    const signedOut = await ask(undefined, question);
    check("a signed-out caller is refused", signedOut.status === 401);

    const openBefore = await openDemandPrompts(service, seatId);
    const strangerResponse = await ask(stranger.token, question);
    const strangerResult = AskResult.parse(await strangerResponse.json());
    if (strangerResult.status === "abstained")
      created.questionIds.push(strangerResult.questionId);
    check(
      "a question from outside the seat routes nowhere and names no prompt",
      strangerResult.status === "abstained" &&
        strangerResult.routedTo === 0 &&
        strangerResult.promptId === undefined,
      strangerResult.status === "abstained"
        ? `routedTo ${strangerResult.routedTo}, promptId ${strangerResult.promptId ? "set" : "none"}`
        : strangerResult.status,
    );
    const openAfter = await openDemandPrompts(service, seatId);
    check(
      "no demand prompt was created for it",
      openAfter === openBefore,
      `${openAfter - openBefore} new`,
    );
  } finally {
    // 6. Leave the demo database as it was.
    const problem = await cleanUp(service, created, {
      askerIds: [...new Set([asker.userId, q01Asker.userId, stranger.userId])],
      seatId,
      texts: [question.question, q01.question],
      since,
    });
    console.log(
      problem
        ? `\n✗ /api/ask check (#7, #20, #21): ${checks} checks, ${failed ? "failed" : "all passed"}, but the cleanup failed (${problem}): the demo data may not be as it was`
        : `\n${failed ? "✗" : "✓"} /api/ask check (#7, #20, #21): ${checks} checks, ${failed ? "failed" : "all passed"} (the demo data is back as it was)`,
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
