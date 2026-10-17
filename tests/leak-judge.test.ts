// The leak test's judge (tests/leak-judge.ts) catches each kind of leak and lets the in-scope twin pass, so a run of
// `pnpm test:leak` that reports 0 leaks can't mean the detector was blind. No database: the world is made up here,
// with the seed notes' real ids (the visibility table decides who reads them) and made-up texts.
import { describe, expect, it } from "vitest";
import {
  collectRows,
  type Finding,
  judgeFor,
  normalise,
  sameAnswer,
  type World,
} from "./leak-judge";

const user = {
  a24: "00000000-0000-4000-8000-000000000024",
  a25: "00000000-0000-4000-8000-000000000025",
  a26: "00000000-0000-4000-8000-000000000026",
  b: "00000000-0000-4000-8000-00000000000b",
  x: "00000000-0000-4000-8000-00000000000f",
};
const seat = {
  smash: "10000000-0000-4000-8000-000000000001",
  gakusai: "10000000-0000-4000-8000-000000000002",
};
const prompt = {
  routed: "20000000-0000-4000-8000-000000000001", // a26's question, routed to a25
  unrouted: "20000000-0000-4000-8000-000000000002", // a25's own question: routed to nobody
  core: "20000000-0000-4000-8000-000000000003",
};
const question = {
  a26: "30000000-0000-4000-8000-000000000026",
  a25: "30000000-0000-4000-8000-000000000025",
  x: "30000000-0000-4000-8000-00000000000f",
};

const world: World = {
  seedNotes: [
    {
      id: "smash-2025-uchiage",
      title: "打ち上げの店",
      body: "予約は合言葉で取れる。テスト用の本文です。",
      canary: "TEST-4242",
    },
    {
      id: "smash-2025-hokenjo",
      title: "保健所申請の締切",
      body: "2025年から学祭の三週間前までに出す（テスト）。",
      canary: "",
    },
    {
      id: "gakusai-2025-tsurisen",
      title: "釣り銭",
      body: "釣り銭は前日に両替しておく（テスト）。",
      canary: "",
    },
  ],
  noteAuthors: new Map([
    ["smash-2025-uchiage", user.a25],
    ["smash-2025-hokenjo", user.a25],
    ["smash-2025-ryoshusho", user.a25],
    ["smash-2024-hokenjo", user.a24],
    ["lab-2025-cartridge", null],
    ["gakusai-2025-tsurisen", null],
  ]),
  seatsHeld: new Map([
    [user.a24, new Set([seat.smash])],
    [user.a25, new Set([seat.smash])],
    [user.a26, new Set([seat.smash])],
  ]),
  questions: new Map([
    [question.a26, { askerUserId: user.a26, promptId: prompt.routed }],
    [question.a25, { askerUserId: user.a25, promptId: prompt.unrouted }],
    [question.x, { askerUserId: user.x, promptId: null }],
  ]),
  prompts: new Map([
    [prompt.routed, { seatId: seat.smash, kind: "demand" }],
    [prompt.unrouted, { seatId: seat.smash, kind: "demand" }],
    [prompt.core, { seatId: seat.smash, kind: "core" }],
  ]),
  routes: new Set([`${prompt.routed} ${user.a25}`]),
  personas: new Map(Object.entries(user).map(([key, id]) => [id, key])),
};

const x = judgeFor(world, { key: "x", userId: user.x });
const a24 = judgeFor(world, { key: "a24", userId: user.a24 });
const a25 = judgeFor(world, { key: "a25", userId: user.a25 });
const a26 = judgeFor(world, { key: "a26", userId: user.a26 });
const signedOut = judgeFor(world, { key: "signed out" });

const leaks = (findings: Finding[]) =>
  findings.filter((finding) => !finding.unknown);

