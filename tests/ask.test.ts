// POST /api/ask: answered from the notes (F2.2, issue #20), or saved and routed to the live loop (F3.5, issue #7),
// joining an open prompt that asks the same thing (F2.5, issue #23).
// These tests run offline: the handler returns before it touches Supabase unless the request is well-formed, and the
// flow itself is driven through a stub client and fake models, so the database's own rules are checked by
// scripts/check-ask.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LanguageModel } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AnswerOutput,
  ApiError,
  AskResult,
  type DedupeOutput,
} from "@/lib/contracts";
import { type AskModels, askAsCaller, handleAsk } from "@/lib/engine/ask";
import { questionLang } from "@/lib/engine/lang";
import { mockAnswer, mockModelReplies, mockQuestions } from "@/lib/mocks";
import { fakeModel, promptTexts, q01Notes, SMASH_KAIKEI } from "./fakes";

// seed/questions.csv q04, asked by a26.
const QUESTION = "決算後に申請された領収書はどうすれば良いですか？";
const QUESTION_ID = "11111111-1111-4111-8111-111111111111";
const PROMPT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_PROMPT_ID = "33333333-3333-4333-8333-333333333333";
// q04 as the first newcomer asked it, worded about the seat: the open prompt a second asking joins.
const OPEN_PROMPT = {
  id: PROMPT_ID,
  text: "決算が終わってから出てきた領収書はどう処理すればよいですか？",
};

type Reply = { data?: unknown; error?: { code: string } | null };

type Stub = {
  seat: { id: string; name?: string } | null;
  found?: unknown[]; // search_notes' rows: none by default, so the question abstains
  open?: unknown; // open_demand_prompts' rows: none by default
  openError?: { code: string } | null;
  listError?: { code: string } | null; // list_prompt's
  routed?: unknown; // route_question's reply, as PostgREST hands it over
  routes?: Reply[]; // or one reply per call, in order
  seatError?: { code: string } | null;
  searchError?: { code: string } | null;
  replaced?: unknown[]; // superseded_deadlines' rows: none by default
  replacedError?: { code: string } | null;
  routeError?: { code: string } | null;
  inserted?: Record<string, Record<string, unknown>[]>; // rows by table
  called?: string[]; // database functions, in order
  args?: Record<string, unknown[]>; // each function's arguments, in order
  storedPayload?: unknown; // the answers row as the database keeps it, when it differs from the one inserted
};

function stubClient(stub: Stub): SupabaseClient {
  const inserted: Record<string, Record<string, unknown>[]> = {};
  const called: string[] = [];
  const args: Record<string, unknown[]> = {};
  stub.inserted = inserted;
  stub.called = called;
  stub.args = args;
  const client = {
    from(table: string) {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: stub.seat,
              error: stub.seatError ?? null,
            }),
          }),
        }),
        // With .select().single(): the new id (questions), or the row as stored (answers, here as inserted).
        insert: (row: Record<string, unknown>) => {
          inserted[table] = [...(inserted[table] ?? []), row];
          return Object.assign(Promise.resolve({ data: null, error: null }), {
            select: () => ({
              single: async () => ({
                data:
                  table === "answers"
                    ? { payload: stub.storedPayload ?? row.payload }
                    : { id: QUESTION_ID },
                error: null,
              }),
            }),
          });
        },
      };
    },
    rpc: async (name: string, values: unknown) => {
      called.push(name);
      args[name] = [...(args[name] ?? []), values];
      if (name === "search_notes") {
        return { data: stub.found ?? [], error: stub.searchError ?? null };
      }
      if (name === "superseded_deadlines") {
        return { data: stub.replaced ?? [], error: stub.replacedError ?? null };
      }
      if (name === "open_demand_prompts") {
        return { data: stub.open ?? [], error: stub.openError ?? null };
      }
      if (name === "list_prompt") {
        return { data: null, error: stub.listError ?? null };
      }
      const reply = stub.routes?.shift();
      return reply
        ? { data: reply.data ?? null, error: reply.error ?? null }
        : { data: stub.routed, error: stub.routeError ?? null };
    },
  };
  return client as unknown as SupabaseClient;
}

const embed = async (texts: string[]) => texts.map(() => [0.25, -0.5]);

