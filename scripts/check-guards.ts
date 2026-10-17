// 0007 acceptance check (the database hardening after the F3.8 leak audit), against the shared project with 0007
// applied and `pnpm seed` run since. Everything goes straight through PostgREST with a persona's own token, as
// someone skipping the routes would, so only the database's rules stand:
//   - a25 can sign only the byline its holding keeps (「2025年度 会計」): 「2025年度 部長」 or anything added is refused;
//   - a note with contact details or credentials in its title, body or provenance is refused (DD001), and one that
//     lib/engine/guard.ts lets through (＠500円, opening hours) is accepted;
//   - deliver_answer refuses a sentence with a phone number, and stores the answer rebuilt from known parts: no
//     rule-change flag, no extra keys.
//   pnpm test:guards
// Writes: a26's question with its prompt and route, two notes of a25's and a26's answers row, all removed afterwards.
// Don't run it during a rehearsal: it puts a slip in a25's inbox.
// Counts, ids, personas and error codes only: never a note's or a question's text, never an email.
import { isDeepStrictEqual } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SEAT = "smash-kaikei";
const BYLINE = "2025年度 会計"; // a25's 2025 holding at 会計, worded by the club_role label pack
const TERM = 2025;
const QUESTION = "決算後に申請された領収書はどうすれば良いですか？"; // seed/questions.csv q04

const EMAIL: Record<string, string> = {
  a25: "smash-kaikei-2025",
  a26: "smash-kaikei-2026",
};

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

