// Publishing (F3.8) through a stub client and fake models, offline. Who may read what is the database's job, checked
// against the shared project by scripts/check-publish.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  type ApiErrorCode,
  LiveAnswer,
  type PublishCard,
  type PublishRequest,
} from "@/lib/contracts";
import { noteText } from "@/lib/embed";
import {
  handlePublish,
  type PublishModels,
  publishAsCaller,
} from "@/lib/engine/publish";
import { mockLiveCard, mockQuestions } from "@/lib/mocks";
import {
  type Call,
  fakeModel,
  promptText,
  type Result,
  stubClient,
} from "./fakes";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SEAT_ID = "33333333-3333-4333-8333-333333333333";
const PROMPT_ID = "22222222-2222-4222-8222-222222222222";
const QUESTION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_QUESTION_ID = "44444444-4444-4444-8444-444444444444";
const NOTE_ID = "55555555-5555-4555-8555-555555555555";
const BYLINE = "2025年度 会計"; // a25's term at Smash's 会計, worded by the club_role label pack

const card: PublishCard = { ...mockLiveCard, scope: "successor" };
const request: PublishRequest = {
  seat: "smash-kaikei",
  promptId: PROMPT_ID,
  cards: [card],
};

const ok = (data: unknown): Result => ({ data, error: null });
const seat = ok({ id: SEAT_ID, name: "会計", seat_type: "club_role" });
const term = ok([{ term_label: "2025", term_order: 2025, byline: BYLINE }]);
const prompt = (kind = "demand") =>
  ok({ id: PROMPT_ID, kind, text: mockQuestions.q04 });
const inserted = ok([
  {
    id: NOTE_ID,
    seat_id: SEAT_ID,
    term_order: 2025,
    byline: BYLINE,
    kind: card.kind,
    title: card.title,
    body: card.body,
    deadline_date: null,
    lang: "ja",
  },
]);
const waiting = (...questions: [id: string, readable: string[]][]) =>
  ok(
    questions.map(([question_id, readable_note_ids]) => ({
      question_id,
      lang: "ja",
      readable_note_ids,
    })),
  );
const reply = {
  answerable: true,
  sentences: [
    {
      text: "少額なら予備費から出し、大きい額は次年度の会計に回します。",
      note_ids: [NOTE_ID],
    },
  ],
  language: "ja",
};

function models(answer: unknown = reply, finish?: "stop" | "length") {
  const model = fakeModel(answer, finish);
  const embedded: string[][] = [];
  const fake: PublishModels = {
    embed: async (texts) => {
      embedded.push(texts);
      return texts.map(() => new Array(1024).fill(0.01));
    },
    answer: () => model,
  };
  return { fake, model, embedded };
}

// One publish through the stub. The defaults are the live loop's: a25 answers q04's demand prompt, which a26 waits on.
async function run(
  options: {
    tables?: Record<string, Result[]>;
    functions?: Record<string, Result | Result[]>;
    request?: PublishRequest;
    models?: ReturnType<typeof models>;
  } = {},
) {
  const stub = stubClient(
    {
      seats: [seat],
      seat_holders: [term],
      prompts: [prompt()],
      notes: [inserted],
      ...options.tables,
    },
    {
      waiting_questions: waiting([QUESTION_ID, [NOTE_ID]]),
      deliver_answer: ok(null),
      ...options.functions,
    },
  );
  const used = options.models ?? models();
  let result: Awaited<ReturnType<typeof publishAsCaller>> | undefined;
  let error: unknown;
  try {
    result = await publishAsCaller(
      stub.client,
      USER_ID,
      options.request ?? request,
      used.fake,
    );
  } catch (thrown) {
    error = thrown;
  }
  return { ...stub, ...used, result, error };
}

// The rows a notes query inserted.
const insertedRows = (queries: Call[][] | undefined) =>
  (queries ?? []).flat().find(([method]) => method === "insert")?.[1] as
    | Record<string, unknown>[]
    | undefined;

const delivered = (rpcCalls: [string, unknown][]) =>
  rpcCalls.flatMap(([name, args]) =>
    name === "deliver_answer"
      ? [args as { question: string; answer: unknown }]
      : [],
  );

afterEach(() => vi.restoreAllMocks());

