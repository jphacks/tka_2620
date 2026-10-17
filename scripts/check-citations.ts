// F4.5 (#29): citation coverage, the README's "Answer sentences with a source note" number (docs/SPEC.md → F2, F4).
// Asks every question in seed/questions.csv, each as its own persona with that persona's token, through POST /api/ask,
// and counts the answer sentences and those citing at least one retrieved note. The engine already drops a sentence
// whose citation doesn't validate, so coverage below 100% means a sentence got through without a source.
//
//   pnpm dev          (in another terminal, with Ollama and the Claude key)
//   pnpm metrics      (runs this check; or run this file directly)
//
// Needs the seeded database and a running dev server. Everything it creates is removed afterwards, so it leaves no
// question, answer, prompt or route behind: the demo data is as it was. Counts and ids only: never a question or
// answer text, never an email.
import { readFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";
import { AskResult } from "@/lib/contracts";
import { reportMetrics } from "@/scripts/metrics-line";

type QuestionRow = {
  id: string;
  persona: string;
  seat_slug: string;
  question: string;
};

const BASE_URL = process.env.CHECK_BASE_URL ?? "http://localhost:3000";

// scripts/seed.ts gives every persona one account at <key>@example.com; seed/questions.csv calls them by alias.
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

// One signed-in persona per client, as a browser pane would be.
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
  return { token: data.session.access_token, userId: data.user.id };
}

// Removes every question this run created (and the demand prompts those questions started; their routes and answers
// go with them). A prompt a question only joined is left alone. Answers what went wrong, or undefined.
async function cleanUp(
  service: SupabaseClient,
  questionIds: string[],
  run: { askerIds: string[]; texts: string[]; since: string },
): Promise<string | undefined> {
  const asked = await service
    .from("questions")
    .select("id")
    .in("asker_user_id", run.askerIds)
    .in("text", run.texts)
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

  const questions = await readQuestions();
  const since = new Date(Date.now() - 60_000).toISOString();
  const sessions = new Map<string, Session>();
  const questionIds: string[] = [];
  const answers: {
    id: string;
    status: string;
    sentences: number;
    cited: number;
  }[] = [];
  let failed = false;

  try {
    for (const question of questions) {
      let session = sessions.get(question.persona);
      if (!session) {
        session = await signIn(url, anonKey, question.persona, password);
        sessions.set(question.persona, session);
      }

      const response = await fetch(`${BASE_URL}/api/ask`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          seat: question.seat_slug,
          question: question.question,
        }),
      });
      if (!response.ok) {
        // Not measured, and no partial coverage: a check that couldn't finish hands the README nothing.
        failed = true;
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        console.log(
          `✗ ${question.id}: POST /api/ask answered HTTP ${response.status}${body.error ? ` (${body.error})` : ""}: no coverage measured`,
        );
        return;
      }

      const result = AskResult.parse(await response.json());
      questionIds.push(result.questionId);
      if (result.status === "answered") {
        // Every sentence the engine kept cites a retrieved note (docs/SPEC.md → F2); the check counts the ones that
        // still do, so a sentence without a source would show up here as coverage under 100%.
        const sentences = result.sentences.length;
        const cited = result.sentences.filter(
          (sentence) => sentence.citations.length > 0,
        ).length;
        answers.push({ id: question.id, status: "answered", sentences, cited });
        console.log(
          `✓ ${question.id}: answered — ${sentences} sentence(s), ${cited} with a source`,
        );
      } else {
        answers.push({
          id: question.id,
          status: "abstained",
          sentences: 0,
          cited: 0,
        });
        console.log(`✓ ${question.id}: abstained — no sentence to cite`);
      }
    }

    const sentences = answers.reduce((sum, row) => sum + row.sentences, 0);
    const cited = answers.reduce((sum, row) => sum + row.cited, 0);
    const coverage =
      sentences === 0 ? "—" : `${Math.round((cited / sentences) * 100)}%`;
    console.log(
      `\n${cited} / ${sentences} sentences cite a source note (${coverage}) over ${questions.length} questions`,
    );
    reportMetrics({ citations: { sentences, cited } });
  } finally {
    const problem = await cleanUp(service, questionIds, {
      askerIds: [...new Set([...sessions.values()].map((s) => s.userId))],
      texts: questions.map((question) => question.question),
      since,
    });
    if (problem) {
      failed = true;
      console.log(
        `✗ the cleanup failed (${problem}): the demo data may not be as it was`,
      );
    } else {
      console.log("✓ the demo data is back as it was");
    }
    process.exitCode = failed ? 1 : 0;
  }
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
