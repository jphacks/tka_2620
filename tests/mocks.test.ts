import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { locales } from "@/i18n/config";
import {
  AbstainedResult,
  AnsweredResult,
  AnswerOutput,
  AnswersRow,
  ApiError,
  DedupeOutput,
  DraftOutput,
  DraftRequest,
  DraftResponse,
  EventsRow,
  FollowupOutput,
  GapRequest,
  GapResponse,
  ImportOutput,
  ImportRequest,
  ImportResponse,
  InboxItem,
  InboxResponse,
  Lang,
  LiveAnswer,
  MyNotesResponse,
  NotesRow,
  NoteView,
  PromptRoutesRow,
  PromptsResponse,
  PublishCard,
  PublishRequest,
  PublishResponse,
  ReadersResponse,
  SeatType,
  SeatView,
  SeenResponse,
  WithdrawResponse,
} from "@/lib/contracts";
import {
  createMockApi,
  MockApiError,
  mockAbstained,
  mockAnswer,
  mockAnswerForOtherClub,
  mockAnswerGasshuku,
  mockAnswersRow,
  mockDraft,
  mockDraftRequest,
  mockDraftWithFollowup,
  mockEventsRow,
  mockGap,
  mockGapRequest,
  mockIds,
  mockImport,
  mockImportNotice,
  mockImportNoticeRequest,
  mockImportRequest,
  mockInboxItem,
  mockLiveAnswer,
  mockLiveAnswerText,
  mockModelReplies,
  mockMyNotes,
  mockNotesRow,
  mockNoteViews,
  mockOtherSeatViews,
  mockPromptRoutesRow,
  mockPrompts,
  mockPublish,
  mockPublishRequest,
  mockQuestions,
  mockReaders,
  mockSeatViews,
  mockSeen,
  mockWithdraw,
  resetMocks,
} from "@/lib/mocks";
import ja from "@/messages/ja.json";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const csv = (path: string) =>
  parse(read(path), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  }) as Record<string, string>[];
const notes = csv("seed/notes.csv");
const questions = csv("seed/questions.csv");

const fixtures: [string, z.ZodType, unknown][] = [
  ...Object.entries(mockSeatViews).map(
    ([persona, view]): [string, z.ZodType, unknown] => [
      `SeatView as ${persona}`,
      SeatView,
      view,
    ],
  ),
  ...Object.entries(mockOtherSeatViews).map(
    ([slug, view]): [string, z.ZodType, unknown] => [
      `SeatView of ${slug}`,
      SeatView,
      view,
    ],
  ),
  ["AskResult q01", AnsweredResult, mockAnswer],
  ["AskResult q02", AnsweredResult, mockAnswerForOtherClub],
  ["AskResult q05", AnsweredResult, mockAnswerGasshuku],
  ["AskResult q04", AbstainedResult, mockAbstained],
  ["InboxItem", InboxItem, mockInboxItem],
  ["SeenResponse", SeenResponse, mockSeen],
  ["DraftRequest", DraftRequest, mockDraftRequest],
  ["DraftResponse", DraftResponse, mockDraft],
  ["DraftResponse with a follow-up", DraftResponse, mockDraftWithFollowup],
  ["PublishRequest", PublishRequest, mockPublishRequest],
  ["PublishResponse", PublishResponse, mockPublish],
  ["LiveAnswer", LiveAnswer, mockLiveAnswer],
  ["PromptsResponse", PromptsResponse, mockPrompts],
  ["GapRequest", GapRequest, mockGapRequest],
  ["GapResponse", GapResponse, mockGap],
  ...Object.values(mockReaders).map((count): [string, z.ZodType, unknown] => [
    "ReadersResponse",
    ReadersResponse,
    { count },
  ]),
  ["ImportRequest (paste)", ImportRequest, mockImportRequest],
  ["ImportResponse (paste)", ImportResponse, mockImport],
  ["ImportRequest (PDF)", ImportRequest, mockImportNoticeRequest],
  ["ImportResponse (PDF)", ImportResponse, mockImportNotice],
  ["WithdrawResponse", WithdrawResponse, mockWithdraw],
  ...Object.entries(mockMyNotes).map(
    ([persona, list]): [string, z.ZodType, unknown] => [
      `MyNotesResponse as ${persona}`,
      MyNotesResponse,
      list,
    ],
  ),
  ["PromptRoutesRow", PromptRoutesRow, mockPromptRoutesRow],
  ["AnswersRow", AnswersRow, mockAnswersRow],
  ["NotesRow", NotesRow, mockNotesRow],
  ...mockNoteViews.map((note): [string, z.ZodType, unknown] => [
    `NoteView ${note.id}`,
    NoteView,
    note,
  ]),
  ["EventsRow", EventsRow, mockEventsRow],
  ["AnswerOutput", AnswerOutput, mockModelReplies.answer],
  ["DraftOutput", DraftOutput, mockModelReplies.draft],
  ["ImportOutput", ImportOutput, mockModelReplies.import],
  ["FollowupOutput", FollowupOutput, mockModelReplies.followup],
  ["DedupeOutput", DedupeOutput, mockModelReplies.dedupe],
];

