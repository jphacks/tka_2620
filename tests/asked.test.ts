// GET /api/seats/[slug]/asked (the caller's own questions and their answers, for 聞く after a reload), offline: the flow
// as the caller with a scripted Supabase client (the seat; the caller's questions; their answers; the notes the answers
// cite and each seat's lineage), then the handler, with callerFor stubbed so it reaches the flow without Supabase, and
// the two clients (lib/api.ts, lib/mocks.ts). Nothing here embeds: lib/embed is a spy that no test may call.
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/seats/[slug]/asked/route";
import { createApi } from "@/lib/api";
import { ApiError, AskedView } from "@/lib/contracts";
import { embed } from "@/lib/embed";
import { askedAsCaller } from "@/lib/engine/asked";
import { callerFor } from "@/lib/engine/route";
import {
  createMockApi,
  mockAnswer,
  mockIds,
  mockQuestions,
  resetMocks,
} from "@/lib/mocks";
import {
  GAKUSAI_MOGITEN,
  type Result,
  SMASH_KAIKEI,
  stubClient,
} from "./fakes";

// The route's callerFor as it is, unless a test hands it a caller.
vi.mock("@/lib/engine/route", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/engine/route")>();
  return { ...actual, callerFor: vi.fn(actual.callerFor) };
});
// The guide's embedding (Ollama) has no part here: a call fails the test that made it.
vi.mock("@/lib/embed", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/embed")>();
  return {
    ...actual,
    embed: vi.fn(async () => {
      throw new Error("asked embeds nothing");
    }),
  };
});

beforeEach(() => {
  vi.mocked(embed).mockClear();
});

