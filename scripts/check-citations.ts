// F4.5 (#29): citation coverage, the README's "Answer sentences with a source note" number (docs/SPEC.md → F2, F4).
// Asks every question in seed/questions.csv, each as its own persona with that persona's token, through POST /api/ask,
// and counts the answer sentences and those whose sources are valid: every note a sentence cites is one its asker may
// read, by the hand-written visibility table (tests/visibility-table.ts), never by what the engine says. The contract
// already refuses a sentence without a citation, so "has a citation" would be 100% by construction; a citation of a
// note the asker can't read, or of a note that doesn't exist, is what this catches.
//
//   pnpm dev          (in another terminal, with Ollama and the Claude key)
//   pnpm metrics      (runs this check; or run this file directly)
//
// Needs the seeded database (the table is the seed state) and a running dev server. It writes nothing unless a25's
// inbox is empty: q04 abstains and reaches a25's inbox for a moment. It removes exactly the questions its replies
// named (their answers, prompts and routes go with them), so a rehearsal's own questions are never touched, and says
// the demo data is back only when the counts are what they were. Counts and ids only: never a question or answer
// text, never an email.
import { readFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";
import { AskResult, InboxResponse, type Metrics } from "@/lib/contracts";
import { reportMetrics } from "@/scripts/metrics-line";
import { reads, viewers } from "@/tests/visibility-table";

type QuestionRow = {
  id: string;
  persona: string;
  seat_slug: string;
  question: string;
};

const BASE_URL = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const REACHABLE = "a25"; // the seat's reachable holder: q04's slip lands in this inbox

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set in .env.local`);
  return value;
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

type Session = { token: string; userId: string };

// One signed-in persona per client, as a browser pane would be. The emails are scripts/seed.ts's, as the visibility
// table lists them.
async function signIn(
  url: string,
  anonKey: string,
  persona: string,
  password: string,
): Promise<Session> {
  const email = viewers.find((viewer) => viewer.key === persona)?.email;
  if (!email) throw new Error(`no demo account for persona ${persona}`);
  const db = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session) {
    throw new Error(`sign in as ${persona}: ${error?.code ?? "no session"}`);
  }
  return { token: data.session.access_token, userId: data.user.id };
}

async function call(
  path: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => undefined),
  };
}

async function countQuestions(service: SupabaseClient): Promise<number> {
  const { count, error } = await service
    .from("questions")
    .select("id", { count: "exact", head: true });
  if (error || count === null) {
    throw new Error(`count the questions: ${error?.code}`);
  }
  return count;
}

// Removes the questions this run's replies named, and the demand prompts those questions started (their routes and
// answers go with them). Answers what went wrong, or undefined.
async function cleanUp(
  service: SupabaseClient,
  questionIds: string[],
): Promise<string | undefined> {
  if (questionIds.length === 0) return undefined;
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
  return undefined;
}

// One answer's sentences, and those whose every citation is a note its asker may read. A note the seed doesn't have
// can't be judged by the table, so the answer is left unjudged rather than counted either way.
function judge(
  persona: string,
  result: AskResult,
): { sentences: number; cited: number; unknown: string[] } {
  if (result.status !== "answered")
    return { sentences: 0, cited: 0, unknown: [] };
  const unknown = result.sentences.flatMap((sentence) =>
    sentence.citations
      .map((citation) => citation.noteId)
      .filter((noteId) => reads(persona, noteId) === undefined),
  );
  const cited = result.sentences.filter(
    (sentence) =>
      sentence.citations.length > 0 &&
      sentence.citations.every(
        (citation) => reads(persona, citation.noteId) === true,
      ),
  ).length;
  return { sentences: result.sentences.length, cited, unknown };
}

async function main(): Promise<void> {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const password = env("DEMO_PASSWORD");
  const service = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const questions = await readQuestions();
  const sessions = new Map<string, Session>();
  for (const persona of new Set([
    REACHABLE,
    ...questions.map((q) => q.persona),
  ])) {
    sessions.set(persona, await signIn(url, anonKey, persona, password));
  }

  // Nothing is written unless a25's inbox is empty, as the seed leaves it: otherwise someone may be rehearsing.
  const seat = questions[0]?.seat_slug ?? "smash-kaikei";
  const reachable = sessions.get(REACHABLE);
  if (!reachable) throw new Error(`no ${REACHABLE} session`);
  const inbox = await call(`/api/inbox?seat=${seat}`, reachable.token);
  const items = InboxResponse.safeParse(inbox.body);
  if (!items.success) {
    throw new Error(
      `read ${REACHABLE}'s inbox: HTTP ${inbox.status} (is pnpm dev running?)`,
    );
  }
  if (items.data.items.length > 0) {
    throw new Error(
      `${REACHABLE}'s inbox holds ${items.data.items.length} question(s): someone may be rehearsing. If not, run pnpm demo:reset first`,
    );
  }

  const before = await countQuestions(service);
  const questionIds: string[] = [];
  let sentences = 0;
  let cited = 0;
  let measured = true; // every question got an answer the table could judge
  let problem: string | undefined;

  try {
    for (const question of questions) {
      const session = sessions.get(question.persona);
      if (!session) throw new Error(`no ${question.persona} session`);
      const reply = await call("/api/ask", session.token, {
        seat: question.seat_slug,
        question: question.question,
      });
      const result = AskResult.safeParse(reply.body);
      if (reply.status !== 200 || !result.success) {
        // No partial coverage: a check that couldn't ask every question hands the README nothing.
        measured = false;
        const code = (reply.body as { error?: string } | undefined)?.error;
        console.log(
          `✗ ${question.id}: POST /api/ask answered HTTP ${reply.status}${code ? ` (${code})` : ""}`,
        );
        break;
      }
      questionIds.push(result.data.questionId);
      const counted = judge(question.persona, result.data);
      if (counted.unknown.length > 0) {
        measured = false;
        console.log(
          `✗ ${question.id}: cites a note the seed doesn't have (${counted.unknown.join(", ")}): run pnpm demo:reset first`,
        );
        continue;
      }
      sentences += counted.sentences;
      cited += counted.cited;
      console.log(
        result.data.status === "answered"
          ? `${counted.cited === counted.sentences ? "✓" : "✗"} ${question.id} (${question.persona}): ${counted.sentences} sentence(s), ${counted.cited} with valid sources`
          : `✓ ${question.id} (${question.persona}): abstained, no sentence to cite`,
      );
    }
  } finally {
    problem = await cleanUp(service, questionIds);
    if (!problem) {
      const after = await countQuestions(service);
      if (after !== before) {
        problem = `${after - before} question(s) more than before the run`;
      }
    }
    console.log(
      problem
        ? `✗ the demo data isn't as it was (${problem})`
        : "✓ the demo data is back as it was",
    );
  }

  if (measured) {
    const coverage =
      sentences === 0 ? "—" : `${Math.round((cited / sentences) * 100)}%`;
    console.log(
      `\n${cited} / ${sentences} sentences cite only notes their asker may read (${coverage}) over ${questions.length} questions`,
    );
    const citations: NonNullable<Metrics["citations"]> = { sentences, cited };
    reportMetrics({ citations });
  } else {
    console.log("\n— citations: not measured");
  }
  process.exitCode =
    measured && !problem && sentences > 0 && cited === sentences ? 0 : 1;
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
