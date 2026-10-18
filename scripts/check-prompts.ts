// #40 acceptance check (docs/SPEC.md → F6): the handover prompts and the scope picker's reader counts.
// - GET /api/handover/readers: the counts match the seed world for all four scopes, for each holder of 会計; anyone else
//   is refused.
// - GET /api/handover/prompts: three prompts, demand → gap → required → core. With one demand prompt it comes first, worded
//   「後輩の1人がこれを質問しました」. A topic a recent note covers is skipped for the holder whose term has that note.
// Runs against the seeded database and a running dev server, with 0011_handover_prompts applied:
//   pnpm dev          (in another terminal)
//   pnpm test:prompts
// As a26 it saves one q04 question and routes it as POST /api/ask did before 0012 (route_question(), no model
// call), and adds the old handover's two missing items with POST /api/handover/prompts (gap 1: 保健所, which a recent
// note covers for a25 and a24; gap 2: the account, which nothing covers). Afterwards it removes exactly what it created
// with the service role, which only scripts/ may hold, and says the demo data is back only when it is. Don't run it
// during a rehearsal: a25's inbox holds the question while it runs.
// Counts, ids, personas, reasons and checklist topics only: never a prompt's text, never an email.
import { readFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";
import { createTranslator } from "next-intl";
import {
  GapResponse,
  type HandoverPrompt,
  PromptKind,
  PromptsResponse,
  ReadersResponse,
  Scope,
} from "@/lib/contracts";
import { mockImport, mockReaders } from "@/lib/mocks";
import ja from "@/messages/ja.json";

const BASE_URL = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const SEAT = "smash-kaikei";

// scripts/seed.ts gives every persona one account at <key>@example.com.
const EMAIL: Record<string, string> = {
  a24: "smash-kaikei-2024",
  a25: "smash-kaikei-2025",
  a26: "smash-kaikei-2026",
  b: "keion-member",
  x: "yamate-outsider",
};

// People besides the caller in the seed world (scripts/seed.ts). a24, a25 and a26 hold 会計 for 2024, 2025 and 2026 and
// belong to Smash. f25, ex25 and lab25 hold seats at other groups of みなと大学, b belongs to 軽音サークル there, and x to a
// group at やまて大学. So: successor = later holders; group = the other two treasurers; institution = + f25, ex25, lab25
// and b; public = every other account. lib/mocks.ts gives a25's numbers to the screens.
const READERS: Record<string, Record<Scope, number>> = {
  a24: { successor: 2, group: 2, institution: 6, public: 7 },
  a25: mockReaders,
  a26: { successor: 0, group: 2, institution: 6, public: 7 },
};

// The old handover's missing items (lib/mocks.ts), as 「先輩に聞く」 adds them.
const [GAP_1, GAP_2] = mockImport.missing.map((item) => item.prompt);

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

type Persona = {
  persona: string;
  token: string;
  userId: string;
  db: SupabaseClient;
};

async function signIn(
  url: string,
  anonKey: string,
  persona: string,
  password: string,
): Promise<Persona> {
  const db = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.signInWithPassword({
    email: `${EMAIL[persona]}@example.com`,
    password,
  });
  if (error || !data.session) {
    throw new Error(`sign in as ${persona}: ${error?.code ?? "no session"}`);
  }
  return {
    persona,
    token: data.session.access_token,
    userId: data.user.id,
    db,
  };
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

async function readCsv(path: string): Promise<Record<string, string>[]> {
  const text = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  }) as Record<string, string>[];
}

// What a list says, without its texts: demand, gap 1 / gap 2, or the checklist topic (seed/core-prompts.csv).
function describe(
  prompts: HandoverPrompt[],
  topics: Map<string, string>,
  demandId?: string,
): string {
  return prompts
    .map((prompt) => {
      if (prompt.id === demandId) return `demand (askCount ${prompt.askCount})`;
      if (prompt.text === GAP_1) return "gap 1";
      if (prompt.text === GAP_2) return "gap 2";
      return topics.get(prompt.text) ?? `${prompt.reason} (other)`;
    })
    .join(", ");
}