// Haiku finds no open prompt that asks the same thing and keeps the question's words.
const keepsWords = () =>
  fakeModel({ duplicate_of: null, prompt: QUESTION } satisfies DedupeOutput);

// Nothing close enough was found, so the answer model must not even be made.
const noAnswer: AskModels = {
  embed,
  answer: (): LanguageModel => {
    throw new Error("the answer model was made without a note to answer from");
  },
  dedupe: keepsWords,
};

const replying = (reply: AnswerOutput): AskModels => ({
  embed,
  answer: () => fakeModel(reply),
  dedupe: keepsWords,
});

// After an abstain, Haiku replies with this.
const deduping = (reply: DedupeOutput) => {
  const model = fakeModel(reply);
  return { model, models: { ...noAnswer, dedupe: () => model } };
};

function post(body: BodyInit, token?: string): Request {
  return new Request("http://localhost/api/ask", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body,
  });
}

describe("questionLang", () => {
  it("reads the question's language from its script", () => {
    expect(questionLang(QUESTION)).toBe("ja");
    expect(questionLang("合宿のお金はどう管理する")).toBe("ja");
    expect(questionLang("いつまで?")).toBe("ja");
    expect(questionLang("When is the health office deadline?")).toBe("en");
  });

  it("keeps an English question with a Japanese word in it English", () => {
    expect(questionLang("When is the 保健所 deadline?")).toBe("en");
    expect(questionLang("Who has the 模擬店 forms？")).toBe("en");
    expect(questionLang("Can I use ＬＩＮＥ？")).toBe("en");
  });

  it("reads kana, or kanji without Latin letters, as Japanese", () => {
    expect(questionLang("LINEグループはどこ")).toBe("ja");
    expect(questionLang("PDFの出し方")).toBe("ja");
    expect(questionLang("模擬店 締切")).toBe("ja");
    expect(questionLang("ｶｲｹｲ")).toBe("ja"); // half-width katakana
  });
});

describe("handleAsk", () => {
  it("refuses a request without a token", async () => {
    const response = await handleAsk(
      post(JSON.stringify({ seat: "smash-kaikei", question: QUESTION })),
    );
    expect(response.status).toBe(401);
    expect(ApiError.parse(await response.json()).error).toBe("unauthorized");
  });

  it("rejects a body that isn't a question", async () => {
    for (const body of [
      "not json",
      JSON.stringify({ seat: "smash-kaikei", question: "   " }),
      JSON.stringify({ seat: "Smash Kaikei", question: QUESTION }),
      JSON.stringify({ seat: "smash-kaikei" }),
    ]) {
      const response = await handleAsk(post(body, "test-token"));
      expect(response.status).toBe(400);
      expect(ApiError.parse(await response.json()).error).toBe(
        "invalid_request",
      );
    }
  });
});

