// #36 acceptance check (docs/SPEC.md → F5): a later notice updates last year's note instead of adding a second one.
// a26 adds seed/notice-2026.sample.pdf the way the browser sends it (lib/ingest, lib/redact) to POST /api/import, which
// marks its deadline card similar to smash-2025-hokenjo; a26 publishes it with 「更新する」 (supersedes), and q01 then
// cites the 2026 note with the rule change flagged against the 2025 note it replaced, which stays readable as history.
// Also the database's refusals of an update it must not make (0010), each saving nothing.
// Runs against the seeded database (0010 applied) and a running dev server, with Ollama (the cards' and the note's
// embeddings, the search) and the Claude key (the cards and q01's answer: two Sonnet calls, a few cents):
//   pnpm dev            (in another terminal)
//   pnpm test:supersede
// The reads that must see past a26's own rows use the service-role key, which only scripts/ may hold. Everything this
// check creates is removed afterwards (deleting the 2026 note clears smash-2025-hokenjo's superseded_by), and it says
// the demo data is back only when it is. Don't run it during a rehearsal: it answers a26's q01 and removes a26's q01
// questions from the last minutes, and until its cleanup q01 answers from the 2026 note for everyone.
// Counts, ids, kinds, dates and the flag only: never a card's, note's or answer's text, never an email.
import { readFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  AskResult,
  ImportResponse,
  type PublishCard,
  PublishResponse,
} from "@/lib/contracts";
import { extractPdf } from "@/lib/ingest/pdf";
import { redactText } from "@/lib/redact/redact";

const BASE_URL = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const SEAT = "smash-kaikei";
const OLD = "smash-2025-hokenjo"; // the 2025 deadline the notice moves (seed/notes.csv)
const OTHER_SEAT_NOTE = "gakusai-2025-hokenjo"; // 学祭実行委員会's, readable by a26 (institution scope)
const OTHER_KIND_NOTE = "smash-2025-ryoshusho"; // the seat's own, but a rule_of_thumb, for the whole club (group)
const Q01 = "模擬店の保健所申請、いつまで？"; // seed/questions.csv q01, asked by a26
const PERSONA = "smash-kaikei-2026"; // a26, the 2026 treasurer (scripts/seed.ts)

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

type Run = { seatId: string; askerId: string; since: string };

// a26's notes at the seat from this run: the notice is the only file note a26 writes here. Never a note it didn't write.
async function runNotes(service: SupabaseClient, run: Run) {
  return service
    .from("notes")
    .select("id")
    .eq("seat_id", run.seatId)
    .eq("author_user_id", run.askerId)
    .eq("source", "file")
    .gte("created_at", run.since);
}

