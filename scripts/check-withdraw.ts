// F4.5 (#29): the withdrawal number, the README's "Withdrawal to gone" (docs/SPEC.md → F4): the median and maximum
// seconds from the click that withdraws a cited note to the note being absent in every pane, over 10 runs.
//
//   pnpm dev          (in another terminal, with Ollama and the Claude key: each run answers q01 first)
//   pnpm metrics      (runs this check; or run this file directly)
//
// Headless, "absent in every pane" is read as the two panes that can show the note, each read as that persona with
// its own token so RLS decides: the author's 自分のメモ (the note's own status turns withdrawn) and the newcomer's
// answer (the latest answer no longer cites the note). The click is POST /api/notes/[id]/withdraw; the note is
// restored to live after every run so the next run starts from the seed state.
//
// Needs the seeded database, a running dev server and the withdraw route (F4.2, #26): without it this check measures
// nothing and says so, and the README says "not measured". Everything it creates is removed afterwards. Counts,
// ids and seconds only: never a title, body or answer text.
import { readFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";
import { AskResult, WithdrawResponse } from "@/lib/contracts";
import { reportMetrics } from "@/scripts/metrics-line";

type QuestionRow = {
  id: string;
  persona: string;
  seat_slug: string;
  question: string;
};

const BASE_URL = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const RUNS = 10; // SPEC F4: median under 1 s over 10 runs
const NOTE = "smash-2025-hokenjo"; // the 2025 deadline note q01's answer cites; a25 wrote it
const ASKER = "a26";
const AUTHOR = "a25";
const POLL_MS = 50;
const RUN_TIMEOUT_MS = 10_000;

const EMAIL: Record<string, string> = {
  a24: "smash-kaikei-2024",
  a25: "smash-kaikei-2025",
  a26: "smash-kaikei-2026",
  b: "keion-member",
  x: "yamate-outsider",
};

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

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

type Session = { token: string; userId: string; db: SupabaseClient };

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
  return { token: data.session.access_token, userId: data.user.id, db };
}