// The reasons follow demand → gap → required → core.
function ranked(prompts: HandoverPrompt[]): boolean {
  const order = prompts.map((prompt) =>
    PromptKind.options.indexOf(prompt.reason),
  );
  return order.every((rank, i) => i === 0 || order[i - 1] <= rank);
}

type Created = { questionId?: string; promptIds: string[] };

// Removes what this run created: its demand prompt (the route goes with it) and the gap prompts it added that weren't
// there before, then its question. Answers what went wrong, or undefined.
async function cleanUp(
  service: SupabaseClient,
  created: Created,
): Promise<string | undefined> {
  if (created.promptIds.length > 0) {
    const { error } = await service
      .from("prompts")
      .delete()
      .in("id", created.promptIds);
    if (error) return `delete prompts: ${error.code}`;
  }
  if (created.questionId) {
    const { error } = await service
      .from("questions")
      .delete()
      .eq("id", created.questionId);
    if (error) return `delete the question: ${error.code}`;
  }
  return undefined;
}

// The seat's questions and its prompts by kind, to tell whether the demo data is back.
async function snapshot(
  service: SupabaseClient,
  seatId: string,
): Promise<string> {
  const [questions, prompts] = await Promise.all([
    service.from("questions").select("id").eq("seat_id", seatId),
    service.from("prompts").select("id, kind, retired").eq("seat_id", seatId),
  ]);
  if (questions.error || prompts.error)
    throw new Error("read the seat's questions and prompts");
  const kinds = new Map<string, number>();
  for (const row of prompts.data ?? []) {
    const key = `${row.kind}${row.retired ? " (retired)" : ""}`;
    kinds.set(key, (kinds.get(key) ?? 0) + 1);
  }
  return [
    `questions ${questions.data?.length ?? 0}`,
    ...[...kinds].sort().map(([kind, n]) => `${kind} ${n}`),
  ].join(", ");
}