afterEach(() => {
  expect(embed).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const TODAY = "2026-10-18";
const SEAT = "smash-kaikei";
const ok = (data: unknown): Result => ({ data, error: null });
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

const Q1 = uuid(0x101);
const Q2 = uuid(0x102);
const Q3 = uuid(0x103);
const Q01 = "模擬店の保健所申請、いつまで？";

// The scripted reads, in the order the flow makes them: the seat, the caller's questions, the answers of those
// answered, the notes the answers cite, then seat_lineage once per seat of those notes.
type Script = {
  seat?: Result;
  questions?: Result;
  answers?: Result;
  notes?: Result;
  lineage?: Result[];
};

function asked(script: Script = {}) {
  const stub = stubClient(
    {
      seats: [script.seat ?? ok({ id: SMASH_KAIKEI })],
      questions: [script.questions ?? ok([])],
      answers: [script.answers ?? ok([])],
      notes: [script.notes ?? ok([])],
    },
    { seat_lineage: script.lineage ?? [] },
  );
  return { ...stub, run: () => askedAsCaller(stub.client, SEAT, TODAY) };
}

const question = (id: string, status: string, at: string, text = Q01) => ({
  id,
  text,
  lang: "ja",
  status,
  created_at: at,
});
// A saved answer as the asker's answers row may hold it (the asker can write it themselves): stale bylines and terms,
// a rule change, and `live`.
const saved = (
  questionId: string,
  cited: string[][],
  extra: Record<string, unknown> = {},
) => ({
  status: "answered",
  questionId,
  sentences: cited.map((noteIds, i) => ({
    text: `文${i + 1}。`,
    citations: noteIds.map((noteId) => ({
      noteId,
      byline: "古い署名",
      termLabel: "古い期",
    })),
  })),
  language: "ja",
  ruleChange: { termLabel: "2025", summary: "10/27 → 10/20" },
  live: { byline: "古い署名" },
  ...extra,
});
// The cited notes as the caller reads them now, and a seat's terms as seat_lineage() gives them (oldest first).
const cited = (...notes: [string, string, string, number][]) =>
  ok(
    notes.map(([id, byline, seat_id, term_order]) => ({
      id,
      byline,
      seat_id,
      term_order,
    })),
  );
const terms = (...entries: [string, number][]) =>
  ok(entries.map(([term_label, term_order]) => ({ term_label, term_order })));
const stamps = (view: AskedView, index = 0) =>
  view.asked[index].answer?.sentences.flatMap((sentence) =>
    sentence.citations.map(({ byline, termLabel }) => [byline, termLabel]),
  );

describe("askedAsCaller", () => {
  it("reads the caller's questions at the seat as the policy gives them, newest first, at most 20, and nothing the guide adds", async () => {
    const { run, calls, rpcCalls } = asked({
      questions: ok([
        question(Q1, "waiting", "2026-10-18T03:00:00+00:00", "部費はいくら？"),
        question(Q2, "waiting", "2026-10-18T02:00:00+00:00"),
      ]),
    });
    const returned = await run();
    expect(AskedView.parse(returned)).toEqual(returned);
    expect(returned).toEqual({
      asked: [
        {
          questionId: Q1,
          text: "部費はいくら？",
          lang: "ja",
          askedAt: "2026-10-18T03:00:00+00:00",
        },
        {
          questionId: Q2,
          text: Q01,
          lang: "ja",
          askedAt: "2026-10-18T02:00:00+00:00",
        },
      ],
    });
    expect(calls.seats[0]).toEqual([
      ["select", "id"],
      ["eq", "slug", SEAT],
    ]);
    // The questions policy gives the asker's own rows only, so the query names nobody; the database sorts and cuts.
    expect(calls.questions[0]).toEqual([
      ["select", "id, text, lang, status, created_at"],
      ["eq", "seat_id", SMASH_KAIKEI],
      ["order", "created_at", { ascending: false }],
      ["limit", 20],
    ]);
    // Waiting questions have no answer to read. No notes, holders or prompts, no search, and nothing written.
    expect(Object.keys(calls).sort()).toEqual(["questions", "seats"]);
    expect(rpcCalls).toEqual([]);
  });

  it("shows an answer only under the caller's own question: an answers row of any other question never shows", async () => {
    const { run, calls } = asked({
      questions: ok([question(Q1, "answered", "2026-10-18T03:00:00+00:00")]),
      answers: ok([
        { question_id: Q1, payload: saved(Q1, [["smash-2024-hokenjo"]]) },
        { question_id: Q2, payload: saved(Q2, [["smash-2024-hokenjo"]]) },
      ]),
      notes: cited(["smash-2024-hokenjo", "2024年度 会計", SMASH_KAIKEI, 2024]),
      lineage: [terms(["2024", 2024])],
    });
    const view = await run();
    expect(view.asked.map((item) => item.questionId)).toEqual([Q1]);
    expect(JSON.stringify(view)).not.toContain(Q2);
    expect(calls.answers[0]).toEqual([
      ["select", "question_id, payload"],
      ["in", "question_id", [Q1]],
    ]);
  });

  it("checks each answer again: a sentence on a note the caller can't read goes, the rule change with it, `live` always; byline and term from the database, the id from the row", async () => {
    const { run, calls, rpcCalls } = asked({
      questions: ok([
        question(Q1, "answered", "2026-10-18T03:00:00+00:00"),
        question(Q2, "waiting", "2026-10-18T02:00:00+00:00", "部費はいくら？"),
      ]),
      answers: ok([
        {
          question_id: Q1,
          // A payload naming another question: the row's id is the one that counts.
          payload: saved(Q3, [
            ["smash-2024-hokenjo"],
            ["smash-2025-hokenjo", "smash-2024-hokenjo"],
            ["gakusai-2025-hokenjo"],
          ]),
        },
      ]),
      // smash-2025-hokenjo doesn't come back: withdrawn, replaced, expired or out of the caller's scope.
      notes: cited(
        ["smash-2024-hokenjo", "2024年度 会計", SMASH_KAIKEI, 2024],
        ["gakusai-2025-hokenjo", "2025年度 模擬店担当", GAKUSAI_MOGITEN, 2025],
      ),
      lineage: [
        terms(["2024", 2024], ["2025", 2025], ["2026", 2026]),
        terms(["2025秋", 2025]),
      ],
    });
    const returned = await run();
    expect(AskedView.parse(returned)).toEqual(returned);
    // As returned, so no field the payload brought along (`live`, a stale stamp) can hide behind the route's parse.
    expect(returned.asked).toEqual([
      {
        questionId: Q1,
        text: Q01,
        lang: "ja",
        askedAt: "2026-10-18T03:00:00+00:00",
        answer: {
          status: "answered",
          questionId: Q1,
          sentences: [
            {
              text: "文1。",
              citations: [
                {
                  noteId: "smash-2024-hokenjo",
                  byline: "2024年度 会計",
                  termLabel: "2024",
                },
              ],
            },
            {
              text: "文3。",
              citations: [
                {
                  noteId: "gakusai-2025-hokenjo",
                  byline: "2025年度 模擬店担当",
                  termLabel: "2025秋", // the lineage's label, not the term's number
                },
              ],
            },
          ],
          language: "ja",
        },
      },
      {
        questionId: Q2,
        text: "部費はいくら？",
        lang: "ja",
        askedAt: "2026-10-18T02:00:00+00:00",
      },
    ]);
    // Every cited note once, of any seat, as search_notes would find it for an answer; then each seat's terms once.
    expect(calls.notes[0]).toEqual([
      ["select", "id, byline, seat_id, term_order"],
      [
        "in",
        "id",
        ["smash-2024-hokenjo", "smash-2025-hokenjo", "gakusai-2025-hokenjo"],
      ],
      ["eq", "status", "live"],
      ["is", "superseded_by", null],
      ["or", "valid_until.is.null,valid_until.gte.2026-10-18"],
    ]);
    expect(rpcCalls).toEqual([
      ["seat_lineage", { seat: SMASH_KAIKEI }],
      ["seat_lineage", { seat: GAKUSAI_MOGITEN }],
    ]);
  });

  it("keeps the rule change while every sentence stands; a term the lineage doesn't list reads as its number, and the first label of a term counts", async () => {
    const { run, rpcCalls } = asked({
      questions: ok([question(Q1, "answered", "2026-10-18T03:00:00+00:00")]),
      answers: ok([
        {
          question_id: Q1,
          payload: saved(Q1, [["smash-2024-hokenjo"], ["smash-2025-hokenjo"]]),
        },
      ]),
      notes: cited(
        ["smash-2024-hokenjo", "2024年度 会計", SMASH_KAIKEI, 2024],
        ["smash-2025-hokenjo", "2025年度 会計", SMASH_KAIKEI, 2025],
      ),
      // No holder row left for 2024; two labels for 2025, oldest first as seat_lineage() orders them.
      lineage: [terms(["2025", 2025], ["2025秋", 2025], ["2026", 2026])],
    });
    const view = AskedView.parse(await run());
    expect(view.asked[0].answer?.ruleChange).toEqual({
      termLabel: "2025",
      summary: "10/27 → 10/20",
    });
    expect(view.asked[0].answer).not.toHaveProperty("live");
    expect(stamps(view)).toEqual([
      ["2024年度 会計", "2024"],
      ["2025年度 会計", "2025"],
    ]);
    // Two notes of one seat: its lineage once.
    expect(rpcCalls).toEqual([["seat_lineage", { seat: SMASH_KAIKEI }]]);
  });

  it("shows no answer once no sentence stands, for an abstain, or for a payload that doesn't read, and reads no lineage then", async () => {
    const { run, rpcCalls } = asked({
      questions: ok([
        question(Q1, "answered", "2026-10-18T03:00:00+00:00"),
        question(Q2, "answered", "2026-10-18T02:00:00+00:00"),
        question(Q3, "answered", "2026-10-18T01:00:00+00:00"),
      ]),
      answers: ok([
        { question_id: Q1, payload: saved(Q1, [["smash-2025-hokenjo"]]) },
        {
          question_id: Q2,
          payload: { status: "abstained", questionId: Q2, routedTo: 0 },
        },
        {
          question_id: Q3,
          payload: saved(Q3, [["smash-2024-hokenjo"]], { sentences: [] }),
        },
      ]),
      notes: ok([]),
    });
    const view = AskedView.parse(await run());
    expect(view.asked.map((item) => item.questionId)).toEqual([Q1, Q2, Q3]);
    for (const item of view.asked) expect(item).not.toHaveProperty("answer");
    expect(rpcCalls).toEqual([]);
  });

  it("answers not_found for an unknown seat, and by the database's code when a read fails", async () => {
    await expect(asked({ seat: ok(null) }).run()).rejects.toMatchObject({
      name: "ApiFailure",
      code: "not_found",
    });
    await expect(
      asked({ questions: { data: null, error: { code: "42501" } } }).run(),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      asked({ questions: ok([{ id: "not-a-uuid" }]) }).run(),
    ).rejects.toMatchObject({ code: "unavailable" });

    const answered = ok([
      question(Q1, "answered", "2026-10-18T03:00:00+00:00"),
    ]);
    const answers = ok([
      { question_id: Q1, payload: saved(Q1, [["smash-2024-hokenjo"]]) },
    ]);
    const notes = cited([
      "smash-2024-hokenjo",
      "2024年度 会計",
      SMASH_KAIKEI,
      2024,
    ]);
    await expect(
      asked({
        questions: answered,
        answers: { data: null, error: { code: "XX000" } },
      }).run(),
    ).rejects.toMatchObject({ code: "unavailable" });
    await expect(
      asked({
        questions: answered,
        answers,
        notes: { data: null, error: { code: "42501" } },
      }).run(),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      asked({
        questions: answered,
        answers,
        notes,
        lineage: [{ data: null, error: { code: "XX000" } }],
      }).run(),
    ).rejects.toMatchObject({ code: "unavailable" });
    await expect(
      asked({
        questions: answered,
        answers,
        notes,
        lineage: [ok([{ term_label: 2024, term_order: "2024" }])],
      }).run(),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("GET /api/seats/[slug]/asked", () => {
  const get = (slug: string, authorization?: string) =>
    GET(
      new Request(`http://localhost/api/seats/${slug}/asked`, {
        headers: authorization ? { authorization } : {},
      }),
      { params: Promise.resolve({ slug }) },
    );
  const A26 = uuid(0x203);

  it("answers unauthorized without a token, or with one that isn't a signed-in user's", async () => {
    const response = await get(SEAT);
    expect(response.status).toBe(401);
    expect(ApiError.parse(await response.json()).error).toBe("unauthorized");
    vi.mocked(callerFor).mockResolvedValueOnce(undefined);
    expect((await get(SEAT, "Bearer anon-key")).status).toBe(401);
  });

  it("answers invalid_request for a slug that isn't one", async () => {
    const response = await get("Smash Kaikei", "Bearer token");
    expect(response.status).toBe(400);
    expect(ApiError.parse(await response.json()).error).toBe("invalid_request");
  });

  it("answers not_found for an unknown seat, logging only the code", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = stubClient({ seats: [ok(null)] });
    vi.mocked(callerFor).mockResolvedValueOnce({ db: client, userId: A26 });
    const response = await get("no-such-seat", "Bearer token");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(log).toHaveBeenCalledWith(
      "GET /api/seats/[slug]/asked failed: not_found (ApiFailure)",
    );
  });

  it("answers the caller's own questions, never cached, with no embedding and no call out", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("no network in this test"));
    const { client, rpcCalls } = stubClient(
      {
        seats: [ok({ id: SMASH_KAIKEI })],
        questions: [
          ok([question(Q1, "answered", "2026-10-18T03:00:00+00:00")]),
        ],
        answers: [
          ok([
            { question_id: Q1, payload: saved(Q1, [["smash-2024-hokenjo"]]) },
          ]),
        ],
        notes: [
          cited(["smash-2024-hokenjo", "2024年度 会計", SMASH_KAIKEI, 2024]),
        ],
      },
      { seat_lineage: [terms(["2024", 2024])] },
    );
    vi.mocked(callerFor).mockResolvedValueOnce({ db: client, userId: A26 });
    const response = await get(SEAT, "Bearer token");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(Object.keys(body)).toEqual(["asked"]);
    const view = AskedView.parse(body);
    expect(view.asked.map((item) => item.questionId)).toEqual([Q1]);
    expect(stamps(view)).toEqual([["2024年度 会計", "2024"]]);
    expect(rpcCalls.map(([name]) => name)).toEqual(["seat_lineage"]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("logs only the code when a read fails, never the question", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = stubClient({
      seats: [ok({ id: SMASH_KAIKEI })],
      questions: [ok([question(Q1, "answered", "2026-10-18T03:00:00+00:00")])],
      answers: [{ data: null, error: { code: "XX000" } }],
    });
    vi.mocked(callerFor).mockResolvedValueOnce({ db: client, userId: A26 });
    const response = await get(SEAT, "Bearer token");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect(log.mock.calls).toEqual([
      ["GET /api/seats/[slug]/asked failed: unavailable (ApiFailure)"],
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toContain(Q01);
  });
});

describe("the clients", () => {
  beforeEach(() => resetMocks());

  it("createApi calls the route as the session's user and checks the answer against AskedView", async () => {
    const db = {
      auth: {
        getSession: async () => ({
          data: { session: { access_token: "token-a26" } },
        }),
      },
    } as unknown as SupabaseClient;
    const view: AskedView = {
      asked: [
        {
          questionId: Q1,
          text: Q01,
          lang: "ja",
          askedAt: "2026-10-18T03:00:00+00:00",
        },
      ],
    };
    const fetch = vi.fn(async () => Response.json(view));
    vi.stubGlobal("fetch", fetch);
    const api = createApi(db);
    expect(await api.asked(SEAT)).toEqual(view);
    expect(fetch).toHaveBeenCalledWith(`/api/seats/${SEAT}/asked`, {
      method: "GET",
      headers: { authorization: "Bearer token-a26" },
      body: undefined,
      signal: expect.any(AbortSignal),
    });
    vi.stubGlobal("fetch", async () =>
      Response.json({ asked: [{ questionId: "not-a-uuid" }] }),
    );
    expect((await api.asked(SEAT).catch((e) => e)).error).toBe("unavailable");
  });

  it("createMockApi lists a persona's own questions as its guide does", async () => {
    const newcomer = createMockApi("a26", { latencyMs: 0 });
    const outsider = createMockApi("x", { latencyMs: 0 });
    expect(await newcomer.asked(SEAT)).toEqual({ asked: [] });
    await newcomer.ask({ seat: SEAT, question: mockQuestions.q01 });
    await newcomer.ask({ seat: SEAT, question: mockQuestions.q04 });
    const { asked } = AskedView.parse(await newcomer.asked(SEAT));
    expect(asked).toEqual((await newcomer.guide(SEAT)).asked);
    expect(asked.map((item) => item.questionId)).toEqual([
      mockIds.q04,
      mockIds.q01,
    ]);
    expect(asked[1].answer).toEqual(mockAnswer);
    expect(await outsider.asked(SEAT)).toEqual({ asked: [] });
    await expect(newcomer.asked("no-such-seat")).rejects.toMatchObject({
      error: "not_found",
    });
  });
});