describe("text anywhere in a response", () => {
  it("finds the canary of a note the viewer can't read, however it is written, deep in the value", () => {
    const row = {
      new: {
        payload: { sentences: [{ text: "番号は ｔｅｓｔ ４２４２ です" }] },
      },
    };
    expect(leaks(x.text(row))).toEqual([
      {
        reason: "the canary of a note it can't read",
        ref: "smash-2025-uchiage",
      },
    ]);
    expect(a26.text(row)).toEqual([]); // a26 reads the note, so the canary is in scope
  });

  it("finds the body of a note the viewer can't read, and an unreadable id as a whole token only", () => {
    expect(x.text(["…予約は合言葉で取れる。テスト用の本文です。…"])).toEqual([
      { reason: "the text of a note it can't read", ref: "smash-2025-uchiage" },
    ]);
    expect(x.text({ noteId: "smash-2025-hokenjo" })).toEqual([
      { reason: "a note it can't read", ref: "smash-2025-hokenjo" },
    ]);
    expect(x.text({ noteId: "smash-2025-hokenjo-2" })).toEqual([]);
    expect(x.text({ noteId: "gakusai-2025-tsurisen" })).toEqual([]); // public
  });

  it("normalises full-width letters, case, spaces and dashes", () => {
    expect(normalise("ｋｉｋｙｏ － ７７３１")).toBe(normalise("KIKYO-7731"));
  });
});