async function main(): Promise<void> {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const password = env("DEMO_PASSWORD");
  const service = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const t = createTranslator({ locale: "ja", messages: ja });

  const q04 = (await readCsv("seed/questions.csv")).find(
    (row) => row.id === "q04",
  );
  if (!q04) throw new Error("seed/questions.csv has no q04");
  const topics = new Map(
    (await readCsv("seed/core-prompts.csv"))
      .filter((row) => row.seat_type === "club_role")
      .map((row) => [row.text_ja, row.topic]),
  );
  const seat = await service
    .from("seats")
    .select("id")
    .eq("slug", SEAT)
    .single();
  if (seat.error) throw new Error(`read the seat: ${seat.error.code}`);
  const seatId: string = seat.data.id;

  // What covers what rests on the seed's notes at 会計 (seed/notes.csv), all live and none replaced. A rehearsal's
  // 「更新する」, withdrawal or new note changes that, so stop before writing anything.
  const seedNotes = (await readCsv("seed/notes.csv"))
    .filter((row) => row.seat_slug === SEAT)
    .map((row) => row.id);
  const notes = await service
    .from("notes")
    .select("id, status, superseded_by")
    .eq("seat_id", seatId);
  if (notes.error)
    throw new Error(`read the seat's notes: ${notes.error.code}`);
  const asSeeded =
    notes.data.length === seedNotes.length &&
    notes.data.every(
      (note) =>
        seedNotes.includes(note.id) &&
        note.status === "live" &&
        note.superseded_by === null,
    );
  if (!asSeeded) {
    throw new Error(
      `会計 holds ${notes.data.length} notes, not the seed's ${seedNotes.length} live ones: run pnpm demo:reset first`,
    );
  }

  const people = Object.fromEntries(
    await Promise.all(
      Object.keys(EMAIL).map(
        async (persona) =>
          [persona, await signIn(url, anonKey, persona, password)] as const,
      ),
    ),
  );
  const prompts = async (persona: Persona) => {
    const response = await call(`/api/handover/prompts?seat=${SEAT}`, {
      token: persona.token,
    });
    const parsed = PromptsResponse.safeParse(response.body);
    return {
      status: response.status,
      prompts: parsed.success ? parsed.data.prompts : undefined,
    };
  };

  const before = await snapshot(service, seatId);
  // Gap prompts with these texts that someone added before this run (a rehearsal's 「先輩に聞く」) stay afterwards.
  const earlier = await service
    .from("prompts")
    .select("id")
    .eq("seat_id", seatId)
    .eq("kind", "gap")
    .eq("retired", false)
    .in("text", [GAP_1, GAP_2]);
  if (earlier.error)
    throw new Error(`read the seat's gap prompts: ${earlier.error.code}`);
  const kept = new Set((earlier.data ?? []).map((row) => row.id));
  const created: Created = { promptIds: [] };
  let finished = false; // every step ran: an early stop or a thrown error never reads as "all passed"

  try {
    // 1. The scope picker's counts, as each holder of 会計 publishing there would see them.
    for (const [persona, expected] of Object.entries(READERS)) {
      const got: Partial<Record<Scope, number | string>> = {};
      for (const scope of Scope.options) {
        const response = await call(
          `/api/handover/readers?seat=${SEAT}&scope=${scope}`,
          {
            token: people[persona].token,
          },
        );
        // A count and nothing else: never who.
        const parsed = ReadersResponse.safeParse(response.body);
        const countOnly =
          parsed.success &&
          Object.keys(response.body as object).join() === "count";
        got[scope] = countOnly ? parsed.data.count : `HTTP ${response.status}`;
      }
      check(
        `${persona}'s reader counts match the seed for all four scopes`,
        Scope.options.every((scope) => got[scope] === expected[scope]),
        Scope.options.map((scope) => `${scope} ${got[scope]}`).join(", "),
      );
    }
    for (const persona of ["b", "x"]) {
      const response = await call(
        `/api/handover/readers?seat=${SEAT}&scope=group`,
        { token: people[persona].token },
      );
      check(
        `${persona} holds no term at 会計: refused`,
        response.status === 403,
        `HTTP ${response.status}`,
      );
    }
    const signedOut = await call(
      `/api/handover/readers?seat=${SEAT}&scope=group`,
    );
    check(
      "a signed-out client gets no count",
      signedOut.status === 401,
      `HTTP ${signedOut.status}`,
    );
    const unknown = await call(
      "/api/handover/readers?seat=no-such-seat&scope=group",
      { token: people.a25.token },
    );
    check(
      "an unknown seat: not found",
      unknown.status === 404,
      `HTTP ${unknown.status}`,
    );

    // 2. Before anything is asked: the checklist in its order, less what a recent note covers. 「領収書は月末にまとめて精算」
    //    (2025) covers receipts for a25 and a24, not for a26, who holds 2026.
    const firstLists: Record<string, string> = {
      a24: "deadlines, money, keys",
      a25: "deadlines, money, keys",
      a26: "deadlines, money, receipts",
    };
    for (const [persona, expected] of Object.entries(firstLists)) {
      const { status, prompts: list } = await prompts(people[persona]);
      const got = list ? describe(list, topics) : `HTTP ${status}`;
      check(
        `${persona} is asked the checklist, less what their recent notes cover`,
        got === expected,
        got,
      );
    }

    // 3. a26 asks q04 and nobody knows: saved as waiting, then routed, as POST /api/ask did before 0012.
    const saved = await people.a26.db
      .from("questions")
      .insert({
        asker_user_id: people.a26.userId,
        seat_id: seatId,
        text: q04.question,
        lang: "ja",
        status: "waiting",
      })
      .select("id")
      .single();
    if (saved.error)
      throw new Error(`save a26's question: ${saved.error.code}`);
    created.questionId = saved.data.id;
    const routed = await people.a26.db.rpc("route_question", {
      question: saved.data.id,
      prompt_text: q04.question,
    });
    const routing = (
      Array.isArray(routed.data) ? routed.data[0] : routed.data
    ) as { prompt_id?: string; routed_to?: number } | undefined;
    if (routing?.prompt_id) created.promptIds.push(routing.prompt_id);
    const demandId = routing?.prompt_id;
    check(
      "a26's question becomes a demand prompt routed to one predecessor",
      !routed.error && Boolean(demandId) && routing?.routed_to === 1,
      routed.error
        ? `error ${routed.error.code}`
        : `routed to ${routing?.routed_to}`,
    );
    if (!demandId) return;

    // 4. 「先輩に聞く」 on the old handover's two missing items, as a26.
    for (const text of [GAP_1, GAP_2]) {
      const response = await call("/api/handover/prompts", {
        token: people.a26.token,
        body: { seat: SEAT, text },
      });
      const parsed = GapResponse.safeParse(response.body);
      if (parsed.success && !kept.has(parsed.data.promptId))
        created.promptIds.push(parsed.data.promptId);
      check(
        `a26 adds ${text === GAP_1 ? "gap 1" : "gap 2"} with 「先輩に聞く」`,
        response.status === 200 && parsed.success,
        `HTTP ${response.status}${parsed.success && kept.has(parsed.data.promptId) ? ", already there before this run" : ""}`,
      );
    }

    // 5. a25 is asked the newcomer's question first, then the open gap; gap 1 is covered by a25's 2025 deadline note.
    const a25 = await prompts(people.a25);
    const first = a25.prompts?.[0];
    const line = first ? t("handover.reasonDemand", { n: first.askCount }) : "";
    check(
      "a25's first prompt is a26's question, by demand, asked once",
      first?.id === demandId &&
        first.reason === "demand" &&
        first.askCount === 1,
      a25.prompts
        ? describe(a25.prompts, topics, demandId)
        : `HTTP ${a25.status}`,
    );
    check(
      "its reason reads 「後輩の1人がこれを質問しました」",
      line === "後輩の1人がこれを質問しました",
      line,
    );
    check(
      "then gap 2, then the checklist: gap 1 is covered by a25's own 2025 note",
      a25.prompts !== undefined &&
        describe(a25.prompts, topics, demandId) ===
          "demand (askCount 1), gap 2, deadlines",
    );

    // 6. The others: the question isn't routed to them; gap 1 is still asked of a26 (2026), not of a24 (their 2024 note).
    const lists: Record<string, string> = {
      a24: "gap 2, deadlines, money",
      a26: "gap 1, gap 2, deadlines",
    };
    for (const [persona, expected] of Object.entries(lists)) {
      const { status, prompts: list } = await prompts(people[persona]);
      const got = list ? describe(list, topics, demandId) : `HTTP ${status}`;
      check(
        `${persona} gets the gap prompts in order and no demand prompt`,
        got === expected,
        got,
      );
    }
    for (const persona of ["b", "x"]) {
      const { status, prompts: list } = await prompts(people[persona]);
      check(
        `${persona} holds no term at 会計: no prompts`,
        status === 200 && list?.length === 0,
        `HTTP ${status}, ${list?.length ?? "?"} prompts`,
      );
    }
    const anonymous = await call(`/api/handover/prompts?seat=${SEAT}`);
    check(
      "a signed-out client gets no prompts",
      anonymous.status === 401,
      `HTTP ${anonymous.status}`,
    );
    for (const persona of ["a24", "a25", "a26"]) {
      const { prompts: list } = await prompts(people[persona]);
      check(
        `${persona}'s list follows demand → gap → required → core`,
        list !== undefined && ranked(list),
      );
    }
    finished = true;
  } finally {
    const problem = await cleanUp(service, created);
    const after = await snapshot(service, seatId);
    check(
      "the demo data is back: this run's question, demand prompt and gap prompts are gone",
      !problem && after === before,
      problem ?? after,
    );
    console.log(
      `\n${failed || !finished ? "✗" : "✓"} ${checks} checks${finished ? "" : ", stopped early"}`,
    );
    if (failed || !finished) process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
