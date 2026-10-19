// GET /api/seats/[slug]/guide (the handover guide, 引き継ぎ書), offline: the flow as the caller with a scripted Supabase
// client (the seat; its notes, the caller's terms and questions; the prompts the policy lets through and the notes that
// name them; search_notes for each prompt left; the caller's answers and the notes they cite), then the handler, with
// callerFor stubbed so it reaches the flow without Supabase.
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/seats/[slug]/guide/route";
import { ApiError, GuideView } from "@/lib/contracts";
import { guideAsCaller } from "@/lib/engine/guide";
import { callerFor } from "@/lib/engine/route";
import {
  GAKUSAI_MOGITEN,
  q01Notes,
  type Result,
  SMASH_KAIKEI,
  stubClient,
} from "./fakes";

// The route's callerFor as it is, unless a test hands it a caller.
vi.mock("@/lib/engine/route", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/engine/route")>();
  return { ...actual, callerFor: vi.fn(actual.callerFor) };
});

afterEach(() => {
  vi.restoreAllMocks();
});

const TODAY = "2026-10-18";
const ok = (data: unknown): Result => ({ data, error: null });
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

// The scripted reads, in the order the guide makes them on each table: notes answers the seat's notes first, then the
// notes naming a prompt (a holder with prompts) or the cited notes (answered questions), so each test scripts one of
// the two. search_notes answers once per prompt left, seat_lineage once per seat of the cited notes. The caller holds
// nothing unless `held` says so.
type Script = {
  seat?: Result;
  notes?: Result[];
  held?: Result;
  questions?: Result;
  prompts?: Result;
  answers?: Result;
  search?: Result[];
  lineage?: Result[];
  embed?: (texts: string[]) => Promise<number[][]>;
};

function guide(script: Script = {}) {
  const stub = stubClient(
    {
      seats: [script.seat ?? ok({ id: SMASH_KAIKEI })],
      notes: script.notes ?? [ok([])],
      seat_holders: [script.held ?? ok([])],
      questions: [script.questions ?? ok([])],
      prompts: [script.prompts ?? ok([])],
      answers: [script.answers ?? ok([])],
    },
    { search_notes: script.search ?? [], seat_lineage: script.lineage ?? [] },
  );
  const embedded: string[][] = [];
  const embed =
    script.embed ??
    (async (texts: string[]) => {
      embedded.push(texts);
      return texts.map((_, i) => [i]);
    });
  return {
    ...stub,
    embedded,
    run: () =>
      guideAsCaller(stub.client, "smash-kaikei", { embed, today: TODAY }),
  };
}

const holds2026 = ok([{ term_order: 2026 }]);

// A note as the notes query returns it, with the columns the guide never selects, as if PostgREST sent them anyway.
const noteRow = (
  id: string,
  term: number,
  kind: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  kind,
  title: `${id}のタイトル`,
  body: `${id}の本文`,
  deadline_date: kind === "deadline" ? `${term}-10-20` : null,
  term_order: term,
  byline: `${term}年度 会計`,
  lang: "ja",
  author_user_id: uuid(0x99),
  scope: "successor",
  provenance: "貼り付け・2026年10月",
  embedding: "[0.1,0.2]",
  ...extra,
});