describe("table rows (direct reads, embedded selects)", () => {
  it("flags notes the viewer can't read and passes the ones it can", () => {
    expect(x.rows("notes", [{ id: "gakusai-2025-tsurisen" }])).toEqual([]);
    expect(x.rows("notes", [{ id: "smash-2025-uchiage" }])).toEqual([
      { reason: "a note it can't read", ref: "smash-2025-uchiage" },
    ]);
    expect(a24.rows("notes", [{ id: "smash-2025-hokenjo" }])).toEqual([
      { reason: "a note it can't read", ref: "smash-2025-hokenjo" }, // a later term's successor note
    ]);
  });

  it("walks embedded resources: someone else's holder row or note inside a public tree", () => {
    const tree = [
      {
        id: "institution",
        groups: [
          {
            id: "group",
            seats: [
              {
                id: seat.smash,
                seat_holders: [{ user_id: user.a25, seat_id: seat.smash }],
                notes: [{ id: "smash-2025-hokenjo" }],
              },
            ],
          },
        ],
      },
    ];
    expect(collectRows("institutions", tree).map((row) => row.table)).toEqual([
      "seat_holders",
      "notes",
      "seats",
      "groups",
      "institutions",
    ]);
    expect(x.rows("institutions", tree)).toEqual([
      { reason: "someone else's seat", ref: "seat_holders" },
      { reason: "a note it can't read", ref: "smash-2025-hokenjo" },
    ]);
    expect(a25.rows("institutions", tree)).toEqual([]);
  });

  it("allows only the viewer's own questions, answers, routes and memberships", () => {
    expect(a26.rows("questions", [{ id: question.a26 }])).toEqual([]);
    expect(a25.rows("questions", [{ id: question.a26 }])).toEqual([
      { reason: "someone else's question", ref: question.a26 },
    ]);
    expect(x.rows("answers", [{ question_id: question.a26 }])).toEqual([
      { reason: "someone else's answer", ref: question.a26 },
    ]);
    expect(
      a25.rows("prompt_routes", [
        { prompt_id: prompt.routed, user_id: user.a25 },
      ]),
    ).toEqual([]);
    expect(
      a26.rows("prompt_routes", [
        { prompt_id: prompt.routed, user_id: user.a25 },
      ]),
    ).toEqual([{ reason: "someone else's inbox route", ref: prompt.routed }]);
    expect(signedOut.rows("group_members", [{ user_id: user.b }])).toEqual([
      { reason: "someone else's membership", ref: "group_members" },
    ]);
  });

  it("shows a demand prompt only where it was routed, other prompts to the seat's holders", () => {
    expect(a25.rows("prompts", [{ id: prompt.routed }])).toEqual([]);
    expect(a26.rows("prompts", [{ id: prompt.routed }])).toEqual([
      { reason: "a prompt it may not read", ref: prompt.routed }, // its own question's prompt, not routed to it
    ]);
    expect(a24.rows("prompts", [{ id: prompt.core }])).toEqual([]);
    expect(x.rows("prompts", [{ id: prompt.core }])).toEqual([
      { reason: "a prompt it may not read", ref: prompt.core },
    ]);
  });

  it("lets signed-in viewers read withdraw events only", () => {
    expect(
      x.rows("events", [{ kind: "withdraw", payload: { ms: 3 } }]),
    ).toEqual([]);
    expect(x.rows("events", [{ kind: "loop", payload: { s: 12 } }])).toEqual([
      { reason: "an events row it may not read", ref: "loop" },
    ]);
  });

  it("marks a row the run didn't create as unknown, not as a leak", () => {
    const findings = x.rows("questions", [
      { id: "30000000-0000-4000-8000-0000000000ff" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].unknown).toBe(true);
  });
});

describe("questions (POST /api/ask)", () => {
  it("flags a citation of a note the asker can't read", () => {
    const answered = {
      status: "answered",
      questionId: question.x,
      sentences: [
        {
          text: "…",
          citations: [
            {
              noteId: "smash-2025-uchiage",
              byline: "2025年度 会計",
              termLabel: "2025",
            },
          ],
        },
      ],
      language: "ja",
    };
    expect(x.ask(answered, seat.smash)).toEqual([
      { reason: "a note it can't read", ref: "smash-2025-uchiage" },
    ]);
    expect(a26.ask(answered, seat.smash)).toEqual([]);
  });

  it("flags a stranger's question that reached a predecessor, not a holder's", () => {
    const routed = {
      status: "abstained",
      questionId: question.x,
      promptId: prompt.routed,
      routedTo: 1,
    };
    expect(x.ask(routed, seat.smash)).toEqual([
      {
        reason: "its question reached a predecessor at a seat it doesn't hold",
        ref: prompt.routed,
      },
    ]);
    expect(a26.ask(routed, seat.smash)).toEqual([]);
    expect(
      x.ask(
        { status: "abstained", questionId: question.x, routedTo: 0 },
        seat.smash,
      ),
    ).toEqual([]);
  });
});

describe("inbox", () => {
  it("shows only prompts routed to the viewer", () => {
    expect(a25.inbox([{ promptId: prompt.routed, question: "…" }])).toEqual([]);
    expect(x.inbox([{ prompt_id: prompt.routed, question: "…" }])).toEqual([
      { reason: "an inbox item routed to someone else", ref: prompt.routed },
    ]);
  });

  it("offers the predecessor only its own notes that the asker may read", () => {
    expect(
      a25.waiting([
        {
          question_id: question.a26,
          readable_note_ids: ["smash-2025-uchiage"],
        },
      ]),
    ).toEqual([]);
    expect(
      a24.waiting([
        {
          question_id: question.a26,
          readable_note_ids: ["smash-2025-ryoshusho"], // a24 reads it, but a25 wrote it
        },
      ]),
    ).toEqual([
      {
        reason: "a question waiting on a prompt not routed to it",
        ref: question.a26,
      },
      {
        reason: "a note it didn't write, offered for an answer",
        ref: "smash-2025-ryoshusho",
      },
    ]);
    expect(
      a25.waiting([
        {
          question_id: question.a26,
          readable_note_ids: ["lab-2025-cartridge"],
        },
      ]),
    ).toContainEqual({
      reason: "a note the asker can't read, offered for the answer",
      ref: "lab-2025-cartridge",
    });
  });
});

describe("seat page, own notes and lineage", () => {
  it("flags an upcoming deadline from a note the viewer can't read", () => {
    expect(
      x.seatView({ upcoming: [{ noteId: "smash-2025-hokenjo", title: "…" }] }),
    ).toEqual([{ reason: "a note it can't read", ref: "smash-2025-hokenjo" }]);
    expect(
      a26.seatView({
        upcoming: [{ noteId: "smash-2025-hokenjo", title: "…" }],
      }),
    ).toEqual([]);
  });

  it("lists only the viewer's own notes in 自分のメモ", () => {
    expect(a25.myNotes({ notes: [{ id: "smash-2025-hokenjo" }] })).toEqual([]);
    expect(a24.myNotes({ notes: [{ id: "smash-2025-ryoshusho" }] })).toEqual([
      {
        reason: "someone else's note in its own list",
        ref: "smash-2025-ryoshusho",
      },
    ]);
  });

  it("gives terms only in the lineage", () => {
    expect(
      signedOut.lineage([{ term_label: "2025", term_order: 2025 }]),
    ).toEqual([]);
    expect(
      signedOut.lineage([
        { term_label: "2025", term_order: 2025, user_id: user.a25 },
      ]),
    ).toEqual([
      { reason: "seat_lineage gives more than the terms", ref: "user_id" },
    ]);
  });
});

describe("Realtime messages", () => {
  const update = (id: string, body = "…") => ({
    table: "notes",
    eventType: "UPDATE",
    new: { id, status: "live", body },
    old: {},
    errors: null,
  });

  it("passes a re-saved note the viewer reads and flags one it doesn't, body and canary included", () => {
    expect(x.realtime(update("gakusai-2025-tsurisen"))).toEqual([]);
    expect(
      x.realtime(
        update(
          "smash-2025-uchiage",
          "予約は合言葉で取れる。テスト用の本文です。TEST-4242",
        ),
      ),
    ).toEqual([
      { reason: "a note it can't read", ref: "smash-2025-uchiage" },
      {
        reason: "the canary of a note it can't read",
        ref: "smash-2025-uchiage",
      },
      { reason: "the text of a note it can't read", ref: "smash-2025-uchiage" },
    ]);
  });

  it("flags any deleted row, any error notice and an events row of another kind", () => {
    expect(
      a25.realtime({
        table: "prompt_routes",
        eventType: "DELETE",
        new: {},
        old: { prompt_id: prompt.routed },
      }),
    ).toEqual([{ reason: "a deleted row", ref: "prompt_routes" }]);
    expect(
      x.realtime({
        table: "answers",
        eventType: "INSERT",
        new: {},
        old: {},
        errors: ["Error 401: Unauthorized"],
      }),
    ).toEqual([{ reason: "an error notice about a change", ref: "answers" }]);
    expect(
      x.realtime({
        table: "events",
        eventType: "INSERT",
        new: { id: 1, kind: "leak", payload: { probe: 1 } },
      }),
    ).toEqual([{ reason: "an events row it may not read", ref: "leak" }]);
    expect(
      a26.realtime({
        table: "answers",
        eventType: "INSERT",
        new: { question_id: question.a26, payload: {} },
      }),
    ).toEqual([]);
  });
});

describe("the answers trigger oracle", () => {
  it("compares two stored answers apart from their question id", () => {
    const abstained = (questionId: string) => ({
      status: "abstained",
      questionId,
      routedTo: 0,
    });
    expect(sameAnswer(abstained(question.a26), abstained(question.x))).toBe(
      true,
    );
    const kept = {
      status: "answered",
      questionId: question.a26,
      sentences: [{ text: "…", citations: [{ noteId: "smash-2025-uchiage" }] }],
    };
    expect(sameAnswer(kept, abstained(question.x))).toBe(false);
    expect(
      sameAnswer(
        { ...kept, sentences: [{ text: "…", citations: [{ noteId: "a" }] }] },
        {
          ...kept,
          questionId: question.x,
          sentences: [{ text: "…", citations: [{ noteId: "b" }] }],
        },
      ),
    ).toBe(false); // nested fields count
  });
});