describe("every mock matches its contract", () => {
  it.each(fixtures)("%s", (_name, schema, fixture) => {
    expect(schema.safeParse(fixture).error?.issues).toBeUndefined();
  });
});

describe("the contracts", () => {
  it("know every seat type that has a label pack, and every locale", () => {
    expect([...SeatType.options].sort()).toEqual(
      Object.keys(ja.seatTypes).sort(),
    );
    expect([...Lang.options]).toEqual([...locales]);
  });

  it("enforce the citation and deadline rules", () => {
    const sentence = mockAnswer.sentences[0];
    expect(
      AnsweredResult.safeParse({
        ...mockAnswer,
        sentences: [{ ...sentence, citations: [] }],
      }).success,
    ).toBe(false);
    expect(
      AnsweredResult.safeParse({ ...mockAnswer, sentences: [] }).success,
    ).toBe(false);
    const { deadline_date: _date, ...undated } = mockImportNotice.cards[0];
    expect(
      PublishCard.safeParse({ ...undated, scope: "successor" }).success,
    ).toBe(false);
  });

  it.each([
    ["AnswerOutput", AnswerOutput],
    ["DraftOutput", DraftOutput],
    ["ImportOutput", ImportOutput],
    ["FollowupOutput", FollowupOutput],
    ["DedupeOutput", DedupeOutput],
  ])("turn %s into a JSON Schema for structured output", (_name, schema) => {
    expect(() => z.toJSONSchema(schema)).not.toThrow();
  });
});

