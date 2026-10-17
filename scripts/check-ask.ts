// #7 acceptance check (docs/SPEC.md → F3): asking q04 as the 2026 treasurer creates one route, for the 2025
// treasurer and nobody else. Runs against the seeded database and a running dev server:
//   pnpm dev          (in another terminal)
//   pnpm test:ask
// The ask goes over HTTP with a26's own token, as a phone would, so the route handler and RLS are exercised for
// real. The reads that must see past a persona's own rows use the service-role key, which only scripts/ may hold.
// Everything this check creates is removed afterwards, and it says the demo data is back only when it is.
// Counts, ids and personas only: never the question text, never an email.
import { readFile } from "node:fs/promises";
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

type Created = { questionIds: string[]; promptIds: string[] };

// Removes what this run created: the demand prompts it was told about (their routes go with them) and its questions,
// with any q04 one of its askers saved in a request that failed before routing. Answers what went wrong, or undefined.
async function cleanUp(
  service: SupabaseClient,
  created: Created,
  askerIds: string[],
  text: string,
  since: string,
): Promise<string | undefined> {
  const unrouted = await service
    .from("questions")
    .select("id")
    .in("asker_user_id", askerIds)
    .eq("text", text)
    .is("prompt_id", null)
    .gte("created_at", since);
  if (unrouted.error) return `find unrouted questions: ${unrouted.error.code}`;
  const questionIds = [
    ...new Set([
      ...created.questionIds,
      ...(unrouted.data ?? []).map((row) => row.id),
    ]),
  ];
  if (created.promptIds.length > 0) {
    const { error } = await service
      .from("prompts")
      .delete()
      .in("id", created.promptIds);
    if (error) return `delete prompts: ${error.code}`;
  }
  if (questionIds.length > 0) {
    const { error } = await service
      .from("questions")
      .delete()
      .in("id", questionIds);
    if (error) return `delete questions: ${error.code}`;
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

  // A minute of slack, in case this laptop's clock is ahead of the database's.
  const since = new Date(Date.now() - 60_000).toISOString();
  const asker = await signIn(url, anonKey, question.persona, password);
  const reachable = await signIn(url, anonKey, REACHABLE, password);
  const stranger = await signIn(url, anonKey, STRANGER, password);
  const created: Created = { questionIds: [], promptIds: [] };

  try {
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
    check("it abstains (F2 isn't in yet)", result.status === "abstained");
    if (result.status !== "abstained") return;
    created.questionIds.push(result.questionId);
    const promptId = result.promptId;
    if (promptId) created.promptIds.push(promptId);
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
    const seat = await service
      .from("seats")
      .select("id")
      .eq("slug", question.seat_slug)
      .single();
    if (seat.error) throw new Error(`read the seat: ${seat.error.code}`);
    check(
      "the prompt belongs to the seat asked",
      prompt.data?.seat_id === seat.data.id,
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
      check(`${persona} sees no route`, (seenRoute.data ?? []).length === 0);
      check(
        `${persona} can't read the demand prompt`,
        (seenPrompt.data ?? []).length === 0,
      );
    }

    // 5. A signed-out caller is refused, and a question from someone who holds no seat at the seat routes nowhere.
    const signedOut = await ask(undefined, question);
    check("a signed-out caller is refused", signedOut.status === 401);

    const openBefore = await openDemandPrompts(service, seat.data.id);
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
    const openAfter = await openDemandPrompts(service, seat.data.id);
    check(
      "no demand prompt was created for it",
      openAfter === openBefore,
      `${openAfter - openBefore} new`,
    );
  } finally {
    // 6. Leave the demo database as it was.
    const problem = await cleanUp(
      service,
      created,
      [asker.userId, stranger.userId],
      question.question,
      since,
    );
    console.log(
      problem
        ? `\n✗ #7 check: ${checks} checks, ${failed ? "failed" : "all passed"}, but the cleanup failed (${problem}): the demo data may not be as it was`
        : `\n${failed ? "✗" : "✓"} #7 check: ${checks} checks, ${failed ? "failed" : "all passed"} (the demo data is back as it was)`,
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
