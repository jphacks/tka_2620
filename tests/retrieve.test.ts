// F2.1 (issue #19): finding the notes for a question. The cut is tested offline; the acceptance check runs every
// question in seed/questions.csv signed in as its persona, against the Supabase project in .env.local and bge-m3
// through Ollama, so RLS and the thresholds decide together: q01 finds both 保健所 notes, q04 finds nothing.
// The seed state is assumed (`pnpm seed` / `pnpm demo:reset`): a published live-loop answer would make q04 find it.
// Messages show note ids and similarities only, never a title, a body or a question.
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";
import { describe, expect, it } from "vitest";
import {
  closeEnough,
  type FoundNote,
  findNotes,
  MATCH,
  RELATED,
  SEARCH_K,
} from "@/lib/engine/retrieve";

// seed/questions.csv q01, asked by a26.
const QUESTION = "模擬店の保健所申請、いつまで？";

function note(id: string, similarity: number): FoundNote {
  return {
    id,
    seat_id: "00000000-0000-4000-8000-000000000001",
    term_order: 2025,
    term_label: "2025",
    byline: "2025年度 会計",
    kind: "rule_of_thumb",
    title: "title",
    body: "body",
    deadline_date: null,
    lang: "ja",
    similarity,
  };
}

describe("closeEnough", () => {
  it("finds nothing without a note or when the best note is under MATCH", () => {
    expect(closeEnough([])).toEqual([]);
    expect(closeEnough([note("a", MATCH - 0.001), note("b", 0.6)])).toEqual([]);
  });

  it("once the best note reaches MATCH, keeps the notes from RELATED up, best first", () => {
    const found = closeEnough([
      note("related", RELATED),
      note("unrelated", RELATED - 0.001),
      note("best", MATCH),
    ]);
    expect(found.map((n) => n.id)).toEqual(["best", "related"]);
  });
});

describe("findNotes", () => {
  type Call = { fn: string; args: Record<string, unknown> };

  function stubClient(
    result: { data: unknown; error: { code: string; message: string } | null },
    calls: Call[],
  ): SupabaseClient {
    const client = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return result;
      },
    };
    return client as unknown as SupabaseClient;
  }

  it("embeds the question once and searches the seat with it", async () => {
    const calls: Call[] = [];
    const embedded: string[][] = [];
    const vector = [0.25, -0.5];
    const found = await findNotes(
      stubClient(
        { data: [note("smash-2024-hokenjo", 0.77)], error: null },
        calls,
      ),
      "smash-kaikei",
      QUESTION,
      async (texts) => {
        embedded.push(texts);
        return [vector];
      },
    );

    expect(embedded).toEqual([[QUESTION]]);
    expect(calls).toEqual([
      {
        fn: "search_notes",
        args: {
          seat: "smash-kaikei",
          query_embedding: JSON.stringify(vector),
          k: SEARCH_K,
        },
      },
    ]);
    expect(found.map((n) => n.id)).toEqual(["smash-2024-hokenjo"]);
  });

  it("fails with the error code only, never the question", async () => {
    const failure = await findNotes(
      stubClient(
        {
          data: null,
          error: { code: "42501", message: `denied: ${QUESTION}` },
        },
        [],
      ),
      "smash-kaikei",
      QUESTION,
      async () => [[0]],
    ).then(
      () => undefined,
      (error: Error) => error,
    );
    expect(failure?.message).toContain("42501");
    expect(failure?.message).not.toContain(QUESTION);
  });

  it("rejects a row that isn't a note", async () => {
    await expect(
      findNotes(
        stubClient(
          { data: [{ ...note("x", 0.9), kind: "gossip" }], error: null },
          [],
        ),
        "smash-kaikei",
        QUESTION,
        async () => [[0]],
      ),
    ).rejects.toThrow();
  });
});

// The project's public URL and key, the demo password and the embedding model, from the shell or .env.local.
// Nothing else is taken from .env.local: the check acts as each persona, never with the service-role key.
const names = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "DEMO_PASSWORD",
  "OLLAMA_BASE_URL",
  "EMBED_MODEL",
] as const;
const envFile = new URL("../.env.local", import.meta.url);
const fromFile = existsSync(envFile)
  ? parseEnv(readFileSync(envFile, "utf8"))
  : {};
const env = Object.fromEntries(
  names.map((name) => [name, process.env[name] || fromFile[name] || ""]),
) as Record<(typeof names)[number], string>;
const missing: string[] = names.filter((name) => !env[name]);
if (missing.length === 0) {
  // lib/embed.ts reads these two from the environment.
  process.env.OLLAMA_BASE_URL = env.OLLAMA_BASE_URL;
  process.env.EMBED_MODEL = env.EMBED_MODEL;
  const ollamaUp = await fetch(`${env.OLLAMA_BASE_URL}/api/tags`, {
    signal: AbortSignal.timeout(2000),
  }).then(
    (response) => response.ok,
    () => false,
  );
  if (!ollamaUp) missing.push("a running Ollama");
}

// The personas of seed/questions.csv with the emails scripts/seed.ts gives them.
const EMAIL: Record<string, string> = {
  a24: "smash-kaikei-2024@example.com",
  a25: "smash-kaikei-2025@example.com",
  a26: "smash-kaikei-2026@example.com",
  b: "keion-member@example.com",
  x: "yamate-outsider@example.com",
};

type QuestionRow = {
  id: string;
  persona: string;
  seat_slug: string;
  question: string;
  expected_notes: string;
};
const questions = parse(
  readFileSync(new URL("../seed/questions.csv", import.meta.url), "utf8"),
  { columns: true, skip_empty_lines: true, bom: true },
) as QuestionRow[];

// One client per persona, as the console panes do. No signOut afterwards: its default scope is global, which would
// also sign out the demo phones.
const clients = new Map<string, Promise<SupabaseClient>>();
function signedIn(persona: string): Promise<SupabaseClient> {
  let client = clients.get(persona);
  if (!client) {
    client = (async () => {
      const db = createClient(
        env.NEXT_PUBLIC_SUPABASE_URL,
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      const email = EMAIL[persona];
      if (!email)
        throw new Error(`unknown persona ${persona}: add it to EMAIL`);
      const { error } = await db.auth.signInWithPassword({
        email,
        password: env.DEMO_PASSWORD,
      });
      if (error) {
        throw new Error(
          `${persona} doesn't sign in with DEMO_PASSWORD (has pnpm seed run?): ${error.message}`,
        );
      }
      return db;
    })();
    clients.set(persona, client);
  }
  return client;
}

describe.skipIf(missing.length > 0)(
  missing.length > 0
    ? `seed/questions.csv as each persona (skipped: ${missing.join(", ")} not set)`
    : "seed/questions.csv as each persona",
  () => {
    it.each(
      questions,
    )("$id ($persona) finds the notes expected_notes names, or none when it names none", async (row) => {
      const found = await findNotes(
        await signedIn(row.persona),
        row.seat_slug,
        row.question,
      );
      const scored = found.map((n) => `${n.id} ${n.similarity.toFixed(3)}`);
      const expected = row.expected_notes.split(";").filter(Boolean);
      if (expected.length === 0) {
        expect(scored, "notes found (none expected)").toEqual([]);
      } else {
        expect(
          found.map((n) => n.id),
          `notes found: ${scored.join(", ") || "none"}`,
        ).toEqual(expect.arrayContaining(expected));
      }
    }, 20_000);
  },
);