// Only the demo path is pinned to the seed, so most content changes don't touch lib/mocks.ts.
describe("the mocks follow the seed", () => {
  const question = (id: string) => {
    const row = questions.find((candidate) => candidate.id === id);
    if (!row) throw new Error(`seed/questions.csv has no ${id}`);
    return row;
  };

  it("q01: the newcomer's question and the notes it cites", () => {
    const q01 = question("q01");
    expect(q01.persona).toBe("a26");
    expect(
      mockQuestions.q01,
      "q01 changed in seed/questions.csv: update lib/mocks.ts",
    ).toBe(q01.question);
    const cited = new Set(
      mockAnswer.sentences.flatMap((sentence) =>
        sentence.citations.map((citation) => citation.noteId),
      ),
    );
    expect(
      [...cited].sort(),
      "q01's expected notes changed in seed/questions.csv: update lib/mocks.ts",
    ).toEqual(q01.expected_notes.split(";").sort());
    expect(mockAnswer.ruleChange?.termLabel).toBe("2025");
  });

  it("q04: the question nobody can answer, and the spoken live answer", () => {
    const q04 = question("q04");
    expect(q04.persona).toBe("a26");
    expect(
      mockQuestions.q04,
      "q04 changed in seed/questions.csv: update lib/mocks.ts",
    ).toBe(q04.question);
    expect(q04.expected_notes).toBe("");
    expect(
      mockLiveAnswerText,
      "seed/live-answer.txt changed: update mockLiveAnswerText in lib/mocks.ts",
    ).toBe(read("seed/live-answer.txt").trim());
  });

  it("uses only note ids and terms that exist in seed/notes.csv", () => {
    const citations = [
      mockAnswer,
      mockAnswerForOtherClub,
      mockAnswerGasshuku,
    ].flatMap((result) => result.sentences.flatMap((s) => s.citations));
    const ids = [
      ...citations.map((citation) => citation.noteId),
      ...Object.values(mockSeatViews).flatMap((view) =>
        view.upcoming.map((item) => item.noteId),
      ),
      ...Object.values(mockMyNotes).flatMap((list) =>
        list.notes.map((note) => note.id),
      ),
      ...[mockImport, mockImportNotice].flatMap((result) =>
        result.duplicates.map((duplicate) => duplicate.noteId),
      ),
    ];
    for (const id of new Set(ids)) {
      expect(
        notes.some((note) => note.id === id),
        `lib/mocks.ts uses ${id}, which isn't in seed/notes.csv: update the mock`,
      ).toBe(true);
    }
    for (const citation of citations) {
      expect(
        notes.find((note) => note.id === citation.noteId)?.term_label,
        `${citation.noteId} has another term in seed/notes.csv: update lib/mocks.ts`,
      ).toBe(citation.termLabel);
    }
  });

  it("open the cited notes as seed/notes.csv has them", () => {
    for (const note of mockNoteViews) {
      const row = notes.find((seed) => seed.id === note.id);
      // Compared field by field as booleans, so a failure names the note and the field, never a body or a canary.
      const same = {
        kind: note.kind === row?.kind,
        title: note.title === row?.title,
        body: note.body === row?.body,
        deadline: (note.deadlineDate ?? "") === row?.deadline_date,
        term: note.byline.slice(0, 4) === row?.term_label,
        noCanary: !row?.canary,
      };
      expect(
        same,
        `${note.id} differs from seed/notes.csv: update lib/mocks.ts`,
      ).toEqual({
        kind: true,
        title: true,
        body: true,
        deadline: true,
        term: true,
        noCanary: true,
      });
    }
  });

  it("contain no canary string", () => {
    const canaries = [
      ...notes.map((note) => note.canary ?? ""),
      ...read("seed/chat-canaries.txt").split("\n"),
    ]
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));
    expect(canaries.length).toBeGreaterThan(0);
    const source = read("lib/mocks.ts") + read("lib/contracts.ts");
    // Counted, never printed: a failure must not log a canary.
    const found = canaries.filter((canary) => source.includes(canary)).length;
    expect(found, "lib/mocks.ts or lib/contracts.ts holds a canary").toBe(0);
  });
});

