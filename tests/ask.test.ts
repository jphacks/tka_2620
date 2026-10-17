// POST /api/ask: answered from the notes (F2.2, issue #20), or saved and routed to the live loop (F3.5, issue #7).
// These tests run offline: the handler returns before it touches Supabase unless the request is well-formed, and the
// flow itself is driven through a stub client and fake models, so the database's own rules are checked by
// scripts/check-ask.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LanguageModel } from "ai";
import { describe, expect, it } from "vitest";
import { type AnswerOutput, ApiError, AskResult } from "@/lib/contracts";
import { type AskModels, askAsCaller, handleAsk } from "@/lib/engine/ask";
import { questionLang } from "@/lib/engine/lang";
import { mockAnswer, mockModelReplies, mockQuestions } from "@/lib/mocks";
import { fakeModel, q01Notes } from "./fakes";

// seed/questions.csv q04, asked by a26.
const QUESTION = "決算後に申請された領収書はどうすれば良いですか？";
const QUESTION_ID = "11111111-1111-4111-8111-111111111111";
const PROMPT_ID = "22222222-2222-4222-8222-222222222222";

type Stub = {
  seat: { id: string } | null;
  found?: unknown[]; // search_notes' rows: none by default, so the question abstains
  routed?: unknown; // route_question's reply, as PostgREST hands it over
  seatError?: { code: string } | null;
  searchError?: { code: string } | null;
  routeError?: { code: string } | null;
  inserted?: Record<string, Record<string, unknown>[]>; // rows by table
  called?: string[]; // database functions, in order
};

function stubClient(stub: Stub): SupabaseClient {
  const inserted: Record<string, Record<string, unknown>[]> = {};
  const called: string[] = [];
  stub.inserted = inserted;
  stub.called = called;
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
        // Awaited as it is (answers), or with .select().single() for the new id (questions).
        insert: (row: Record<string, unknown>) => {
          inserted[table] = [...(inserted[table] ?? []), row];
          return Object.assign(Promise.resolve({ data: null, error: null }), {
            select: () => ({
              single: async () => ({ data: { id: QUESTION_ID }, error: null }),
            }),
          });
        },
      };
    },
    rpc: async (name: string) => {
      called.push(name);
      return name === "search_notes"
        ? { data: stub.found ?? [], error: stub.searchError ?? null }
        : { data: stub.routed, error: stub.routeError ?? null };
    },
  };
  return client as unknown as SupabaseClient;
}

const embed = async (texts: string[]) => texts.map(() => [0.25, -0.5]);

// Nothing close enough was found, so the answer model must not even be made.
const noAnswer: AskModels = {
  embed,
  answer: (): LanguageModel => {
    throw new Error("the answer model was made without a note to answer from");
  },
};

const replying = (reply: AnswerOutput): AskModels => ({
  embed,
  answer: () => fakeModel(reply),
});

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
    const stub: Stub = { seat: { id: "seat-1" }, found: q01Notes };
    const result = await askAsCaller(
      stubClient(stub),
      "asker-1",
      q01,
      replying(mockModelReplies.answer),
    );

    expect(AskResult.parse(result)).toEqual({
      status: "answered",
      questionId: QUESTION_ID,
      sentences: mockAnswer.sentences,
      language: "ja",
    });
    expect(stub.inserted).toEqual({
      questions: [
        {
          asker_user_id: "asker-1",
          seat_id: "seat-1",
          text: mockQuestions.q01,
          lang: "ja",
          status: "answered",
        },
      ],
      answers: [{ question_id: QUESTION_ID, payload: result }],
    });
    expect(stub.called).toEqual(["search_notes"]);
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
    expect(stub.called).toEqual(["search_notes", "route_question"]);
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
    expect(stub.called).toEqual(["search_notes", "route_question"]);
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