// Asks q01 as the newcomer; the answer must cite the note, or there is nothing to withdraw and watch vanish.
async function ask(
  asker: Session,
  question: QuestionRow,
): Promise<{ questionId: string; status: "answered" | "abstained" }> {
  const response = await fetch(`${BASE_URL}/api/ask`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${asker.token}`,
    },
    body: JSON.stringify({
      seat: question.seat_slug,
      question: question.question,
    }),
  });
  if (!response.ok)
    throw new Error(`POST /api/ask answered HTTP ${response.status}`);
  return AskResult.parse(await response.json());
}

// One withdrawal: click, then wait until the note is gone from both panes. Returns the seconds, or undefined when
// the panes never agreed inside the timeout (that run is a failure, and no median is published from it).
async function runOnce(
  author: Session,
  asker: Session,
  questionId: string,
): Promise<number | undefined> {
  const started = performance.now();
  const response = await fetch(`${BASE_URL}/api/notes/${NOTE}/withdraw`, {
    method: "POST",
    headers: { authorization: `Bearer ${author.token}` },
  });
  if (response.status === 404 || response.status === 405)
    throw new Error("no_withdraw_route");
  if (!response.ok)
    throw new Error(
      `POST /api/notes/[id]/withdraw answered HTTP ${response.status}`,
    );
  if (!WithdrawResponse.safeParse(await response.json()).success)
    throw new Error("the withdraw response isn't a WithdrawResponse");

  const until = started + RUN_TIMEOUT_MS;
  for (;;) {
    const [note, answer] = await Promise.all([
      author.db.from("notes").select("status").eq("id", NOTE).maybeSingle(),
      asker.db
        .from("answers")
        .select("payload")
        .eq("question_id", questionId)
        .maybeSingle(),
    ]);
    const goneFromNotes = note.data?.status === "withdrawn";
    const goneFromAnswer =
      answer.data === null ||
      (AskResult.safeParse(answer.data?.payload).success &&
        !JSON.stringify(answer.data?.payload).includes(NOTE));
    if (goneFromNotes && goneFromAnswer)
      return Number(((performance.now() - started) / 1000).toFixed(3));
    if (performance.now() > until) return undefined;
    await pause(POLL_MS);
  }
}

// Puts the note back to live (the seed state) so the next run has something to withdraw. The service-role key lives
// in scripts/ only.
async function restore(service: SupabaseClient): Promise<void> {
  const { error } = await service
    .from("notes")
    .update({ status: "live", withdrawn_at: null })
    .eq("id", NOTE);
  if (error) throw new Error(`restore ${NOTE}: ${error.code}`);
}

async function cleanUp(
  service: SupabaseClient,
  questionIds: string[],
  run: { askerIds: string[]; text: string; since: string },
): Promise<string | undefined> {
  const asked = await service
    .from("questions")
    .select("id")
    .in("asker_user_id", run.askerIds)
    .eq("text", run.text)
    .gte("created_at", run.since);
  if (asked.error) return `find the run's questions: ${asked.error.code}`;
  const ids = [
    ...new Set([...questionIds, ...(asked.data ?? []).map((row) => row.id)]),
  ];
  if (ids.length === 0) return undefined;

  const started = await service
    .from("prompts")
    .select("id")
    .in("source_question_id", ids);
  if (started.error) return `find the run's prompts: ${started.error.code}`;
  const promptIds = (started.data ?? []).map((row) => row.id);
  if (promptIds.length > 0) {
    const { error } = await service
      .from("prompts")
      .delete()
      .in("id", promptIds);
    if (error) return `delete prompts: ${error.code}`;
  }
  const { error } = await service.from("questions").delete().in("id", ids);
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

  const questions = parse(
    await readFile(new URL("../seed/questions.csv", import.meta.url), "utf8"),
    { columns: true, skip_empty_lines: true, bom: true },
  ) as QuestionRow[];
  const question = questions.find((row) => row.id === "q01");
  if (!question || question.persona !== ASKER)
    throw new Error("seed/questions.csv needs q01 asked by a26");

  const since = new Date(Date.now() - 60_000).toISOString();
  const author = await signIn(url, anonKey, AUTHOR, password);
  const asker = await signIn(url, anonKey, ASKER, password);
  const questionIds: string[] = [];
  const seconds: number[] = [];
  let measured = false;
  let failed = false;

  try {
    // The seed state: live, and readable by the asker's later term.
    await restore(service);

    for (let run = 1; run <= RUNS; run += 1) {
      const asked = await ask(asker, question);
      questionIds.push(asked.questionId);
      if (asked.status !== "answered") {
        failed = true;
        console.log(`✗ run ${run}: q01 abstained, so no answer cites the note`);
        break;
      }
      const result = AskResult.parse(asked);
      const cites =
        result.status === "answered" &&
        result.sentences.some((sentence) =>
          sentence.citations.some((citation) => citation.noteId === NOTE),
        );
      if (!cites) {
        failed = true;
        console.log(
          `✗ run ${run}: the answer doesn't cite ${NOTE}, so there is nothing to watch vanish`,
        );
        break;
      }

      const taken = await runOnce(author, asker, asked.questionId);
      await restore(service);
      if (taken === undefined) {
        failed = true;
        console.log(
          `✗ run ${run}: the note never left both panes within ${RUN_TIMEOUT_MS / 1000} s`,
        );
        break;
      }
      seconds.push(taken);
      console.log(`✓ run ${run}: absent in every pane after ${taken} s`);
    }

    if (!failed && seconds.length === RUNS) {
      measured = true;
      const medianS = Number(median(seconds).toFixed(3));
      const maxS = Number(Math.max(...seconds).toFixed(3));
      console.log(`\n${RUNS} runs: median ${medianS} s, max ${maxS} s`);
      reportMetrics({ withdraw: { runs: RUNS, medianS, maxS } });
    }
  } finally {
    const problem = await cleanUp(service, questionIds, {
      askerIds: [asker.userId],
      text: question.question,
      since,
    });
    await restore(service).catch(() => undefined);
    if (problem) {
      failed = true;
      console.log(
        `✗ the cleanup failed (${problem}): the demo data may not be as it was`,
      );
    }
    if (!measured) {
      console.log(
        "— withdraw: not measured — needs the withdraw route (F4.2, #26), a running dev server and Ollama",
      );
      process.exitCode = 1;
    } else {
      process.exitCode = failed ? 1 : 0;
    }
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "no_withdraw_route") {
    console.log(
      "— withdraw: not measured — POST /api/notes/[id]/withdraw isn't deployed (F4.2, #26)",
    );
    process.exitCode = 1;
  } else {
    console.error(`✗ ${message}`);
    process.exitCode = 1;
  }
}