describe("createMockApi", () => {
  const seat = "smash-kaikei";
  beforeEach(() => resetMocks());

  it("runs the live loop: abstain → inbox → draft → publish → signed answer", async () => {
    const newcomer = createMockApi("a26", { latencyMs: 0 });
    const senpai = createMockApi("a25", { latencyMs: 0 });
    const routes: PromptRoutesRow[] = [];
    const answers: AnswersRow[] = [];
    const stopRoutes = senpai.subscribe("prompt_routes", (row) =>
      routes.push(row),
    );
    const stopAnswers = newcomer.subscribe("answers", (row) =>
      answers.push(row),
    );

    expect(await newcomer.ask({ seat, question: mockQuestions.q04 })).toEqual(
      mockAbstained,
    );
    await vi.waitFor(() => expect(routes).toHaveLength(1));
    expect(PromptRoutesRow.parse(routes[0]).prompt_id).toBe(
      mockAbstained.promptId,
    );
    const inbox = InboxResponse.parse(await senpai.inbox({ seat }));
    expect(inbox.items).toMatchObject([
      {
        promptId: mockInboxItem.promptId,
        question: mockInboxItem.question,
        askedBy: "2026年度 会計",
        askCount: 1,
      },
    ]);
    expect(await senpai.prompts({ seat })).toEqual(mockPrompts);
    expect((await newcomer.inbox({ seat })).items).toEqual([]);

    const draft = await senpai.draft({
      seat,
      promptId: mockIds.keyPrompt,
      answer: mockLiveAnswerText,
    });
    expect(draft).toEqual(mockDraft);
    const published = await senpai.publish({
      seat,
      promptId: mockIds.keyPrompt,
      cards: draft.cards.map((card) => ({
        ...card,
        scope: card.suggested_scope,
      })),
    });
    expect(published).toEqual(mockPublish);
    await vi.waitFor(() => expect(answers).toHaveLength(1));
    expect(LiveAnswer.parse(answers[0].payload)).toEqual(mockLiveAnswer);
    expect((await senpai.inbox({ seat })).items).toEqual([]);

    const again = await newcomer.ask({ seat, question: mockQuestions.q04 });
    expect(again.status).toBe("answered");
    expect(again.status === "answered" && again.live).toBeFalsy();
    stopRoutes();
    stopAnswers();
  });

  it("drops a withdrawn note from every answer and pushes the change", async () => {
    const newcomer = createMockApi("a26", { latencyMs: 0 });
    const senpai = createMockApi("a25", { latencyMs: 0 });
    const answers: AnswersRow[] = [];
    const stop = newcomer.subscribe("answers", (row) => answers.push(row));
    expect(await newcomer.ask({ seat, question: mockQuestions.q01 })).toEqual(
      mockAnswer,
    );

    const { withdrawnAt } = await senpai.withdraw("smash-2025-hokenjo");
    expect(WithdrawResponse.safeParse({ withdrawnAt }).success).toBe(true);
    await vi.waitFor(() => expect(answers).toHaveLength(1));
    for (const result of [
      AnswersRow.parse(answers[0]).payload,
      await newcomer.ask({ seat, question: mockQuestions.q01 }),
    ]) {
      expect(result.status).toBe("answered");
      if (result.status !== "answered") continue;
      expect(result.ruleChange).toBeUndefined();
      expect(
        result.sentences.flatMap((s) => s.citations.map((c) => c.noteId)),
      ).not.toContain("smash-2025-hokenjo");
    }
    expect((await newcomer.seat(seat)).upcoming).toEqual([]);
    expect(
      (await senpai.myNotes()).notes.find(
        (note) => note.id === "smash-2025-hokenjo",
      )?.status,
    ).toBe("withdrawn");
    stop();
  });

  it("shows the outsider nothing", async () => {
    const outsider = createMockApi("x", { latencyMs: 0 });
    const view = await outsider.seat(seat);
    expect(view.viewer.isHolder).toBe(false);
    expect(view.upcoming).toEqual([]);
    const asked = await outsider.ask({ seat, question: mockQuestions.q01 });
    expect(asked).toMatchObject({ status: "abstained", routedTo: 0 });
    expect(asked).not.toHaveProperty("promptId"); // no seat, so no prompt (route_question)
    expect((await outsider.inbox({ seat })).items).toEqual([]);
    expect((await outsider.myNotes()).notes).toEqual([]);
  });

  it("names the prompt of a holder's question that reaches nobody, as route_question does", async () => {
    // a25 is the seat's only reachable holder, and an asker never reaches themselves.
    const senpai = createMockApi("a25", { latencyMs: 0 });
    const asked = await senpai.ask({ seat, question: mockQuestions.q04 });
    expect(asked).toMatchObject({ status: "abstained", routedTo: 0 });
    expect(asked.status === "abstained" && asked.promptId).toBeTruthy();
    expect((await senpai.inbox({ seat })).items).toEqual([]);
  });

  it("records when a25 first opens a slip, and lets nobody else", async () => {
    const newcomer = createMockApi("a26", { latencyMs: 0 });
    const senpai = createMockApi("a25", { latencyMs: 0 });
    const asked = await newcomer.ask({ seat, question: mockQuestions.q04 });
    if (asked.status !== "abstained" || !asked.promptId) {
      throw new Error("q04 should reach a25's inbox");
    }
    const first = await senpai.seen({ promptId: asked.promptId });
    expect(SeenResponse.safeParse(first).success).toBe(true);
    expect(await senpai.seen({ promptId: asked.promptId })).toEqual(first);
    await expect(
      newcomer.seen({ promptId: asked.promptId }),
    ).rejects.toMatchObject({ error: "not_found" });
  });

  it("opens a cited note only within the persona's scope, and not once it's withdrawn", async () => {
    const outcome = (persona: "a26" | "b" | "x", id: string) =>
      createMockApi(persona, { latencyMs: 0 })
        .note(id)
        .then(
          () => "readable",
          (error: unknown) => ApiError.parse(error).error,
        );
    const hokenjo = await createMockApi("a26", { latencyMs: 0 }).note(
      "smash-2025-hokenjo",
    );
    expect(hokenjo.byline).toBe("2025年度 会計");
    expect(await outcome("b", "smash-2025-hokenjo")).toBe("not_found");
    expect(await outcome("x", "smash-2025-hokenjo")).toBe("not_found");
    expect(await outcome("b", "gakusai-2025-hokenjo")).toBe("readable");
    expect(await outcome("x", "gakusai-2025-hokenjo")).toBe("not_found");
    await createMockApi("a25", { latencyMs: 0 }).withdraw("smash-2025-hokenjo");
    expect(await outcome("a26", "smash-2025-hokenjo")).toBe("not_found");
  });

  it("rejects what the real API would reject", async () => {
    const newcomer = createMockApi("a26", { latencyMs: 0 });
    await expect(newcomer.ask({ seat, question: "  " })).rejects.toThrow();
    const notMine = await newcomer
      .withdraw("smash-2025-hokenjo")
      .catch((error: unknown) => error);
    expect(notMine).toBeInstanceOf(MockApiError);
    expect(ApiError.parse(notMine)).toEqual({ error: "not_found" });
    await expect(
      newcomer.import({ ...mockImportRequest, text: "電話は 03-0000-0000" }),
    ).rejects.toMatchObject({ error: "unredacted" });
  });

  it("adds a missing item as a gap prompt once, for holders of the seat only", async () => {
    const newcomer = createMockApi("a26", { latencyMs: 0 });
    expect(await newcomer.gap(mockGapRequest)).toEqual(mockGap);
    const text = mockImport.missing[0].prompt;
    const added = await newcomer.gap({ seat, text });
    expect(added.promptId).not.toBe(mockGap.promptId);
    expect(
      await createMockApi("a25", { latencyMs: 0 }).gap({ seat, text }),
    ).toEqual(added);
    const { prompts } = await createMockApi("a24", { latencyMs: 0 }).prompts({
      seat,
    });
    expect(prompts.map((prompt) => [prompt.reason, prompt.text])).toEqual([
      ["gap", mockGapRequest.text],
      ["gap", text],
      ["core", mockPrompts.prompts[2].text],
    ]);
    for (const [persona, code] of [
      ["x", "forbidden"],
      ["b", "forbidden"],
    ] as const) {
      await expect(
        createMockApi(persona, { latencyMs: 0 }).gap({ seat, text }),
      ).rejects.toMatchObject({ error: code });
    }
    await expect(
      newcomer.gap({ seat, text: "[電話番号] に聞く" }),
    ).rejects.toMatchObject({ error: "unredacted" });
  });
});