describe("publishAsCaller", () => {
  it("publishes each card as the caller's note, signed with their latest term", async () => {
    const { result, calls, embedded } = await run();
    const [row] = insertedRows(calls.notes) ?? [];
    expect(row).toMatchObject({
      seat_id: SEAT_ID,
      term_order: 2025,
      author_user_id: USER_ID,
      byline: BYLINE,
      kind: card.kind,
      title: card.title,
      body: card.body,
      deadline_date: null,
      lang: "ja",
      scope: "successor",
      critical: false,
      valid_until: null,
      source: "live",
      provenance: null,
    });
    expect(JSON.parse(row.embedding as string)).toHaveLength(1024);
    expect(embedded).toEqual([[noteText(card)]]);
    expect(calls.seat_holders[0]).toEqual(
      expect.arrayContaining([
        ["eq", "seat_id", SEAT_ID],
        ["eq", "user_id", USER_ID],
        ["order", "term_order", { ascending: false }],
        ["limit", 1],
      ]),
    );
    expect(result?.noteIds).toEqual([NOTE_ID]);
  });

  it("answers every waiting question again, signed with the publisher's byline", async () => {
    const { result, rpcCalls, model } = await run();
    expect(rpcCalls[0]).toEqual([
      "waiting_questions",
      { prompt: PROMPT_ID, note_ids: [NOTE_ID] },
    ]);
    const [{ question, answer }] = delivered(rpcCalls);
    expect(question).toBe(QUESTION_ID);
    const live = LiveAnswer.parse(answer);
    expect(live).toMatchObject({
      status: "answered",
      questionId: QUESTION_ID,
      language: "ja",
      live: { byline: BYLINE },
    });
    expect(live.sentences.flatMap((sentence) => sentence.citations)).toEqual([
      { noteId: NOTE_ID, byline: BYLINE, termLabel: "2025" },
    ]);
    // The model answers the prompt's question from the new note, both as data.
    const asked = promptText(model);
    expect(asked).toContain(`<question>\n${mockQuestions.q04}\n</question>`);
    expect(asked).toContain(card.body);
    expect(result?.reanswered).toEqual([QUESTION_ID]);
  });

  it("asks the model once for askers who may read the same notes", async () => {
    const { result, rpcCalls, model } = await run({
      functions: {
        waiting_questions: waiting(
          [QUESTION_ID, [NOTE_ID]],
          [OTHER_QUESTION_ID, [NOTE_ID]],
        ),
      },
    });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(delivered(rpcCalls).map((call) => call.question)).toEqual([
      QUESTION_ID,
      OTHER_QUESTION_ID,
    ]);
    expect(result?.reanswered).toEqual([QUESTION_ID, OTHER_QUESTION_ID]);
  });

  it("leaves a question waiting when its asker may read none of the notes", async () => {
    const { result, rpcCalls, model } = await run({
      functions: { waiting_questions: waiting([QUESTION_ID, []]) },
    });
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(delivered(rpcCalls)).toEqual([]);
    expect(result).toEqual({ noteIds: [NOTE_ID], reanswered: [] });
  });

  it("leaves a question waiting when the notes don't answer it", async () => {
    const { result, rpcCalls } = await run({
      models: models({ answerable: false, sentences: [], language: "ja" }),
    });
    expect(delivered(rpcCalls)).toEqual([]);
    expect(result).toEqual({ noteIds: [NOTE_ID], reanswered: [] });
  });

  it("keeps the notes published when answering fails afterwards, and logs no text", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const refused = await run({
      functions: { deliver_answer: { data: null, error: { code: "42501" } } },
    });
    expect(refused.result).toEqual({ noteIds: [NOTE_ID], reanswered: [] });
    const cutOff = await run({ models: models(reply, "length") });
    expect(cutOff.result).toEqual({ noteIds: [NOTE_ID], reanswered: [] });
    expect(log).toHaveBeenCalledWith(
      "POST /api/handover/publish: answering a waiting question failed: forbidden (ApiFailure)",
    );
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain(mockQuestions.q04);
    expect(logged).not.toContain(card.body);
  });

  it("signs a handover note when the prompt isn't a newcomer's question", async () => {
    const plain = await run({
      request: { seat: "smash-kaikei", cards: [card] },
    });
    expect(insertedRows(plain.calls.notes)?.[0].source).toBe("handover");
    expect(plain.rpcCalls).toEqual([]);
    expect(plain.result).toEqual({ noteIds: [NOTE_ID], reanswered: [] });

    const core = await run({
      tables: { prompts: [prompt("core")] },
      functions: { waiting_questions: ok([]) },
    });
    expect(insertedRows(core.calls.notes)?.[0].source).toBe("handover");
    expect(delivered(core.rpcCalls)).toEqual([]);
  });

  it("keeps an added card's source and provenance", async () => {
    const { calls } = await run({
      request: {
        seat: "smash-kaikei",
        cards: [
          { ...card, source: "chat", provenance: "LINEグループ・2024年10月" },
        ],
      },
    });
    expect(insertedRows(calls.notes)?.[0]).toMatchObject({
      source: "chat",
      provenance: "LINEグループ・2024年10月",
    });
  });

  describe("refuses before writing anything", () => {
    it.each<[string, Parameters<typeof run>[0], ApiErrorCode]>([
      ["an unknown seat", { tables: { seats: [ok(null)] } }, "not_found"],
      [
        "someone who never held the seat",
        { tables: { seat_holders: [ok([])] } },
        "forbidden",
      ],
      [
        "a prompt the caller can't read",
        { tables: { prompts: [ok(null)] } },
        "not_found",
      ],
      [
        "a card with a phone number",
        {
          request: {
            ...request,
            cards: [{ ...card, body: "学生課（03-1234-5678）に電話する。" }],
          },
        },
        "unredacted",
      ],
      [
        "a card flagged as a secret",
        {
          request: {
            ...request,
            cards: [
              { ...card, flags: { person_verdict: false, secret: true } },
            ],
          },
        },
        "unredacted",
      ],
      [
        "「更新する」 before F5.6",
        {
          request: {
            ...request,
            cards: [{ ...card, supersedes: "smash-2025-hokenjo" }],
          },
        },
        "invalid_request",
      ],
      [
        "a provenance with a phone number in it",
        {
          request: {
            ...request,
            cards: [{ ...card, provenance: "会計の携帯 090-1234-5678" }],
          },
        },
        "unredacted",
      ],
      [
        "a provenance longer than a chip",
        {
          request: {
            ...request,
            cards: [{ ...card, provenance: "LINEグループ・".repeat(10) }],
          },
        },
        "invalid_request",
      ],
    ])("%s", async (_case, options, code) => {
      const { error, calls, embedded } = await run(options);
      expect(error).toMatchObject({ name: "ApiFailure", code });
      expect(calls.notes).toBeUndefined();
      expect(embedded).toEqual([]);
    });

    it("when embedding fails", async () => {
      const used = models();
      used.fake.embed = async () => {
        throw new Error("Ollama answered 500");
      };
      const { error, calls } = await run({ models: used });
      expect(error).toBeInstanceOf(Error);
      expect(calls.notes).toBeUndefined();
    });
  });

  it("turns the notes policy's refusal into forbidden", async () => {
    const { error } = await run({
      tables: { notes: [{ data: null, error: { code: "42501" } }] },
    });
    expect(error).toMatchObject({ name: "ApiFailure", code: "forbidden" });
  });

  it("turns the database's notes guard into unredacted", async () => {
    const { error } = await run({
      tables: { notes: [{ data: null, error: { code: "DD001" } }] },
    });
    expect(error).toMatchObject({ name: "ApiFailure", code: "unredacted" });
  });

  it("signs with the byline the caller's holding keeps, and refuses a holding without one", async () => {
    const signed = await run({
      tables: {
        seat_holders: [
          ok([{ term_label: "2025", term_order: 2025, byline: "2025 byline" }]),
        ],
      },
    });
    expect(insertedRows(signed.calls.notes)?.[0].byline).toBe("2025 byline");

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const unsigned = await run({
      tables: {
        seat_holders: [
          ok([{ term_label: "2025", term_order: 2025, byline: null }]),
        ],
      },
    });
    expect(unsigned.error).toMatchObject({ code: "forbidden" });
    expect(unsigned.calls.notes).toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      "POST /api/handover/publish: the caller's holding has no byline yet; run `pnpm seed` after 0007",
    );
    log.mockRestore();
  });

  it("refuses someone who never held the seat without blaming a byline", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { error } = await run({ tables: { seat_holders: [ok([])] } });
    expect(error).toMatchObject({ code: "forbidden" });
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("handlePublish", () => {
  const post = (body: BodyInit, token?: string) =>
    new Request("http://localhost/api/handover/publish", {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body,
    });

  it("refuses a request without a token", async () => {
    const response = await handlePublish(post(JSON.stringify(request)));
    expect(response.status).toBe(401);
    expect(ApiError.parse(await response.json()).error).toBe("unauthorized");
  });

  it("rejects a body that isn't a publish", async () => {
    for (const body of [
      "not json",
      JSON.stringify({ ...request, cards: [] }),
      JSON.stringify({ ...request, cards: [{ ...card, title: " " }] }),
    ]) {
      const response = await handlePublish(post(body, "test-token"));
      expect(response.status).toBe(400);
      expect(ApiError.parse(await response.json()).error).toBe(
        "invalid_request",
      );
    }
  });
});
