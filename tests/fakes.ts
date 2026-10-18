// Fakes for the engine's offline tests: a model that gives one reply (no network, no key), a Supabase client that
// answers from a script, and q01's notes as findNotes() returns them to a26 from the seed (seed/notes.csv; similarities
// from tests/retrieve.test.ts's live run).
import type { SupabaseClient } from "@supabase/supabase-js";
import { MockLanguageModelV4 } from "ai/test";
import type { FoundNote } from "@/lib/engine/retrieve";

export type Result = { data: unknown; error: { code: string } | null };
export type Call = [method: string, ...args: unknown[]];

// A PostgREST query: every call is recorded, and it answers with one result, awaited or through maybeSingle().
function query(result: Result, calls: Call[]) {
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push([method, ...args]);
      return chain;
    };
  const chain = Object.assign(Promise.resolve(result), {
    select: record("select"),
    insert: record("insert"),
    update: record("update"),
    eq: record("eq"),
    gte: record("gte"),
    is: record("is"),
    in: record("in"),
    or: record("or"),
    order: record("order"),
    limit: record("limit"),
    maybeSingle: async () => result,
    single: async () => result,
  });
  return chain;
}

// A client whose queries answer in order, per table, and whose functions answer per name: one result for every call,
// or a list taken in order. Every query and call is recorded, so a test can see what was read and written.
export function stubClient(
  tables: Record<string, Result[]>,
  functions: Record<string, Result | Result[]> = {},
) {
  const calls: Record<string, Call[][]> = {};
  const rpcCalls: [name: string, args: unknown][] = [];
  const client = {
    from(table: string) {
      const result = tables[table]?.shift();
      if (!result) throw new Error(`unexpected query on ${table}`);
      const queryCalls: Call[] = [];
      calls[table] = [...(calls[table] ?? []), queryCalls];
      return query(result, queryCalls);
    },
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push([name, args]);
      const scripted = functions[name];
      const result = Array.isArray(scripted) ? scripted.shift() : scripted;
      if (!result) throw new Error(`unexpected call to ${name}`);
      return result;
    },
  };
  return { client: client as unknown as SupabaseClient, calls, rpcCalls };
}

export function fakeModel(reply: unknown, finish: "stop" | "length" = "stop") {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text: JSON.stringify(reply) }],
      finishReason: { unified: finish, raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    },
  });
}

// What the model was asked: the user message's text.
export function promptText(model: ReturnType<typeof fakeModel>): string {
  return promptTexts(model)[0];
}

// What the model was asked in each call, in order.
export function promptTexts(model: ReturnType<typeof fakeModel>): string[] {
  return model.doGenerateCalls.map((call) =>
    call.prompt
      .flatMap((message) => (message.role === "user" ? message.content : []))
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n"),
  );
}

// The seats' ids: Smash's 会計 is the seat q01 is asked at.
export const SMASH_KAIKEI = "00000000-0000-4000-8000-000000000001";
export const GAKUSAI_MOGITEN = "00000000-0000-4000-8000-000000000002";

// Best first, as findNotes() keeps them: the 2024 note, the 学祭実行委員会 note for the whole university, the 2025 note.
export const q01Notes: FoundNote[] = [
  {
    id: "smash-2024-hokenjo",
    seat_id: SMASH_KAIKEI,
    term_order: 2024,
    term_label: "2024",
    byline: "2024年度 会計",
    kind: "deadline",
    title: "模擬店の保健所申請",
    body: "学祭の模擬店は保健所への臨時出店の届出が必要。学生課でまとめて受け付けていて、2024年の締切は10月27日だった。",
    deadline_date: "2024-10-27",
    lang: "ja",
    similarity: 0.771,
  },
  {
    id: "gakusai-2025-hokenjo",
    seat_id: GAKUSAI_MOGITEN,
    term_order: 2025,
    term_label: "2025",
    byline: "2025年度 模擬店担当",
    kind: "rule_of_thumb",
    title: "模擬店には保健所への届出が必要",
    body: "模擬店を出す団体は保健所への臨時出店の届出が必要です。手続きは学生課でまとめて受け付けます。締切は学生課の掲示で確認してください。",
    deadline_date: null,
    lang: "ja",
    similarity: 0.723,
  },
  {
    id: "smash-2025-hokenjo",
    seat_id: SMASH_KAIKEI,
    term_order: 2025,
    term_label: "2025",
    byline: "2025年度 会計",
    kind: "deadline",
    title: "保健所申請の締切が早くなった",
    body: "2025年から締切が学祭の3週間前（10月20日）に変わった。学生課の掲示板にしか出ていなかったので、10月に入ったら必ず確認すること。",
    deadline_date: "2025-10-20",
    lang: "ja",
    similarity: 0.589,
  },
];