// Removes what this run created: a26's q01 questions at the seat since it started (their answers rows go with them,
// and the prompts they started, should q01 have abstained), then a26's notes from the run, which clears the old note's
// superseded_by (on delete set null, 0001). Answers what went wrong, or undefined.
async function cleanUp(
  service: SupabaseClient,
  run: Run,
): Promise<string | undefined> {
  const asked = await service
    .from("questions")
    .select("id")
    .eq("asker_user_id", run.askerId)
    .eq("seat_id", run.seatId)
    .eq("text", Q01)
    .gte("created_at", run.since);
  if (asked.error) return `find the run's questions: ${asked.error.code}`;
  const questionIds = (asked.data ?? []).map((row) => row.id);
  if (questionIds.length > 0) {
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
  const notes = await runNotes(service, run);
  if (notes.error) return `find the run's notes: ${notes.error.code}`;
  const noteIds = (notes.data ?? []).map((row) => row.id);
  if (noteIds.length > 0) {
    const { error } = await service.from("notes").delete().in("id", noteIds);
    if (error) return `delete notes: ${error.code}`;
  }
  const old = await service
    .from("notes")
    .select("superseded_by")
    .eq("id", OLD)
    .single();
  if (old.error) return `read ${OLD}: ${old.error.code}`;
  if (old.data.superseded_by !== null) return `${OLD} is still superseded`;
  return undefined;
}

async function main(): Promise<void> {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const service = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const a26 = createClient(url, env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: session, error: signInError } =
    await a26.auth.signInWithPassword({
      email: `${PERSONA}@example.com`,
      password: env("DEMO_PASSWORD"),
    });
  if (signInError || !session.session) {
    throw new Error(`sign in as a26: ${signInError?.code ?? "no session"}`);
  }
  const token = session.session.access_token;
  const seat = await service
    .from("seats")
    .select("id")
    .eq("slug", SEAT)
    .single();
  if (seat.error) throw new Error(`read the seat: ${seat.error.code}`);

  const before = await service
    .from("notes")
    .select("superseded_by, status")
    .eq("id", OLD)
    .single();
  if (before.error) throw new Error(`read ${OLD}: ${before.error.code}`);
  if (before.data.superseded_by !== null || before.data.status !== "live") {
    throw new Error(`${OLD} isn't live and current: run pnpm demo:reset first`);
  }

  // A minute of slack, in case this laptop's clock is ahead of the database's.
  const run: Run = {
    seatId: seat.data.id,
    askerId: session.user.id,
    since: new Date(Date.now() - 60_000).toISOString(),
  };
  let finished = false; // every step ran: an early stop or a thrown error never reads as "all passed"

  try {
    // 1. a26 adds the notice (POST /api/import): only the redacted text leaves, as from the browser.
    const file = new Blob([
      await readFile(
        new URL("../seed/notice-2026.sample.pdf", import.meta.url),
      ),
    ]);
    const redacted = redactText((await extractPdf(file)).text);
    const imported = await call("/api/import", {
      token,
      body: {
        seat: SEAT,
        kind: "file",
        fileType: "pdf",
        text: redacted.text,
        redaction: redacted.counts,
      },
    });
    const response = ImportResponse.safeParse(imported.body);
    const duplicate = response.success
      ? response.data.duplicates.find((found) => found.noteId === OLD)
      : undefined;
    const card =
      duplicate && response.success
        ? response.data.cards[duplicate.card]
        : undefined;
    check(
      `the notice's deadline card is marked similar to ${OLD}`,
      imported.status === 200 &&
        card?.kind === "deadline" &&
        card.deadline_date === "2026-10-19" &&
        duplicate?.scope === "successor",
      response.success
        ? `HTTP ${imported.status}, ${response.data.cards.length} card(s), duplicates ${JSON.stringify(
            response.data.duplicates.map((found) => [
              found.card,
              found.noteId,
              Number(found.similarity.toFixed(3)),
              found.scope,
            ]),
          )}`
        : `HTTP ${imported.status}`,
    );
    if (!card || !duplicate) return;
    const update: PublishCard = {
      ...card,
      scope: card.suggested_scope,
      supersedes: OLD,
    };
    const publish = (cards: PublishCard[]) =>
      call("/api/handover/publish", { token, body: { seat: SEAT, cards } });

    // 2. Updates the database refuses (0010), each saving nothing: another seat's note, another kind, a narrower scope
    //    (a treasurers-only note over the club's group note), two at once.
    const refusals: [string, Awaited<ReturnType<typeof publish>>, number][] = [
      [
        "an update of another seat's note",
        await publish([{ ...update, supersedes: OTHER_SEAT_NOTE }]),
        403,
      ],
      [
        "an update of a note of another kind",
        await publish([{ ...update, supersedes: OTHER_KIND_NOTE }]),
        403,
      ],
      [
        "a narrower update of a group note",
        await publish([
          {
            ...update,
            kind: "rule_of_thumb",
            scope: "successor",
            supersedes: OTHER_KIND_NOTE,
          },
        ]),
        403,
      ],
      ["two cards updating one note", await publish([update, update]), 400],
    ];
    for (const [what, result, status] of refusals) {
      check(
        `refuses ${what}`,
        result.status === status,
        `HTTP ${result.status}`,
      );
    }
    const leftover = await runNotes(service, run);
    check(
      "the refusals saved no note",
      !leftover.error && leftover.data.length === 0,
      leftover.error ? leftover.error.code : `${leftover.data.length} note(s)`,
    );

    // 3. 「更新する」: the 2026 note replaces the 2025 one.
    const published = await publish([update]);
    const noteIds = PublishResponse.safeParse(published.body);
    const newId = noteIds.success ? noteIds.data.noteIds[0] : undefined;
    check(
      "a26 publishes the card with 「更新する」",
      published.status === 200 && Boolean(newId),
      `HTTP ${published.status}`,
    );
    if (!newId) return;
    const old = await service
      .from("notes")
      .select("superseded_by, status")
      .eq("id", OLD)
      .single();
    check(
      `${OLD} is superseded by the 2026 note and still live`,
      !old.error &&
        old.data.superseded_by === newId &&
        old.data.status === "live",
    );
    const stored = await service
      .from("notes")
      .select("supersedes, term_order, byline, kind, deadline_date, source")
      .eq("id", newId)
      .single();
    check(
      "the 2026 note is a26's, signed 「2026年度 会計」, and stores no supersedes",
      !stored.error &&
        stored.data.supersedes === null &&
        stored.data.term_order === 2026 &&
        stored.data.byline === "2026年度 会計" &&
        stored.data.deadline_date === "2026-10-19" &&
        stored.data.source === "file",
    );

    // 4. q01 now cites the 2026 note, with the rule change against the note it replaced.
    const asked = await call("/api/ask", {
      token,
      body: { seat: SEAT, question: Q01 },
    });
    const result = AskResult.safeParse(asked.body);
    const answered =
      result.success && result.data.status === "answered"
        ? result.data
        : undefined;
    const cited = new Set(
      (answered?.sentences ?? []).flatMap((sentence) =>
        sentence.citations.map((citation) => citation.noteId),
      ),
    );
    check(
      "q01 cites the 2026 note and not the one it replaced",
      asked.status === 200 && cited.has(newId) && !cited.has(OLD),
      `HTTP ${asked.status}, ${answered ? `cites ${[...cited].map((id) => (id === newId ? "the 2026 note" : id)).join(", ")}` : result.success ? result.data.status : "not an AskResult"}`,
    );
    check(
      "q01 flags the rule change in 2026, 10/20 → 10/19",
      answered?.ruleChange?.termLabel === "2026" &&
        answered.ruleChange.summary === "10/20 → 10/19",
      answered?.ruleChange
        ? `${answered.ruleChange.termLabel}: ${answered.ruleChange.summary}`
        : "no flag",
    );

    // 5. The old note stays history: its stamp still opens for a26.
    const history = await call(`/api/notes/${OLD}`, { token });
    check(
      `a26 still opens ${OLD}`,
      history.status === 200,
      `HTTP ${history.status}`,
    );
    finished = true;
  } finally {
    const problem = await cleanUp(service, run);
    const outcome = !finished
      ? "stopped early"
      : failed
        ? "failed"
        : "all passed";
    const passed = finished && !failed && !problem;
    console.log(
      problem
        ? `\n✗ #36 check: ${checks} checks, ${outcome}, but the cleanup failed (${problem}): the demo data may not be as it was`
        : `\n${passed ? "✓" : "✗"} #36 check: ${checks} checks, ${outcome} (the demo data is back as it was)`,
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