describe("askAsCaller", () => {
  const q01 = { seat: "smash-kaikei", question: mockQuestions.q01 };
  const q04 = { seat: "smash-kaikei", question: QUESTION };

  it("answers from the notes it found: saved as answered with its answer, and routed nowhere", async () => {
    const stub: Stub = { seat: { id: SMASH_KAIKEI }, found: q01Notes };
    const result = await askAsCaller(
      stubClient(stub),
      "asker-1",
      q01,
      replying(mockModelReplies.answer),
    );

    // Exactly the answer the mock gives screens for q01, rule change included.
    expect(AskResult.parse(result)).toEqual({
      ...mockAnswer,
      questionId: QUESTION_ID,
    });
    expect(stub.inserted).toEqual({
      questions: [
        {
          asker_user_id: "asker-1",
          seat_id: SMASH_KAIKEI,
          text: mockQuestions.q01,
          lang: "ja",
          status: "answered",
        },
      ],
      answers: [{ question_id: QUESTION_ID, payload: result }],
    });
    // The history is read for the seat's own deadline notes only, not the 学祭実行委員会's note.
    expect(stub.called).toEqual(["search_notes", "superseded_deadlines"]);
    expect(stub.args?.superseded_deadlines).toEqual([
      { note_ids: ["smash-2024-hokenjo", "smash-2025-hokenjo"] },
    ]);
  });

  describe("after 「更新する」 replaced the 2025 note (F5.6)", () => {
    const [hokenjo2024, gakusai2025, hokenjo2025] = q01Notes;
    const notice2026 = {
      ...hokenjo2025,
      id: "notice-2026",
      term_order: 2026,
      term_label: "2026",
      byline: "2026年度 会計",
      title: "保健所への臨時営業届",
      body: "臨時営業届は学生課窓口に提出する。今年度から締切は学祭の4週間前になった。",
      deadline_date: "2026-10-19",
      similarity: 0.581,
    };
    const found = [hokenjo2024, gakusai2025, notice2026];
    const replaced = [
      {
        id: "smash-2025-hokenjo",
        seat_id: SMASH_KAIKEI,
        term_order: 2025,
        term_label: "2025",
        deadline_date: "2025-10-20",
        superseded_by: "notice-2026",
      },
    ];
    // The answer cites the 2026 note alone, as it may when the 2024 note says nothing the 2026 one doesn't.
    const reply: AnswerOutput = {
      answerable: true,
      sentences: [
        {
          text: "臨時営業届は学祭の4週間前までに学生課窓口へ出します。",
          note_ids: ["notice-2026"],
        },
      ],
      language: "ja",
    };

    it("cites the 2026 note and flags the change against the note it replaced", async () => {
      const stub: Stub = { seat: { id: SMASH_KAIKEI }, found, replaced };
      const result = await askAsCaller(
        stubClient(stub),
        "asker-1",
        q01,
        replying(reply),
      );
      expect(result).toMatchObject({
        status: "answered",
        sentences: [
          { citations: [{ noteId: "notice-2026", termLabel: "2026" }] },
        ],
        ruleChange: { termLabel: "2026", summary: "10/20 → 10/19" },
      });
      expect(stub.args?.superseded_deadlines).toEqual([
        { note_ids: ["smash-2024-hokenjo", "notice-2026"] },
      ]);
    });

    it("answers without that history when it can't be read, and logs a code only", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const stub: Stub = {
        seat: { id: SMASH_KAIKEI },
        found,
        replacedError: { code: "PGRST202" }, // 0009 not applied yet
      };
      const result = await askAsCaller(
        stubClient(stub),
        "asker-1",
        q01,
        replying(reply),
      );
      expect(result).toMatchObject({ status: "answered" });
      expect(result).not.toHaveProperty("ruleChange");
      expect(log).toHaveBeenCalledWith(
        "POST /api/ask: replaced deadlines failed: unavailable (ApiFailure)",
      );
      expect(JSON.stringify(log.mock.calls)).not.toContain("保健所");
    });
  });

  it("replies with the answer as stored: one whose note was withdrawn while it was asked comes back without it", async () => {
    // What 0006's trigger keeps when the 2025 note is withdrawn between the search and the save.
    const stored = {
      status: "answered",
      questionId: QUESTION_ID,
      sentences: mockAnswer.sentences.filter((sentence) =>
        sentence.citations.every(
          (citation) => citation.noteId === "smash-2024-hokenjo",
        ),
      ),
      language: "ja",
    };
    const stub: Stub = {
      seat: { id: SMASH_KAIKEI },
      found: q01Notes,
      storedPayload: stored,
    };
    const result = await askAsCaller(
      stubClient(stub),
      "asker-1",
      q01,
      replying(mockModelReplies.answer),
    );
    expect(result).toEqual(stored);
    expect(JSON.stringify(result)).not.toContain("smash-2025-hokenjo");
  });

  it("answers unavailable when the stored answer isn't an AskResult", async () => {
    const stub: Stub = {
      seat: { id: SMASH_KAIKEI },
      found: q01Notes,
      storedPayload: { status: "answered" },
    };
    await expect(
      askAsCaller(
        stubClient(stub),
        "asker-1",
        q01,
        replying(mockModelReplies.answer),
      ),
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("abstains when no sentence keeps a citation: saved waiting, then routed", async () => {
    const stub: Stub = {
      seat: { id: "seat-1" },
      found: q01Notes,
      routed: { prompt_id: PROMPT_ID, routed_to: 1 },
    };
    const result = await askAsCaller(
      stubClient(stub),
      "asker-1",
      q01,
      replying({
        answerable: true,
        sentences: [{ text: "わかりません。", note_ids: ["no-such-note"] }],
        language: "ja",
      }),
    );

    expect(result).toEqual({
      status: "abstained",
      questionId: QUESTION_ID,
      promptId: PROMPT_ID,
      routedTo: 1,
    });
    expect(stub.inserted?.questions).toMatchObject([{ status: "waiting" }]);
    expect(stub.inserted?.answers).toBeUndefined();
    expect(stub.called).toEqual([
      "search_notes",
      "open_demand_prompts",
      "route_question",
      "list_prompt",
    ]);
  });

  it("abstains without the answer model when no note is close enough: saves the question with its lang, then routes it", async () => {
    const stub: Stub = {
      seat: { id: "seat-1" },
      // q04's closest note, about receipts, scores under MATCH (lib/engine/retrieve.ts).
      found: [{ ...q01Notes[0], similarity: 0.626 }],
      routed: { prompt_id: PROMPT_ID, routed_to: 1 },
    };
    const result = await askAsCaller(
      stubClient(stub),
      "asker-1",
      q04,
      noAnswer,
    );

    expect(stub.inserted).toEqual({
      questions: [
        {
          asker_user_id: "asker-1",
          seat_id: "seat-1",
          text: QUESTION,
          lang: "ja",
          status: "waiting",
        },
      ],
    });
    expect(stub.called).toEqual([
      "search_notes",
      "open_demand_prompts",
      "route_question",
      "list_prompt",
    ]);
    expect(AskResult.parse(result)).toEqual({
      status: "abstained",
      questionId: QUESTION_ID,
      promptId: PROMPT_ID,
      routedTo: 1,
    });
  });

  it("saves nothing when the search fails", async () => {
    const ollamaDown: AskModels = {
      ...noAnswer,
      embed: async () => {
        throw new Error("Ollama answered 500 for bge-m3");
      },
    };
    const stub: Stub = { seat: { id: "seat-1" } };
    await expect(
      askAsCaller(stubClient(stub), "asker-1", q04, ollamaDown),
    ).rejects.toThrow();
    expect(stub.inserted).toEqual({});

    const refused: Stub = {
      seat: { id: "seat-1" },
      searchError: { code: "42501" },
    };
    await expect(
      askAsCaller(stubClient(refused), "asker-1", q04, noAnswer),
    ).rejects.toMatchObject({ name: "ApiFailure", code: "forbidden" });
    expect(refused.inserted).toEqual({});
  });

  it("names no prompt when the asker holds no seat, so nothing was routed", async () => {
    const stub: Stub = {
      seat: { id: "seat-1" },
      routed: { prompt_id: null, routed_to: 0 },
    };
    const result = await askAsCaller(
      stubClient(stub),
      "outsider",
      q04,
      noAnswer,
    );
    expect(AskResult.parse(result)).toEqual({
      status: "abstained",
      questionId: QUESTION_ID,
      routedTo: 0,
    });
  });

  it("reads route_question's row from a one-item array too", async () => {
    const stub: Stub = {
      seat: { id: "seat-1" },
      routed: [{ prompt_id: PROMPT_ID, routed_to: 1 }],
    };
    const result = await askAsCaller(
      stubClient(stub),
      "asker-1",
      q04,
      noAnswer,
    );
    expect(result).toMatchObject({ promptId: PROMPT_ID, routedTo: 1 });
  });

  it("answers unavailable when route_question's reply isn't one it can give", async () => {
    for (const routed of [
      null,
      {},
      { prompt_id: "not-a-uuid", routed_to: 1 },
      { prompt_id: PROMPT_ID, routed_to: -1 },
    ]) {
      await expect(
        askAsCaller(
          stubClient({ seat: { id: "seat-1" }, routed }),
          "asker-1",
          q04,
          noAnswer,
        ),
      ).rejects.toMatchObject({ name: "ApiFailure", code: "unavailable" });
    }
  });

  it("404s a seat that doesn't exist, before searching", async () => {
    const stub: Stub = { seat: null };
    await expect(
      askAsCaller(
        stubClient(stub),
        "asker-1",
        { seat: "no-such-seat", question: QUESTION },
        noAnswer,
      ),
    ).rejects.toMatchObject({ name: "ApiFailure", code: "not_found" });
    expect(stub.called).toEqual([]);
  });

  it("turns a policy refusal into forbidden, never into text", async () => {
    const stub: Stub = {
      seat: { id: "seat-1" },
      routed: { prompt_id: null, routed_to: 0 },
      routeError: { code: "42501" },
    };
    const failure = await askAsCaller(
      stubClient(stub),
      "asker-1",
      q04,
      noAnswer,
    ).then(
      () => undefined,
      (error: { code?: string; message?: string }) => error,
    );
    expect(failure?.code).toBe("forbidden");
    expect(failure?.message).not.toContain(QUESTION);
  });
});

describe("askAsCaller: dedupe (F2.5)", () => {
  const q04 = { seat: "smash-kaikei", question: QUESTION };
  const seat = { id: SMASH_KAIKEI, name: "会計" };

  afterEach(() => vi.restoreAllMocks());

  // Every console.error line the flow wrote: codes only, never the question or a prompt.
  const errorLog = () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    return () => spy.mock.calls.map((call) => call.join(" ")).join("\n");
  };

  it("joins the open prompt that asks the same thing: no new prompt, no text sent", async () => {
    const stub: Stub = {
      seat,
      open: [OPEN_PROMPT],
      routed: { prompt_id: PROMPT_ID, routed_to: 1 },
    };
    const { model, models } = deduping({
      duplicate_of: PROMPT_ID,
      prompt: "決算後に申請された領収書はどう処理すればよいですか？",
    });
    const result = await askAsCaller(stubClient(stub), "asker-2", q04, models);

    expect(result).toEqual({
      status: "abstained",
      questionId: QUESTION_ID,
      promptId: PROMPT_ID,
      routedTo: 1,
    });
    expect(stub.args?.open_demand_prompts).toEqual([{ question: QUESTION_ID }]);
    expect(stub.args?.route_question).toEqual([
      { question: QUESTION_ID, join_prompt: PROMPT_ID },
    ]);
    // Two calls: the match saw the seat, the question and the open prompt, each in its own tag; the wording saw the
    // question alone.
    const calls = promptTexts(model);
    expect(calls).toHaveLength(2);
    const match = calls.find((call) => call.includes("<prompt"));
    const wording = calls.find((call) => !call.includes("<prompt"));
    expect(match).toContain("Seat: 会計");
    expect(match).toContain(`<question>\n${QUESTION}\n</question>`);
    expect(match).toContain(
      `<prompt id="${PROMPT_ID}">\n${OPEN_PROMPT.text}\n</prompt>`,
    );
    expect(wording).toContain(`<question>\n${QUESTION}\n</question>`);
    expect(wording).not.toContain(OPEN_PROMPT.text);
    // The asker's own question stays as typed, and a joined question lists nothing.
    expect(stub.inserted?.questions).toMatchObject([{ text: QUESTION }]);
    expect(stub.called).not.toContain("list_prompt");
  });

  it("starts a new prompt worded about the seat when none asks the same thing", async () => {
    const reworded = "前任者への引き継ぎで、領収書の締め切りはいつですか？";
    const stub: Stub = {
      seat,
      open: [OPEN_PROMPT],
      routed: { prompt_id: OTHER_PROMPT_ID, routed_to: 1 },
    };
    const { models } = deduping({ duplicate_of: null, prompt: reworded });
    const result = await askAsCaller(
      stubClient(stub),
      "asker-1",
      {
        seat: "smash-kaikei",
        question: "田中先輩に領収書の締め切りを聞きたい",
      },
      models,
    );

    expect(result).toMatchObject({ promptId: OTHER_PROMPT_ID, routedTo: 1 });
    expect(stub.args?.route_question).toEqual([
      { question: QUESTION_ID, prompt_text: reworded },
    ]);
    // In Haiku's words, so the seat's later askers may join it.
    expect(stub.args?.list_prompt).toEqual([{ question: QUESTION_ID }]);
  });

  it("still answers when listing fails: the prompt only misses a merge", async () => {
    const log = errorLog();
    const stub: Stub = {
      seat,
      routed: { prompt_id: PROMPT_ID, routed_to: 1 },
      listError: { code: "PGRST202" },
    };
    const result = await askAsCaller(
      stubClient(stub),
      "asker-1",
      q04,
      noAnswer,
    );
    expect(result).toMatchObject({ promptId: PROMPT_ID, routedTo: 1 });
    expect(log()).toContain("list_prompt failed: unavailable");
    expect(log()).not.toContain(QUESTION);
  });

  it("never joins a prompt it wasn't given", async () => {
    const stub: Stub = {
      seat,
      open: [OPEN_PROMPT],
      routed: { prompt_id: OTHER_PROMPT_ID, routed_to: 1 },
    };
    const { models } = deduping({
      duplicate_of: OTHER_PROMPT_ID,
      prompt: QUESTION,
    });
    await askAsCaller(stubClient(stub), "asker-1", q04, models);
    expect(stub.args?.route_question).toEqual([
      { question: QUESTION_ID, prompt_text: QUESTION },
    ]);
  });

  it("starts a prompt when the one it joins was retired in the meantime", async () => {
    const stub: Stub = {
      seat,
      open: [OPEN_PROMPT],
      routes: [
        { error: { code: "22023" } },
        { data: { prompt_id: OTHER_PROMPT_ID, routed_to: 1 } },
      ],
    };
    const { models } = deduping({ duplicate_of: PROMPT_ID, prompt: QUESTION });
    const result = await askAsCaller(stubClient(stub), "asker-2", q04, models);

    expect(result).toMatchObject({ promptId: OTHER_PROMPT_ID, routedTo: 1 });
    expect(stub.args?.route_question).toEqual([
      { question: QUESTION_ID, join_prompt: PROMPT_ID },
      { question: QUESTION_ID, prompt_text: QUESTION },
    ]);
  });

  it("routes the question as typed when there's no Haiku or no open prompts to read", async () => {
    const log = errorLog();
    const stub: Stub = {
      seat,
      // 0008 not applied yet: PostgREST can't find the function.
      openError: { code: "PGRST202" },
      routed: { prompt_id: PROMPT_ID, routed_to: 1 },
    };
    const noKey: AskModels = {
      ...noAnswer,
      dedupe: () => {
        throw new Error("FAST_MODEL must be set");
      },
    };
    const result = await askAsCaller(stubClient(stub), "asker-1", q04, noKey);

    expect(result).toMatchObject({ promptId: PROMPT_ID, routedTo: 1 });
    expect(stub.args?.route_question).toEqual([
      { question: QUESTION_ID, prompt_text: QUESTION },
    ]);
    // As typed, the prompt reaches the routed predecessors and is never listed for the seat's other askers.
    expect(stub.called).not.toContain("list_prompt");
    expect(log()).not.toContain(QUESTION);
  });

  it("drops Haiku's wording when it names someone, and keeps the question's own, unlisted", async () => {
    const stub: Stub = {
      seat,
      routed: { prompt_id: PROMPT_ID, routed_to: 1 },
    };
    const { models } = deduping({
      duplicate_of: null,
      prompt: "田中さんに領収書のことを聞いてもいいですか？",
    });
    await askAsCaller(stubClient(stub), "asker-1", q04, models);
    expect(stub.args?.route_question).toEqual([
      { question: QUESTION_ID, prompt_text: QUESTION },
    ]);
    expect(stub.called).not.toContain("list_prompt");
  });

  it("routes nowhere when no prompt text passes the guard, and saves the question as typed", async () => {
    const log = errorLog();
    const withPhone = "090-1234-5678 に領収書のことを電話してもいい？";
    const stub: Stub = { seat };
    const { models } = deduping({
      duplicate_of: null,
      prompt: "領収書のことは 090-1234-5678 に電話すればいいですか？",
    });
    const result = await askAsCaller(
      stubClient(stub),
      "asker-1",
      { seat: "smash-kaikei", question: withPhone },
      models,
    );

    expect(result).toEqual({
      status: "abstained",
      questionId: QUESTION_ID,
      routedTo: 0,
    });
    expect(stub.called).not.toContain("route_question");
    expect(stub.inserted?.questions).toMatchObject([{ text: withPhone }]);
    expect(log()).not.toContain("090");
  });
});