describe("guideAsCaller: the notes", () => {
  it("lists the seat's notes newest term first, then by kind, with no author, scope, provenance or embedding", async () => {
    const { run, calls } = guide({
      notes: [
        ok([
          noteRow("smash-2024-hokenjo", 2024, "deadline"),
          noteRow("smash-2025-gasshuku", 2025, "unwritten_rule"),
          noteRow("smash-2025-uchiage", 2025, "contact"),
          noteRow("smash-2025-hokenjo", 2025, "deadline"),
          noteRow("smash-2025-ryoshusho", 2025, "rule_of_thumb"),
        ]),
      ],
    });
    const returned = await run();
    const view = GuideView.parse(returned);
    expect(view.notes.map((note) => note.id)).toEqual([
      "smash-2025-hokenjo",
      "smash-2025-uchiage",
      "smash-2025-ryoshusho",
      "smash-2025-gasshuku",
      "smash-2024-hokenjo",
    ]);
    expect(view.notes[0]).toEqual({
      id: "smash-2025-hokenjo",
      kind: "deadline",
      title: "smash-2025-hokenjoのタイトル",
      body: "smash-2025-hokenjoの本文",
      deadlineDate: "2025-10-20",
      byline: "2025年度 会計",
      termOrder: 2025,
      lang: "ja",
    });
    // As returned, before the route's parse could drop a field: only the guide's own, and a date only on a deadline.
    const fields = [
      "id",
      "kind",
      "title",
      "body",
      "deadlineDate",
      "byline",
      "termOrder",
      "lang",
    ];
    for (const note of returned.notes) {
      for (const key of Object.keys(note)) expect(fields).toContain(key);
    }
    expect(returned.notes[1]).not.toHaveProperty("deadlineDate");
    // The policy picks the notes the caller may read; the query narrows to the seat's live notes that no later note
    // replaced and that haven't expired on Tokyo's date. The author, scope, provenance and embedding stay unselected.
    expect(calls.notes[0]).toEqual([
      [
        "select",
        "id, kind, title, body, deadline_date, term_order, byline, lang",
      ],
      ["eq", "seat_id", SMASH_KAIKEI],
      ["eq", "status", "live"],
      ["is", "superseded_by", null],
      ["or", "valid_until.is.null,valid_until.gte.2026-10-18"],
    ]);
  });

  it("drops a row that doesn't read, and the guide still opens", async () => {
    const { run } = guide({
      notes: [
        ok([
          noteRow("smash-2025-hokenjo", 2025, "deadline", {
            deadline_date: "10000-01-01",
          }),
          noteRow("smash-2024-hokenjo", 2024, "deadline"),
        ]),
      ],
    });
    expect((await run()).notes.map((note) => note.id)).toEqual([
      "smash-2024-hokenjo",
    ]);
  });

  it("writes nothing and calls no function for someone who holds nothing and asked nothing", async () => {
    const { run, calls, rpcCalls, embedded } = guide();
    expect(await run()).toEqual({
      notes: [],
      open: [],
      openChecked: true,
      asked: [],
    });
    const methods = Object.values(calls)
      .flat(2)
      .map(([method]) => method);
    expect(methods).not.toContain("insert");
    expect(methods).not.toContain("update");
    expect(rpcCalls).toEqual([]);
    expect(embedded).toEqual([]);
    expect(calls.seats[0]).toContainEqual(["eq", "slug", "smash-kaikei"]);
    expect(calls.seat_holders[0]).toContainEqual([
      "eq",
      "seat_id",
      SMASH_KAIKEI,
    ]);
    // Who isn't a holder reads no prompts, and nobody's answers but their own questions' (none here).
    expect(calls.prompts).toBeUndefined();
    expect(calls.answers).toBeUndefined();
  });

  it("answers not_found for an unknown seat, and by the database's code when a read fails", async () => {
    await expect(guide({ seat: ok(null) }).run()).rejects.toMatchObject({
      name: "ApiFailure",
      code: "not_found",
    });
    await expect(
      guide({ notes: [{ data: null, error: { code: "XX000" } }] }).run(),
    ).rejects.toMatchObject({ code: "unavailable" });
    await expect(
      guide({ questions: { data: null, error: { code: "42501" } } }).run(),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      guide({ questions: ok([{ id: "not-a-uuid" }]) }).run(),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("guideAsCaller: what isn't written yet", () => {
  const HOKENJO = "模擬店の保健所申請の締切はいつですか？";
  const ACCOUNT =
    "口座の代表者を変えるとき、銀行に何を持っていけばいいですか？";
  const DEADLINES =
    "毎年締切がある申請や提出は何ですか？いつまでに、どこへ出しますか？";
  const MONEY = "団体のお金は、どこで、どうやって管理していますか？";
  const REQUIRED = "学生課に出す書類は何ですか？";

  const prompt = (n: number, kind: string, seq: number, text: string) => ({
    id: uuid(n),
    kind,
    text,
    seq,
  });
  // The seat's open prompts, as the prompts query gives them (by seq).
  const seatPrompts = ok([
    prompt(20, "core", 1, DEADLINES),
    prompt(21, "core", 2, MONEY),
    prompt(22, "gap", 31, HOKENJO),
    prompt(23, "gap", 32, ACCOUNT),
    prompt(24, "required", 40, REQUIRED),
  ]);

  it("lists the prompts no note answers, gap, required, then core, checking them all in one embedding call", async () => {
    const { run, calls, rpcCalls, embedded } = guide({
      held: holds2026,
      prompts: seatPrompts,
      notes: [ok([]), ok([])],
      // In rank order: 保健所 finds q01's notes, the rest find nothing close.
      search: [ok(q01Notes), ok([]), ok([]), ok([]), ok([])],
    });
    const view = GuideView.parse(await run());
    expect(view.open).toEqual([
      { id: uuid(23), text: ACCOUNT, reason: "gap" },
      { id: uuid(24), text: REQUIRED, reason: "required" },
      { id: uuid(20), text: DEADLINES, reason: "core" },
      { id: uuid(21), text: MONEY, reason: "core" },
    ]);
    expect(view.openChecked).toBe(true);
    expect(embedded).toEqual([[HOKENJO, ACCOUNT, REQUIRED, DEADLINES, MONEY]]);
    expect(rpcCalls.map(([name]) => name)).toEqual(
      Array(5).fill("search_notes"),
    );
    expect(rpcCalls[0][1]).toMatchObject({ seat: "smash-kaikei", k: 8 });
    // Never a demand prompt: its text can be a newcomer's question as typed.
    expect(calls.prompts[0]).toEqual(
      expect.arrayContaining([
        ["select", "id, kind, text, seq"],
        ["eq", "seat_id", SMASH_KAIKEI],
        ["eq", "retired", false],
        ["in", "kind", ["gap", "required", "core"]],
        ["order", "seq"],
      ]),
    );
  });

  it("counts a note of any term, unlike the handover: a26 still gets asked about 保健所, but the guide calls it written", async () => {
    // The 2024 note is the clear match: older than a26's term, which the handover prompts would ask again.
    const { run } = guide({
      held: holds2026,
      prompts: ok([prompt(22, "gap", 31, HOKENJO)]),
      notes: [ok([]), ok([])],
      search: [ok(q01Notes.filter((note) => note.term_order === 2024))],
    });
    expect((await run()).open).toEqual([]);
  });

  it("isn't covered by another seat's note, however close", async () => {
    const otherSeat = q01Notes.filter((note) => note.seat_id !== SMASH_KAIKEI);
    expect(otherSeat.map((note) => note.seat_id)).toEqual([GAKUSAI_MOGITEN]);
    const { run } = guide({
      held: holds2026,
      prompts: ok([prompt(22, "gap", 31, HOKENJO)]),
      notes: [ok([]), ok([])],
      search: [ok(otherSeat)],
    });
    expect((await run()).open.map((open) => open.id)).toEqual([uuid(22)]);
  });

  it("leaves out a prompt a note the caller reads names, from any term, without embedding it", async () => {
    const { run, calls, embedded } = guide({
      held: holds2026,
      prompts: seatPrompts,
      notes: [ok([]), ok([{ prompt_id: uuid(23) }, { prompt_id: uuid(20) }])],
      search: [ok([]), ok([]), ok([])],
    });
    expect((await run()).open.map((open) => open.id)).toEqual([
      uuid(22),
      uuid(24),
      uuid(21),
    ]);
    expect(embedded).toEqual([[HOKENJO, REQUIRED, MONEY]]);
    expect(calls.notes[1]).toEqual(
      expect.arrayContaining([
        ["select", "prompt_id"],
        ["eq", "seat_id", SMASH_KAIKEI],
        ["eq", "status", "live"],
        ["or", "valid_until.is.null,valid_until.gte.2026-10-18"],
        ["in", "prompt_id", [20, 21, 22, 23, 24].map(uuid)],
      ]),
    );
    // No term floor: a predecessor's answer counts as much as the caller's own.
    expect(calls.notes[1].map(([method]) => method)).not.toContain("gte");
  });

  it("lists each text once, the first in rank order", async () => {
    const { run, embedded } = guide({
      held: holds2026,
      prompts: ok([
        prompt(20, "core", 1, ACCOUNT),
        prompt(23, "gap", 32, ACCOUNT),
      ]),
      notes: [ok([]), ok([])],
      search: [ok([])],
    });
    expect((await run()).open).toEqual([
      { id: uuid(23), text: ACCOUNT, reason: "gap" },
    ]);
    expect(embedded).toEqual([[ACCOUNT]]);
  });

  it("checks nothing when every prompt is named, and says it checked", async () => {
    const { run, embedded, rpcCalls } = guide({
      held: holds2026,
      prompts: ok([prompt(23, "gap", 32, ACCOUNT)]),
      notes: [ok([]), ok([{ prompt_id: uuid(23) }])],
    });
    expect(await run()).toMatchObject({ open: [], openChecked: true });
    expect(embedded).toEqual([]);
    expect(rpcCalls).toEqual([]);
  });

  it("says it couldn't check when Ollama is stopped, listing nothing, and logs only the code", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { run, rpcCalls } = guide({
      held: holds2026,
      prompts: seatPrompts,
      notes: [ok([noteRow("smash-2025-hokenjo", 2025, "deadline")]), ok([])],
      embed: async () => {
        throw new Error(`Ollama is down: ${HOKENJO}`);
      },
    });
    const view = GuideView.parse(await run());
    expect(view.open).toEqual([]);
    expect(view.openChecked).toBe(false);
    expect(view.notes.map((note) => note.id)).toEqual(["smash-2025-hokenjo"]);
    expect(rpcCalls).toEqual([]);
    expect(log).toHaveBeenCalledWith(
      "GET /api/seats/[slug]/guide: covered topics failed: unavailable (Error)",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(HOKENJO);
  });

  it("says it couldn't check when a search fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { run } = guide({
      held: holds2026,
      prompts: ok([
        prompt(23, "gap", 32, ACCOUNT),
        prompt(20, "core", 1, MONEY),
      ]),
      notes: [ok([]), ok([])],
      search: [ok([]), { data: null, error: { code: "XX000" } }],
    });
    expect(await run()).toMatchObject({ open: [], openChecked: false });
  });

  it("refuses a demand prompt the database should never have sent", async () => {
    await expect(
      guide({
        held: holds2026,
        prompts: ok([prompt(30, "demand", 1, "質問")]),
      }).run(),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("guideAsCaller: the caller's questions", () => {
  const Q1 = uuid(0x101);
  const Q2 = uuid(0x102);
  const Q3 = uuid(0x103);
  const Q01 = "模擬店の保健所申請、いつまで？";

  const question = (id: string, status: string, at: string, text = Q01) => ({
    id,
    text,
    lang: "ja",
    status,
    created_at: at,
  });
  // A saved answer as the asker's answers row may hold it: the bylines are stale, and it carries `live`.
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
        termLabel: "2025",
      })),
    })),
    language: "ja",
    ruleChange: { termLabel: "2025", summary: "10/27 → 10/20" },
    live: { byline: "古い署名" },
    ...extra,
  });
  // The cited notes as the caller reads them now: byline, seat and term.
  const bylines = (...notes: [string, string, string, number][]) =>
    ok(
      notes.map(([id, byline, seat_id, term_order]) => ({
        id,
        byline,
        seat_id,
        term_order,
      })),
    );
  // Smash 会計's terms, as seat_lineage() gives them: oldest first, never who held them.
  const smashTerms = ok(
    [2024, 2025, 2026].map((term) => ({
      term_label: String(term),
      term_order: term,
    })),
  );

  it("lists them newest first, each answer checked again: a sentence on a note the caller can't read goes, and the rule change with it", async () => {
    const { run, calls, rpcCalls } = guide({
      questions: ok([
        question(Q1, "answered", "2026-10-18T03:00:00+00:00"),
        question(Q2, "waiting", "2026-10-18T02:00:00+00:00", "部費はいくら？"),
      ]),
      answers: ok([
        {
          question_id: Q1,
          payload: saved(Q1, [
            ["smash-2024-hokenjo"],
            ["smash-2025-hokenjo", "smash-2024-hokenjo"],
            ["gakusai-2025-hokenjo"],
          ]),
        },
      ]),
      notes: [
        ok([]),
        // smash-2025-hokenjo doesn't come back: withdrawn, replaced, expired or out of the caller's scope.
        bylines(
          ["smash-2024-hokenjo", "2024年度 会計", SMASH_KAIKEI, 2024],
          [
            "gakusai-2025-hokenjo",
            "2025年度 模擬店担当",
            GAKUSAI_MOGITEN,
            2025,
          ],
        ),
      ],
      lineage: [smashTerms, ok([{ term_label: "2025", term_order: 2025 }])],
    });
    const view = GuideView.parse(await run());
    expect(view.asked).toEqual([
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
                  termLabel: "2024", // the lineage's, not the saved 2025
                },
              ],
            },
            {
              text: "文3。",
              citations: [
                {
                  noteId: "gakusai-2025-hokenjo",
                  byline: "2025年度 模擬店担当",
                  termLabel: "2025",
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
    expect(calls.questions[0]).toEqual([
      ["select", "id, text, lang, status, created_at"],
      ["eq", "seat_id", SMASH_KAIKEI],
      ["order", "created_at", { ascending: false }],
      ["limit", 20],
    ]);
    // Only the answered question's answer is read; a waiting question has none.
    expect(calls.answers[0]).toEqual([
      ["select", "question_id, payload"],
      ["in", "question_id", [Q1]],
    ]);
    // Every cited note once, of any seat, as search_notes would find it for an answer.
    expect(calls.notes[1]).toEqual([
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
    // Each seat's lineage once, for the terms of the notes that came back.
    expect(rpcCalls).toEqual([
      ["seat_lineage", { seat: SMASH_KAIKEI }],
      ["seat_lineage", { seat: GAKUSAI_MOGITEN }],
    ]);
  });

  it("keeps the rule change while every sentence stands, takes the bylines and terms from the notes, never `live`, and the question's own id", async () => {
    const { run } = guide({
      questions: ok([question(Q1, "answered", "2026-10-18T03:00:00+00:00")]),
      answers: ok([
        {
          question_id: Q1,
          // A payload naming another question: the row's id is the one that counts.
          payload: saved(Q3, [["smash-2024-hokenjo"], ["smash-2025-hokenjo"]]),
        },
      ]),
      notes: [
        ok([]),
        bylines(
          ["smash-2024-hokenjo", "2024年度 会計", SMASH_KAIKEI, 2024],
          ["smash-2025-hokenjo", "2025年度 会計", SMASH_KAIKEI, 2025],
        ),
      ],
      lineage: [smashTerms],
    });
    const [asked] = GuideView.parse(await run()).asked;
    expect(asked.answer?.questionId).toBe(Q1);
    expect(asked.answer?.ruleChange).toEqual({
      termLabel: "2025",
      summary: "10/27 → 10/20",
    });
    expect(asked.answer).not.toHaveProperty("live");
    expect(
      asked.answer?.sentences.flatMap((sentence) =>
        sentence.citations.map(({ byline, termLabel }) => [byline, termLabel]),
      ),
    ).toEqual([
      ["2024年度 会計", "2024"],
      ["2025年度 会計", "2025"],
    ]);
  });

  it("shows no answer once no sentence stands, for an abstain, or for a payload that doesn't read", async () => {
    const { run } = guide({
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
      notes: [ok([]), ok([])],
    });
    const view = GuideView.parse(await run());
    expect(view.asked.map((asked) => asked.questionId)).toEqual([Q1, Q2, Q3]);
    for (const asked of view.asked) expect(asked).not.toHaveProperty("answer");
  });

  it("reads no answers when every question waits", async () => {
    const { run, calls } = guide({
      questions: ok([question(Q1, "waiting", "2026-10-18T03:00:00+00:00")]),
    });
    expect((await run()).asked).toHaveLength(1);
    expect(calls.answers).toBeUndefined();
    expect(calls.notes).toHaveLength(1);
  });

  it("answers by the database's code when the answers or the cited notes can't be read", async () => {
    const answered = ok([
      question(Q1, "answered", "2026-10-18T03:00:00+00:00"),
    ]);
    await expect(
      guide({
        questions: answered,
        answers: { data: null, error: { code: "XX000" } },
      }).run(),
    ).rejects.toMatchObject({ code: "unavailable" });
    await expect(
      guide({
        questions: answered,
        answers: ok([
          { question_id: Q1, payload: saved(Q1, [["smash-2024-hokenjo"]]) },
        ]),
        notes: [ok([]), { data: null, error: { code: "42501" } }],
      }).run(),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("GET /api/seats/[slug]/guide", () => {
  const get = (slug: string, authorization?: string) =>
    GET(
      new Request(`http://localhost/api/seats/${slug}/guide`, {
        headers: authorization ? { authorization } : {},
      }),
      { params: Promise.resolve({ slug }) },
    );
  const A26 = uuid(0x103);

  it("answers unauthorized without a token, or with one that isn't a signed-in user's", async () => {
    const response = await get("smash-kaikei");
    expect(response.status).toBe(401);
    expect(ApiError.parse(await response.json()).error).toBe("unauthorized");
    vi.mocked(callerFor).mockResolvedValueOnce(undefined);
    expect((await get("smash-kaikei", "Bearer anon-key")).status).toBe(401);
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
      "GET /api/seats/[slug]/guide failed: not_found (ApiFailure)",
    );
  });

  it("answers the caller's guide, never cached", async () => {
    const { client } = stubClient({
      seats: [ok({ id: SMASH_KAIKEI })],
      notes: [ok([noteRow("smash-2024-hokenjo", 2024, "deadline")])],
      seat_holders: [ok([])],
      questions: [ok([])],
    });
    vi.mocked(callerFor).mockResolvedValueOnce({ db: client, userId: A26 });
    const response = await get("smash-kaikei", "Bearer token");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual([
      "asked",
      "notes",
      "open",
      "openChecked",
    ]);
    expect(GuideView.parse(body).notes.map((note) => note.id)).toEqual([
      "smash-2024-hokenjo",
    ]);
  });
});