type Session = { db: SupabaseClient; userId: string };

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
    email: `${EMAIL[persona]}@example.com`,
    password,
  });
  if (error || !data.session) {
    throw new Error(`sign in as ${persona}: ${error?.message ?? "no session"}`);
  }
  return { db, userId: data.user.id };
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
  const seatId: string = seat.data.id;
  const a25 = await signIn(url, anonKey, "a25", password);
  const a26 = await signIn(url, anonKey, "a26", password);
  const created = { noteIds: [] as string[], questionIds: [] as string[] };

  // A note of a25's at the seat, written straight to the notes table: only the policy and the guard decide.
  const write = (fields: Record<string, unknown>) =>
    a25.db
      .from("notes")
      .insert({
        seat_id: seatId,
        term_order: TERM,
        author_user_id: a25.userId,
        byline: BYLINE,
        kind: "rule_of_thumb",
        title: "決算後の領収書",
        body: "少額なら予備費から出し、大きい額は次年度の会計に回す。",
        lang: "ja",
        scope: "successor",
        source: "live",
        ...fields,
      })
      .select("id");

  try {
    // 1. The seed gave a25's holding its byline.
    const holding = await a25.db
      .from("seat_holders")
      .select("byline")
      .eq("seat_id", seatId)
      .eq("user_id", a25.userId)
      .eq("term_order", TERM)
      .maybeSingle();
    check(
      `a25's 2025 holding signs with 「${BYLINE}」`,
      holding.data?.byline === BYLINE,
      holding.error ? `query failed: ${holding.error.code}` : "",
    );

    // 2. Straight to the table: a forged byline, or contact details, are refused, and nothing is written.
    const attempts = [
      ["signed 「2025年度 部長」", { byline: "2025年度 部長" }, "42501"],
      [
        "with something added to the byline",
        { byline: `${BYLINE}・顧問確認済` },
        "42501",
      ],
      [
        "with a phone number in the body",
        { body: "学生課（03-1234-5678）に電話する。" },
        "DD001",
      ],
      [
        "with a full-width phone number",
        { body: "会計の携帯は０９０−１２３４−５６７８。" },
        "DD001",
      ],
      [
        "with an email in the provenance",
        { provenance: "kaikei@example.com" },
        "DD001",
      ],
      [
        "with an @handle in the title",
        { title: "@smash_kaikei に聞く" },
        "DD001",
      ],
      [
        "with a phone number right after a time",
        { body: "学生課の受付 9:00-17:00 03-1234-5678" },
        "DD001",
      ],
      [
        "with a LINE ID",
        { body: "会計の LINE ID: smash2025 に送る。" },
        "DD001",
      ],
      ["with a PIN", { body: "金庫の暗証番号は4821。" }, "DD001"],
    ] as const;
    for (const [what, fields, code] of attempts) {
      const { data, error } = await write(fields);
      if (data) created.noteIds.push(...data.map((row) => row.id));
      check(
        `a note ${what} is refused`,
        error?.code === code,
        error ? error.code : "accepted",
      );
    }
    // What the route lets through, the database does too: ＠ as a unit price, times next to a count.
    const priced = await write({
      body: "お弁当は単価＠500円。受付 09:00〜17:00、30人まで。",
    });
    if (priced.data) created.noteIds.push(...priced.data.map((row) => row.id));
    check(
      "a note with a unit price and opening hours is accepted",
      !priced.error,
      priced.error ? priced.error.code : "",
    );

    // 3. deliver_answer: a26's question waits on a prompt routed to a25, and a25 answers it from its own note.
    const asked = await a26.db
      .from("questions")
      .insert({
        asker_user_id: a26.userId,
        seat_id: seatId,
        text: QUESTION,
        lang: "ja",
      })
      .select("id")
      .single();
    if (asked.error)
      throw new Error(`save a26's question: ${asked.error.code}`);
    const questionId: string = asked.data.id;
    created.questionIds.push(questionId);
    const routed = await a26.db.rpc("route_question", {
      question: questionId,
      prompt_text: QUESTION,
    });
    const route = Array.isArray(routed.data) ? routed.data[0] : routed.data;
    check(
      "a26's question waits on a prompt routed to a25",
      !routed.error && route?.routed_to === 1 && Boolean(route?.prompt_id),
      routed.error ? routed.error.code : `routedTo ${route?.routed_to}`,
    );
    const note = await write({});
    const noteId = note.data?.[0]?.id;
    if (noteId) created.noteIds.push(noteId);
    check(
      `a25 writes a clean note signed 「${BYLINE}」`,
      Boolean(noteId),
      note.error ? note.error.code : "",
    );
    if (!noteId || !route?.prompt_id) return;

    const citation = { noteId, byline: BYLINE, termLabel: String(TERM) };
    const answer = {
      status: "answered",
      questionId,
      language: "ja",
      live: { byline: BYLINE },
      sentences: [
        { text: "少額なら予備費から出します。", citations: [citation] },
      ],
    };
    const french = await a25.db.rpc("deliver_answer", {
      question: questionId,
      answer: { ...answer, language: "fr" },
    });
    check(
      "deliver_answer refuses a language that isn't ja or en",
      french.error?.code === "22023",
      french.error ? french.error.code : "accepted",
    );
    const phoned = await a25.db.rpc("deliver_answer", {
      question: questionId,
      answer: {
        ...answer,
        sentences: [
          {
            text: "会計の携帯 090-1234-5678 に電話する。",
            citations: [citation],
          },
        ],
      },
    });
    check(
      "deliver_answer refuses a sentence with a phone number",
      phoned.error?.code === "DD001",
      phoned.error ? phoned.error.code : "accepted",
    );
    const delivered = await a25.db.rpc("deliver_answer", {
      question: questionId,
      answer: {
        ...answer,
        ruleChange: { termLabel: "2024", summary: "締切が変わった" },
        extra: true,
        sentences: [
          {
            ...answer.sentences[0],
            extra: 1,
            citations: [{ ...citation, extra: "x" }],
          },
        ],
      },
    });
    check(
      "a25 delivers an answer that carries extras",
      !delivered.error,
      delivered.error ? delivered.error.code : "",
    );
    const stored = await a26.db
      .from("answers")
      .select("payload")
      .eq("question_id", questionId)
      .maybeSingle();
    check(
      "a26's stored answer has only the known parts: no rule-change flag, no extra keys",
      isDeepStrictEqual(stored.data?.payload, answer),
      stored.error
        ? `query failed: ${stored.error.code}`
        : `keys ${Object.keys(stored.data?.payload ?? {}).join(",")}`,
    );
    const prompt = await service
      .from("prompts")
      .select("retired")
      .eq("id", route.prompt_id)
      .single();
    const question = await service
      .from("questions")
      .select("status")
      .eq("id", questionId)
      .single();
    check(
      "the question is answered and the prompt retired",
      question.data?.status === "answered" && prompt.data?.retired === true,
    );
  } finally {
    // 4. Leave the demo database as it was: the notes and the question this run wrote, and the prompt it started.
    const problems: string[] = [];
    if (created.questionIds.length > 0) {
      const started = await service
        .from("prompts")
        .select("id")
        .in("source_question_id", created.questionIds);
      if (started.error) problems.push(`find prompts: ${started.error.code}`);
      const promptIds = (started.data ?? []).map((row) => row.id);
      if (promptIds.length > 0) {
        const { error } = await service
          .from("prompts")
          .delete()
          .in("id", promptIds);
        if (error) problems.push(`delete prompts: ${error.code}`);
      }
      const { error } = await service
        .from("questions")
        .delete()
        .in("id", created.questionIds);
      if (error) problems.push(`delete questions: ${error.code}`);
    }
    if (created.noteIds.length > 0) {
      const { error } = await service
        .from("notes")
        .delete()
        .in("id", created.noteIds);
      if (error) problems.push(`delete notes: ${error.code}`);
    }
    const passed = !failed && problems.length === 0;
    console.log(
      problems.length > 0
        ? `\n✗ 0007 check: ${checks} checks, but the cleanup failed (${problems.join("; ")})`
        : `\n${passed ? "✓" : "✗"} 0007 check: ${checks} checks, ${failed ? "failed" : "all passed"} (the demo data is back as it was)`,
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
