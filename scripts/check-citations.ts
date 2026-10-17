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
// inbox is empty: q04 abstains and reaches a25's inbox for a moment. It removes exactly the questions it asked (the
// ids its replies named, or the one a failed reply still saved) and the prompts they started, unless a rehearsal's
// question joined one (scripts/remove-questions.ts), and says the demo data is back only when no question is left
// that wasn't there before. Ctrl-C stops it after the question in flight, cleanup included. Counts and ids only:
// never a question or answer text, never an email.
import { readFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";
import { AskResult, InboxResponse, type Metrics } from "@/lib/contracts";
import { reportMetrics } from "@/scripts/metrics-line";
import { removeQuestions } from "@/scripts/remove-questions";
import { reads, viewers } from "@/tests/visibility-table";

type QuestionRow = {
  id: string;
  persona: string;
  seat_slug: string;
  question: string;
};

const BASE_URL = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const REACHABLE = "a25"; // the seat's reachable holder: q04's slip lands in this inbox
const REQUEST_MS = 60_000; // one question, Sonnet included: a hung server stops the check instead of blocking it

// Ctrl-C (or pnpm metrics stopping) ends the check after the question in flight, and the cleanup still runs.
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopping = true;
  });
}

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
    signal: AbortSignal.timeout(REQUEST_MS),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => undefined),
  };
}

// Every question's id, read with the service role: the ones there before the run are never removed.
async function allQuestionIds(service: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await service.from("questions").select("id");
  if (error) throw new Error(`read the questions: ${error.code}`);
  return new Set((data as { id: string }[]).map((row) => row.id));
}

// POST /api/ask saves the question before it answers or routes it, so a reply that failed may still have left the
// question behind: the asker's question at that seat with that text, saved since the run began and not there before.
// The text is compared here and never printed.
async function savedBeforeFailing(
  service: SupabaseClient,
  asked: { userId: string; seatId: string; text: string; since: string },
  before: Set<string>,
): Promise<string[]> {
  const { data, error } = await service
    .from("questions")
    .select("id, text")
    .eq("asker_user_id", asked.userId)
    .eq("seat_id", asked.seatId)
    .gte("created_at", asked.since);
  if (error) return [];
  return (data as { id: string; text: string }[])
    .filter((row) => row.text === asked.text && !before.has(row.id))
    .map((row) => row.id);
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

  const seats = await service.from("seats").select("id, slug");
  if (seats.error) throw new Error(`read the seats: ${seats.error.code}`);
  const seatIds = new Map(
    (seats.data as { id: string; slug: string }[]).map((row) => [
      row.slug,
      row.id,
    ]),
  );
  const before = await allQuestionIds(service);
  const since = new Date(Date.now() - 60_000).toISOString(); // a minute of slack for the clocks
  const questionIds: string[] = [];
  let sentences = 0;
  let cited = 0;
  let measured = true; // every question got an answer the table could judge
  let problems: string[] = [];

  try {
    for (const question of questions) {
      if (stopping) {
        measured = false;
        console.log("✗ stopped before every question was asked");
        break;
      }
      const session = sessions.get(question.persona);
      if (!session) throw new Error(`no ${question.persona} session`);
      const reply = await call("/api/ask", session.token, {
        seat: question.seat_slug,
        question: question.question,
      }).catch((error: unknown) => ({
        status: 0,
        body: { error: error instanceof Error ? error.name : "error" },
      }));
      const result = AskResult.safeParse(reply.body);
      if (reply.status !== 200 || !result.success) {
        // No partial coverage: a check that couldn't ask every question hands the README nothing.
        measured = false;
        const code = (reply.body as { error?: string } | undefined)?.error;
        console.log(
          `✗ ${question.id}: POST /api/ask answered ${reply.status ? `HTTP ${reply.status}` : "nothing"}${code ? ` (${code})` : ""}`,
        );
        questionIds.push(
          ...(await savedBeforeFailing(
            service,
            {
              userId: session.userId,
              seatId: seatIds.get(question.seat_slug) ?? "",
              text: question.question,
              since,
            },
            before,
          )),
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
    // The questions and the prompts they started, unless a rehearsal's question joined one (remove-questions.ts).
    problems = await removeQuestions(service, [...new Set(questionIds)]);
    const left = [...(await allQuestionIds(service))].filter(
      (id) => !before.has(id),
    ).length;
    if (left > 0) {
      problems.push(`${left} question(s) more than before the run`);
    }
    console.log(
      problems.length > 0
        ? `✗ the demo data isn't as it was:\n  ${problems.join("\n  ")}`
        : "✓ the demo data is back as it was",
    );
  }

  // A run where every question abstained measured nothing: 0 of 0 sentences is no coverage at all.
  if (measured && sentences > 0) {
    console.log(
      `\n${cited} / ${sentences} sentences cite only notes their asker may read (${Math.round((cited / sentences) * 100)}%) over ${questions.length} questions`,
    );
    const citations: NonNullable<Metrics["citations"]> = { sentences, cited };
    reportMetrics({ citations });
  } else {
    console.log(
      measured
        ? "\n— citations: not measured (no question was answered, so no sentence to count)"
        : "\n— citations: not measured",
    );
  }
  process.exitCode =
    measured && problems.length === 0 && sentences > 0 && cited === sentences
      ? 0
      : 1;
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
