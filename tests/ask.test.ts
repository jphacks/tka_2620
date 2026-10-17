// The engine's side of the live loop: POST /api/ask saves the question and routes it (issue #7, docs/SPEC.md → F3).
// These tests run offline: the handler returns before it touches Supabase unless the request is well-formed, and the
// flow itself is driven through a stub client, so the database's own rules are checked by scripts/check-ask.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { ApiError, AskResult } from "@/lib/contracts";
import { askAsCaller, handleAsk } from "@/lib/engine/ask";
import { questionLang } from "@/lib/engine/lang";

// seed/questions.csv q04, asked by a26.
const QUESTION = "決算後に申請された領収書はどうすれば良いですか？";
const QUESTION_ID = "11111111-1111-4111-8111-111111111111";
const PROMPT_ID = "22222222-2222-4222-8222-222222222222";

type Stub = {
  seat: { id: string } | null;
  routed: { prompt_id: string | null; routed_to: number | null };
  seatError?: { code: string } | null;
  routeError?: { code: string } | null;
  inserted?: Record<string, unknown>;
};

function stubClient(stub: Stub): SupabaseClient {
  const client = {
    from() {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: stub.seat,
              error: stub.seatError ?? null,
            }),
          }),
        }),
        insert: (row: Record<string, unknown>) => {
          stub.inserted = row;
          return {
            select: () => ({
              single: async () => ({ data: { id: QUESTION_ID }, error: null }),
            }),
          };
        },
      };
    },
    rpc: async () => ({ data: stub.routed, error: stub.routeError ?? null }),
  };
  return client as unknown as SupabaseClient;
}

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
  it("saves the question with its lang, then routes it", async () => {
    const stub: Stub = {
      seat: { id: "seat-1" },
      routed: { prompt_id: PROMPT_ID, routed_to: 1 },
    };
    const result = await askAsCaller(stubClient(stub), "asker-1", {
      seat: "smash-kaikei",
      question: QUESTION,
    });

    expect(stub.inserted).toEqual({
      asker_user_id: "asker-1",
      seat_id: "seat-1",
      text: QUESTION,
      lang: "ja",
    });
    expect(AskResult.parse(result)).toEqual({
      status: "abstained",
      questionId: QUESTION_ID,
      promptId: PROMPT_ID,
      routedTo: 1,
    });
  });

  it("names no prompt when the asker holds no seat, so nothing was routed", async () => {
    const stub: Stub = {
      seat: { id: "seat-1" },
      routed: { prompt_id: null, routed_to: 0 },
    };
    const result = await askAsCaller(stubClient(stub), "outsider", {
      seat: "smash-kaikei",
      question: QUESTION,
    });
    expect(AskResult.parse(result)).toEqual({
      status: "abstained",
      questionId: QUESTION_ID,
      routedTo: 0,
    });
  });

  it("404s a seat that doesn't exist", async () => {
    const stub: Stub = {
      seat: null,
      routed: { prompt_id: null, routed_to: 0 },
    };
    await expect(
      askAsCaller(stubClient(stub), "asker-1", {
        seat: "no-such-seat",
        question: QUESTION,
      }),
    ).rejects.toMatchObject({ name: "ApiFailure", code: "not_found" });
  });

  it("turns a policy refusal into forbidden, never into text", async () => {
    const stub: Stub = {
      seat: { id: "seat-1" },
      routed: { prompt_id: null, routed_to: 0 },
      routeError: { code: "42501" },
    };
    const failure = await askAsCaller(stubClient(stub), "asker-1", {
      seat: "smash-kaikei",
      question: QUESTION,
    }).then(
      () => undefined,
      (error: { code?: string; message?: string }) => error,
    );
    expect(failure?.code).toBe("forbidden");
    expect(failure?.message).not.toContain(QUESTION);
  });
});
