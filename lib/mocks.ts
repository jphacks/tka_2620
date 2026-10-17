// Fixtures for every contract in lib/contracts.ts, built from seed/notes.csv, seed/questions.csv and
// seed/live-answer.txt (tests/mocks.test.ts checks them against the schemas and the seed). Screens use
// createMockApi while NEXT_PUBLIC_USE_MOCKS=1; the engine uses only mockModelReplies, in tests.
// Synthetic like the seed: no names, and no canary.
import {
  type AbstainedResult,
  type AnsweredResult,
  type AnswerOutput,
  type AnswersRow,
  type Api,
  type ApiErrorCode,
  AskRequest,
  type AskResult,
  type CardDraft,
  type Citation,
  type DedupeOutput,
  type DraftOutput,
  DraftRequest,
  type DraftResponse,
  type EventsRow,
  type FollowupOutput,
  type HandoverPrompt,
  type ImportedCard,
  type ImportOutput,
  ImportRequest,
  type ImportResponse,
  type InboxItem,
  type Lang,
  type LiveAnswer,
  type MyNote,
  type MyNotesResponse,
  NoteId,
  type NotesRow,
  type PromptRoutesRow,
  type PromptsResponse,
  PublishRequest,
  type PublishResponse,
  ReadersQuery,
  type RealtimeRows,
  type RedactionCounts,
  type Scope,
  SeatQuery,
  SeatSlug,
  type SeatView,
  type WithdrawResponse,
} from "@/lib/contracts";

export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === "1";

// The demo accounts (docs/SPEC.md → Personas).
export type Persona = "a24" | "a25" | "a26" | "b" | "x";

// Fixed v4 uuids, so a question, its prompt and its answer line up across panes and tests
// (crypto.randomUUID needs https, and phones may load the dev server over plain http).
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

export const mockIds = {
  users: {
    a24: uuid(0x101),
    a25: uuid(0x102),
    a26: uuid(0x103),
    b: uuid(0x104),
    x: uuid(0x105),
  } satisfies Record<Persona, string>,
  q01: uuid(0x201),
  q02: uuid(0x202),
  q04: uuid(0x204),
  q05: uuid(0x205),
  keyPrompt: uuid(0x301), // the demand prompt q04 creates
  gapPrompt: uuid(0x302),
  corePrompt: uuid(0x303),
  liveNote: uuid(0x401), // the note a25 publishes in the live loop
};

const SEAT = "smash-kaikei";

// seed/questions.csv (q02 and q03 ask q01's question as b and x).
export const mockQuestions = {
  q01: "模擬店の保健所申請、いつまで？",
  q04: "部室の鍵を無くしたら、誰に連絡する？",
  q05: "合宿のお金はどう管理する？",
  q06: "打ち上げのお店はどこ？",
};

// seed/live-answer.txt: what a25 says in the live loop.
export const mockLiveAnswerText =
  "学生課の施設係に連絡してください。合鍵は顧問の先生が持っているので、その日のうちにお願いすれば借りられます。";

// Holders of smash-kaikei; bylines come from the club_role label pack (「{term}年度 {seat}」), as in scripts/seed.ts.
const holders: Partial<Record<Persona, { term: string; byline: string }>> = {
  a24: { term: "2024", byline: "2024年度 会計" },
  a25: { term: "2025", byline: "2025年度 会計" },
  a26: { term: "2026", byline: "2026年度 会計" },
};

const cite = {
  hokenjo2024: {
    noteId: "smash-2024-hokenjo",
    byline: "2024年度 会計",
    termLabel: "2024",
  },
  hokenjo2025: {
    noteId: "smash-2025-hokenjo",
    byline: "2025年度 会計",
    termLabel: "2025",
  },
  gasshuku: {
    noteId: "smash-2025-gasshuku",
    byline: "2025年度 会計",
    termLabel: "2025",
  },
  gakusai: {
    noteId: "gakusai-2025-hokenjo",
    byline: "2025年度 模擬店担当",
    termLabel: "2025",
  },
  live: {
    noteId: mockIds.liveNote,
    byline: "2025年度 会計",
    termLabel: "2025",
  },
} satisfies Record<string, Citation>;

const noFlags = { person_verdict: false, secret: false };
const noSettings = {
  noteExpiry: false,
  groupOwnsCriticalNotes: false,
  requiredPrompts: false,
};
const noRedaction: RedactionCounts = {
  names: 0,
  phones: 0,
  emails: 0,
  urls: 0,
  ids: 0,
  addresses: 0,
  accounts: 0,
  secrets: 0,
  people: 0,
};

// GET /api/seats/[slug] -------------------------------------------------------------

function smashView(
  viewerTerm?: string,
  upcoming: SeatView["upcoming"] = [],
): SeatView {
  return {
    seat: {
      slug: SEAT,
      name: "会計",
      seatType: "club_role",
      group: "テニスサークル Smash",
      institution: "みなと大学",
      settings: noSettings,
    },
    viewer: viewerTerm
      ? { isHolder: true, termLabel: viewerTerm }
      : { isHolder: false },
    lineage: ["2024", "2025", "2026"].map((term) => ({
      termLabel: term,
      termOrder: Number(term),
      isViewer: term === viewerTerm,
    })),
    upcoming,
  };
}

const hokenjoUpcoming: SeatView["upcoming"][number] = {
  noteId: "smash-2025-hokenjo",
  title: "保健所申請の締切が早くなった",
  date: "2026-10-20",
  byline: "2025年度 会計",
  lang: "ja",
};

// What each persona sees on /s/smash-kaikei: b and x see no note of this seat.
export const mockSeatViews: Record<Persona, SeatView> = {
  a24: smashView("2024", [
    {
      noteId: "smash-2024-hokenjo",
      title: "模擬店の保健所申請",
      date: "2026-10-27",
      byline: "2024年度 会計",
      lang: "ja",
    },
  ]),
  a25: smashView("2025", [hokenjoUpcoming]),
  a26: smashView("2026", [hokenjoUpcoming]),
  b: smashView(),
  x: smashView(),
};

// The other seats, for the same-layout screenshots on the slides; no persona holds them.
export const mockOtherSeatViews: Partial<Record<string, SeatView>> = {
  "gakusai-mogiten": {
    seat: {
      slug: "gakusai-mogiten",
      name: "模擬店担当",
      seatType: "club_role",
      group: "学祭実行委員会",
      institution: "みなと大学",
      settings: noSettings,
    },
    viewer: { isHolder: false },
    lineage: [{ termLabel: "2025", termOrder: 2025, isViewer: false }],
    upcoming: [],
  },
  "tum-ist-autumn": {
    seat: {
      slug: "tum-ist-autumn",
      name: "TUM → 東大IST / 秋学期",
      seatType: "exchange_route",
      group: "TUM交換留学",
      institution: "みなと大学",
      settings: noSettings,
    },
    viewer: { isHolder: false },
    lineage: [{ termLabel: "2025秋", termOrder: 2025, isViewer: false }],
    upcoming: [],
  },
  "lab-bioprinter": {
    seat: {
      slug: "lab-bioprinter",
      name: "バイオプリンタ担当",
      seatType: "lab_duty",
      group: "生体工学研",
      institution: "みなと大学",
      settings: {
        noteExpiry: true,
        groupOwnsCriticalNotes: true,
        requiredPrompts: false,
      },
    },
    viewer: { isHolder: false },
    lineage: [{ termLabel: "2025", termOrder: 2025, isViewer: false }],
    upcoming: [],
  },
};

// POST /api/ask -------------------------------------------------------------------------

// q01 as a26: every sentence cites the 2024 or 2025 note, and the 2025 rule change is flagged.
export const mockAnswer: AnsweredResult = {
  status: "answered",
  questionId: mockIds.q01,
  sentences: [
    {
      text: "模擬店の保健所申請は、学生課がまとめて受け付けています。",
      citations: [cite.hokenjo2024],
    },
    {
      text: "締切は10月20日で、学祭の3週間前です。",
      citations: [cite.hokenjo2025],
    },
    {
      text: "2024年の締切は10月27日だったので、1週間早くなりました。",
      citations: [cite.hokenjo2024, cite.hokenjo2025],
    },
    {
      text: "学生課の掲示板にしか出ないので、10月に入ったら必ず確認してください。",
      citations: [cite.hokenjo2025],
    },
  ],
  ruleChange: {
    termLabel: "2025",
    summary: "締切が10月27日から10月20日に早まりました。",
  },
  language: "ja",
};

// q02 as b (軽音サークル): only the 学祭実行委員会 note for the whole institution, so no date.
export const mockAnswerForOtherClub: AnsweredResult = {
  status: "answered",
  questionId: mockIds.q02,
  sentences: [
    {
      text: "模擬店を出すには、保健所への臨時出店の届出が必要です。",
      citations: [cite.gakusai],
    },
    {
      text: "手続きは学生課がまとめて受け付けているので、締切は学生課の掲示で確認してください。",
      citations: [cite.gakusai],
    },
  ],
  language: "ja",
};

// q05 as a26.
export const mockAnswerGasshuku: AnsweredResult = {
  status: "answered",
  questionId: mockIds.q05,
  sentences: [
    {
      text: "合宿のお金は、部費とは別の封筒で管理してください。",
      citations: [cite.gasshuku],
    },
    {
      text: "混ぜると、年度末の会計報告で必ず合わなくなります。",
      citations: [cite.gasshuku],
    },
  ],
  language: "ja",
};

// q04 as a26: nobody knew, so it went to last year's treasurer.
export const mockAbstained: AbstainedResult = {
  status: "abstained",
  questionId: mockIds.q04,
  promptId: mockIds.keyPrompt,
  routedTo: 1,
};

// The live loop -----------------------------------------------------------------------------

// GET /api/inbox?seat= as a25, after a26 asked q04.
export const mockInboxItem: InboxItem = {
  promptId: mockIds.keyPrompt,
  question: mockQuestions.q04,
  askedBy: "2026年度 会計",
  askCount: 1,
  askedAt: "2026-10-18T10:31:02+09:00",
  lang: "ja",
};

// POST /api/handover/draft for the spoken answer: one contact card, people only by role.
export const mockLiveCard: CardDraft = {
  kind: "contact",
  title: "部室の鍵を無くしたとき",
  body: "学生課の施設係に連絡する。合鍵は顧問の先生が持っているので、その日のうちにお願いすれば借りられる。",
  suggested_scope: "successor",
  critical: false,
  lang: "ja",
  flags: noFlags,
};

export const mockDraftRequest: DraftRequest = {
  seat: SEAT,
  promptId: mockIds.keyPrompt,
  answer: mockLiveAnswerText,
};

export const mockDraft: DraftResponse = { cards: [mockLiveCard] };

// An answer without a date gets one follow-up (F6).
export const mockDraftWithFollowup: DraftResponse = {
  cards: [
    {
      kind: "deadline",
      title: "保健所申請の締切",
      body: "学祭の前までに学生課に出す。",
      suggested_scope: "successor",
      critical: false,
      lang: "ja",
      flags: noFlags,
    },
  ],
  followup: { missing: "date", question: "締切は何月何日でしたか？" },
};

export const mockPublishRequest: PublishRequest = {
  seat: SEAT,
  promptId: mockIds.keyPrompt,
  cards: [{ ...mockLiveCard, scope: "successor" }],
};

export const mockPublish: PublishResponse = {
  noteIds: [mockIds.liveNote],
  reanswered: [mockIds.q04],
};

// What lands on a26's screen, signed 「2025年度 会計」.
export const mockLiveAnswer: LiveAnswer = {
  status: "answered",
  questionId: mockIds.q04,
  sentences: [
    { text: "学生課の施設係に連絡してください。", citations: [cite.live] },
    {
      text: "合鍵は顧問の先生が持っているので、その日のうちにお願いすれば借りられます。",
      citations: [cite.live],
    },
  ],
  language: "ja",
  live: { byline: "2025年度 会計" },
};

// Handover prompts ------------------------------------------------------------------------------

const gapPrompt: HandoverPrompt = {
  id: mockIds.gapPrompt,
  text: "口座の代表者を変えるとき、銀行に何を持っていけばいいですか？",
  reason: "gap",
  askCount: 0,
};
const corePrompt: HandoverPrompt = {
  id: mockIds.corePrompt,
  text: "新しい会計が最初の1か月で困りそうなことは何ですか？",
  reason: "core",
  askCount: 0,
};

// GET /api/handover/prompts?seat= as a25 while q04 waits: demand → gap → core.
export const mockPrompts: PromptsResponse = {
  prompts: [
    {
      id: mockIds.keyPrompt,
      text: mockQuestions.q04,
      reason: "demand",
      askCount: 1,
    },
    gapPrompt,
    corePrompt,
  ],
};

// GET /api/handover/readers: people besides the author (a25) in the seed world. successor: a26; group: a24 and
// a26; institution: every member at みなと大学; public: every account.
export const mockReaders: Record<Scope, number> = {
  successor: 1,
  group: 2,
  institution: 6,
  public: 7,
};

// POST /api/import ----------------------------------------------------------------------------

// seed/old-handover.sample.md, pasted and redacted in the browser (the 暗証番号 became [秘密]).
export const mockImportRequest: ImportRequest = {
  seat: SEAT,
  kind: "text",
  text: [
    "# 会計 引き継ぎ（2024年度 → 2025年度）",
    "- 部費：4月と10月に集める。1人3000円。4月は新歓が終わってから（GW明けまでに）",
    "- 通帳と印鑑は部室の金庫。[秘密]",
    "- 口座の代表者変更しないといけない。銀行に行く（何が必要かは忘れた）",
    "- 夏合宿：宿の予約は2月中に！去年ギリギリで大変だった。キャンセル料は2週間前から",
    "- 学祭：模擬店やる。去年は焼きそば。保健所の書類がある（学生課でもらう）。早めに出したほうがいい",
    "- 領収書は全部とっておく。宛名は「テニスサークルSmash」",
    "- 年度末（3月）に会計報告。部長と顧問の先生にハンコをもらう",
    "- コートの予約は毎月1日の朝9時から。すぐ埋まる",
  ].join("\n"),
  redaction: { ...noRedaction, secrets: 1 },
};

const oldHandoverCards: CardDraft[] = [
  {
    kind: "rule_of_thumb",
    title: "部費は4月と10月に集める",
    body: "部費は1人3000円で、4月と10月に集める。4月は新歓が終わってから、GW明けまでに集める。",
    suggested_scope: "successor",
    critical: false,
    lang: "ja",
    flags: noFlags,
  },
  {
    kind: "deadline",
    title: "夏合宿の宿は2月中に予約",
    body: "夏合宿の宿は2月中に予約する。ギリギリだと大変。キャンセル料は2週間前からかかる。",
    deadline_date: "2025-02-28",
    suggested_scope: "successor",
    critical: false,
    lang: "ja",
    flags: noFlags,
  },
  {
    kind: "rule_of_thumb",
    title: "領収書は全部とっておく",
    body: "領収書はすべて取っておく。宛名は「テニスサークルSmash」にする。",
    suggested_scope: "successor",
    critical: false,
    lang: "ja",
    flags: noFlags,
  },
  {
    kind: "unwritten_rule",
    title: "年度末の会計報告",
    body: "3月に会計報告をして、部長と顧問の先生にハンコをもらう。",
    suggested_scope: "successor",
    critical: false,
    lang: "ja",
    flags: noFlags,
  },
  {
    kind: "pitfall",
    title: "コートの予約はすぐ埋まる",
    body: "コートの予約は毎月1日の朝9時に始まり、すぐに埋まる。",
    suggested_scope: "successor",
    critical: false,
    lang: "ja",
    flags: noFlags,
  },
];

const oldHandoverMissing = [
  {
    topic: "保健所申請の締切",
    reason:
      "模擬店の保健所の書類のことはありますが、締切の日付が書かれていません。",
    prompt: "模擬店の保健所申請の締切はいつですか？",
  },
  {
    topic: "口座の代表者変更に必要なもの",
    reason:
      "代表者を変える必要があると書かれていますが、銀行に持っていくものがありません。",
    prompt: gapPrompt.text,
  },
];

export const mockImport: ImportResponse = {
  cards: oldHandoverCards.map(
    (card): ImportedCard => ({
      ...card,
      source: "import",
      provenance: "貼り付け・2026年10月",
    }),
  ),
  missing: oldHandoverMissing,
  blocked: [
    {
      title: "通帳と印鑑の保管場所",
      reason: "隠した情報（[秘密]）が残っていたため、作りませんでした",
    },
  ],
  duplicates: [
    {
      card: 2,
      noteId: "smash-2025-ryoshusho",
      title: "領収書は月末にまとめて精算",
      byline: "2025年度 会計",
      similarity: 0.91,
    },
  ],
};

// seed/notice-2026.sample.pdf: the 学生課 notice that moves the deadline to 10/19, similar to the 2025 note.
export const mockImportNoticeRequest: ImportRequest = {
  seat: SEAT,
  kind: "file",
  fileType: "pdf",
  text: "学生課からのお知らせ（2026年10月）\n模擬店を出す団体は、保健所への臨時出店の届出を10月19日（月）までに学生課へ提出してください。",
  redaction: noRedaction,
};

export const mockImportNotice: ImportResponse = {
  cards: [
    {
      kind: "deadline",
      title: "保健所申請の締切は10月19日",
      body: "2026年から、模擬店の保健所への届出は10月19日までに学生課へ出す。",
      deadline_date: "2026-10-19",
      suggested_scope: "successor",
      critical: false,
      lang: "ja",
      flags: noFlags,
      source: "file",
      provenance: "PDF・2026年10月",
    },
  ],
  missing: [],
  blocked: [],
  duplicates: [
    {
      card: 0,
      noteId: "smash-2025-hokenjo",
      title: "保健所申請の締切が早くなった",
      byline: "2025年度 会計",
      similarity: 0.93,
    },
  ],
};

// Withdrawal and my notes ---------------------------------------------------------------------

export const mockWithdraw: WithdrawResponse = {
  withdrawnAt: "2026-10-18T10:35:12.345+09:00",
};

// The seed notes on smash-kaikei and their authors (titles only: a note body never goes in a list).
type AuthoredNote = MyNote & { author: Persona };

const seedNote = (
  id: string,
  title: string,
  scope: Scope,
  author: Persona,
): AuthoredNote => ({ id, title, scope, status: "live", lang: "ja", author });

const seedNotes: AuthoredNote[] = [
  seedNote("smash-2024-hokenjo", "模擬店の保健所申請", "successor", "a24"),
  seedNote(
    "smash-2025-hokenjo",
    "保健所申請の締切が早くなった",
    "successor",
    "a25",
  ),
  seedNote(
    "smash-2025-ryoshusho",
    "領収書は月末にまとめて精算",
    "group",
    "a25",
  ),
  seedNote("smash-2025-gasshuku", "合宿のお金は別の封筒で", "successor", "a25"),
  seedNote(
    "smash-2025-uchiage",
    "打ち上げのお店（リークテスト用）",
    "successor",
    "a25",
  ),
];

function myNotesOf(persona: Persona): MyNotesResponse {
  return {
    notes: seedNotes
      .filter((note) => note.author === persona)
      .map(({ author: _author, ...note }) => note),
  };
}

// GET /api/me/notes for each persona, before anything is withdrawn.
export const mockMyNotes: Record<Persona, MyNotesResponse> = {
  a24: myNotesOf("a24"),
  a25: myNotesOf("a25"),
  a26: myNotesOf("a26"),
  b: myNotesOf("b"),
  x: myNotesOf("x"),
};

// Realtime rows ----------------------------------------------------------------------------------

export const mockPromptRoutesRow: PromptRoutesRow = {
  prompt_id: mockIds.keyPrompt,
  user_id: mockIds.users.a25,
  created_at: "2026-10-18T01:31:02.481+00:00",
  seen_at: null,
};

export const mockAnswersRow: AnswersRow = {
  question_id: mockIds.q04,
  payload: mockLiveAnswer,
  created_at: "2026-10-18T01:31:40.127+00:00",
};

export const mockNotesRow: NotesRow = {
  id: "smash-2025-hokenjo",
  status: "withdrawn",
};

export const mockEventsRow: EventsRow = {
  id: 1,
  kind: "withdraw",
  payload: { ms: 812 },
  created_at: "2026-10-18T01:35:13.157+00:00",
};

// Fake model replies (LLM contracts), for the engine's unit tests ---------------------------------

export const mockModelReplies: {
  answer: AnswerOutput;
  draft: DraftOutput;
  import: ImportOutput;
  followup: FollowupOutput;
  dedupe: DedupeOutput;
} = {
  // q01, before the code checks the ids against the retrieved notes.
  answer: {
    answerable: true,
    sentences: mockAnswer.sentences.map((sentence) => ({
      text: sentence.text,
      note_ids: sentence.citations.map((citation) => citation.noteId),
    })),
    language: "ja",
  },
  draft: { cards: [mockLiveCard] },
  import: { cards: oldHandoverCards, missing: oldHandoverMissing },
  followup: {
    needs_followup: true,
    missing: "date",
    question: "締切は何月何日でしたか？",
  },
  dedupe: { duplicate_of: null, prompt: mockQuestions.q04 },
};

// The mock API ------------------------------------------------------------------------------------
// Small in-memory state shared by every persona in this browser tab, like the real tables: an unanswered question
// reaches a25's inbox, publishing answers the asker, and withdrawing a note changes every answer that cited it.
// Realtime rows are pushed only within this tab.

// The failed-request body as an error, so `ApiError.safeParse(error)` works on mocks and real errors alike.
export class MockApiError extends Error {
  readonly error: ApiErrorCode;
  constructor(error: ApiErrorCode) {
    super(error);
    this.name = "MockApiError";
    this.error = error;
  }
}

type Waiting = {
  promptId: string;
  question: string;
  lang: Lang;
  askedAt: string;
  askers: { questionId: string; persona: Persona }[];
};

type State = {
  next: number;
  waiting: Map<string, Waiting>; // demand prompts routed to a25, by prompt id
  answers: Map<string, { asker: Persona; result: AnsweredResult }>; // latest answer per question, as answered
  learned: Map<string, AnsweredResult>; // answers published for a question, by its text
  published: (MyNote & { author: Persona })[];
  withdrawn: Map<string, string>; // note id → withdrawnAt
};

function freshState(): State {
  return {
    next: 0x1000,
    waiting: new Map(),
    answers: new Map(),
    learned: new Map(),
    published: [],
    withdrawn: new Map(),
  };
}

let state = freshState();

type Listener = {
  persona: Persona;
  channel: keyof RealtimeRows;
  onRow: (row: unknown) => void;
};
const listeners = new Set<Listener>();

// Back to the seed state (pnpm demo:reset on mocks). Subscriptions stay.
export function resetMocks() {
  state = freshState();
}

const keyOf = (question: string) => question.trim().replace(/[？?\s]+$/, "");
// Hiragana, katakana or kanji (U+3040–30FF, U+4E00–9FFF) → ja.
const langOf = (text: string): Lang => (/[぀-ヿ一-鿿]/.test(text) ? "ja" : "en");
const now = () => new Date().toISOString();
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// What each persona gets for the questions in seed/questions.csv, before anything is withdrawn.
const scripted: {
  persona: Persona;
  question: string;
  result: AnsweredResult;
}[] = [
  { persona: "a26", question: mockQuestions.q01, result: mockAnswer },
  { persona: "b", question: mockQuestions.q01, result: mockAnswerForOtherClub },
  { persona: "a26", question: mockQuestions.q05, result: mockAnswerGasshuku },
];

// a26's questions keep the fixture ids, so the screens and tests can match them.
const fixedQuestionIds: Record<string, string> = {
  [keyOf(mockQuestions.q01)]: mockIds.q01,
  [keyOf(mockQuestions.q04)]: mockIds.q04,
  [keyOf(mockQuestions.q05)]: mockIds.q05,
};

function newId(): string {
  state.next += 1;
  return uuid(state.next);
}

function push<C extends keyof RealtimeRows>(
  persona: Persona,
  channel: C,
  row: RealtimeRows[C],
  latencyMs: number,
) {
  setTimeout(() => {
    for (const listener of listeners) {
      if (listener.persona === persona && listener.channel === channel) {
        listener.onRow(structuredClone(row));
      }
    }
  }, latencyMs);
}

// Like the engine after a withdrawal: a sentence that cited a withdrawn note goes, and with it the rule change;
// with nothing left, the question abstains.
function withoutWithdrawn(result: AnsweredResult): AskResult {
  const sentences = result.sentences.filter((sentence) =>
    sentence.citations.every(
      (citation) => !state.withdrawn.has(citation.noteId),
    ),
  );
  if (sentences.length === result.sentences.length) return result;
  if (sentences.length === 0) {
    return {
      status: "abstained",
      questionId: result.questionId,
      promptId: newId(),
      routedTo: 0,
    };
  }
  return {
    status: "answered",
    questionId: result.questionId,
    sentences,
    language: result.language,
    live: result.live,
  };
}

function notesOf(persona: Persona) {
  return [...seedNotes, ...state.published].filter(
    (note) => note.author === persona,
  );
}

// The answer to a published prompt: the card bodies, sentence by sentence, each citing its new note.
function answerFromCards(
  cards: PublishRequest["cards"],
  noteIds: string[],
  citation: Omit<Citation, "noteId">,
  language: Lang,
): Omit<AnsweredResult, "questionId"> {
  if (cards[0]?.body === mockLiveCard.body) {
    const { questionId: _questionId, ...live } = mockLiveAnswer;
    return live;
  }
  return {
    status: "answered",
    sentences: cards.flatMap((card, i) =>
      (card.body.match(/[^。.!?！？]+[。.!?！？]?/g) ?? [card.body]).map(
        (text) => ({
          text: text.trim(),
          citations: [{ ...citation, noteId: noteIds[i] }],
        }),
      ),
    ),
    language,
    live: { byline: citation.byline },
  };
}

// An Api bound to one persona, like a pane's own Supabase client. latencyMs delays every reply and push.
export function createMockApi(
  persona: Persona = "a26",
  { latencyMs = 300 }: { latencyMs?: number } = {},
): Api {
  async function reply<T>(value: T): Promise<T> {
    await sleep(latencyMs);
    return structuredClone(value);
  }

  function askAs(seat: string, question: string): AskResult {
    const key = keyOf(question);
    const questionId = (persona === "a26" && fixedQuestionIds[key]) || newId();
    const scriptedResult =
      seat === SEAT
        ? scripted.find(
            (entry) =>
              entry.persona === persona && keyOf(entry.question) === key,
          )?.result
        : undefined;
    // After a predecessor published for this question, holders get that answer (no longer live).
    const learned =
      seat === SEAT && holders[persona] ? state.learned.get(key) : undefined;
    const known: AnsweredResult | undefined =
      scriptedResult ?? (learned && { ...learned, questionId });
    if (known) {
      state.answers.set(known.questionId, { asker: persona, result: known });
      return withoutWithdrawn(known);
    }
    // Nobody knew. Holders' questions reach the reachable predecessor (a25); the rule for anyone else is #7's call.
    const routed = seat === SEAT && holders[persona] && persona !== "a25";
    if (!routed) {
      return {
        status: "abstained",
        questionId,
        promptId: newId(),
        routedTo: 0,
      };
    }
    let waiting = [...state.waiting.values()].find(
      (prompt) => keyOf(prompt.question) === key,
    );
    if (!waiting) {
      waiting = {
        promptId:
          key === keyOf(mockQuestions.q04) ? mockIds.keyPrompt : newId(),
        question: question.trim(),
        lang: langOf(question),
        askedAt: now(),
        askers: [],
      };
      state.waiting.set(waiting.promptId, waiting);
      push(
        "a25",
        "prompt_routes",
        {
          prompt_id: waiting.promptId,
          user_id: mockIds.users.a25,
          created_at: waiting.askedAt,
          seen_at: null,
        },
        latencyMs,
      );
    }
    if (!waiting.askers.some((asker) => asker.questionId === questionId)) {
      waiting.askers.push({ questionId, persona });
    }
    return {
      status: "abstained",
      questionId,
      promptId: waiting.promptId,
      routedTo: 1,
    };
  }

  return {
    async seat(slug) {
      const view =
        SeatSlug.parse(slug) === SEAT
          ? mockSeatViews[persona]
          : mockOtherSeatViews[slug];
      if (!view) throw new MockApiError("not_found");
      return reply({
        ...view,
        upcoming: view.upcoming.filter(
          (item) => !state.withdrawn.has(item.noteId),
        ),
      });
    },

    async ask(request) {
      const { seat, question } = AskRequest.parse(request);
      return reply(askAs(seat, question));
    },

    async inbox(query) {
      const { seat } = SeatQuery.parse(query);
      const items: InboxItem[] =
        seat === SEAT && persona === "a25"
          ? [...state.waiting.values()].map((prompt) => ({
              promptId: prompt.promptId,
              question: prompt.question,
              askedBy:
                holders[prompt.askers[0]?.persona ?? "a26"]?.byline ?? "",
              askCount: prompt.askers.length,
              askedAt: prompt.askedAt,
              lang: prompt.lang,
            }))
          : [];
      return reply({ items });
    },

    async draft(request) {
      const { answer } = DraftRequest.parse(request);
      if (answer.includes("施設係")) return reply(mockDraft);
      if (answer.includes("学祭の前")) return reply(mockDraftWithFollowup);
      const card: CardDraft = {
        kind: "rule_of_thumb",
        title: answer.split(/[。.!?！？\n]/)[0].slice(0, 20),
        body: answer,
        suggested_scope: "successor",
        critical: false,
        lang: langOf(answer),
        flags: noFlags,
      };
      return reply({ cards: [card] });
    },

    async publish(request) {
      const { seat, promptId, cards } = PublishRequest.parse(request);
      const holder = holders[persona];
      if (seat !== SEAT || !holder) throw new MockApiError("forbidden");
      const noteIds = cards.map((_card, i) =>
        i === 0 && promptId === mockIds.keyPrompt ? mockIds.liveNote : newId(),
      );
      cards.forEach((card, i) => {
        state.published.push({
          id: noteIds[i],
          title: card.title,
          scope: card.scope,
          status: "live",
          lang: card.lang,
          author: persona,
        });
      });
      const waiting = promptId ? state.waiting.get(promptId) : undefined;
      const reanswered: string[] = [];
      if (waiting) {
        state.waiting.delete(waiting.promptId);
        const answer = answerFromCards(
          cards,
          noteIds,
          { byline: holder.byline, termLabel: holder.term },
          waiting.lang,
        );
        state.learned.set(keyOf(waiting.question), {
          ...answer,
          questionId: "",
          live: undefined,
        });
        for (const asker of waiting.askers) {
          const result = { ...answer, questionId: asker.questionId };
          state.answers.set(asker.questionId, { asker: asker.persona, result });
          push(
            asker.persona,
            "answers",
            {
              question_id: asker.questionId,
              payload: withoutWithdrawn(result),
              created_at: now(),
            },
            latencyMs,
          );
          reanswered.push(asker.questionId);
        }
      }
      return reply({ noteIds, reanswered });
    },

    async prompts(query) {
      const { seat } = SeatQuery.parse(query);
      if (seat !== SEAT || !holders[persona]) return reply({ prompts: [] });
      const demand: HandoverPrompt[] =
        persona === "a25"
          ? [...state.waiting.values()].map((prompt) => ({
              id: prompt.promptId,
              text: prompt.question,
              reason: "demand",
              askCount: prompt.askers.length,
            }))
          : [];
      return reply({ prompts: [...demand, gapPrompt, corePrompt].slice(0, 3) });
    },

    async readers(query) {
      const { seat, scope } = ReadersQuery.parse(query);
      return reply({ count: seat === SEAT ? mockReaders[scope] : 0 });
    },

    async import(request) {
      const parsed = ImportRequest.parse(request);
      // The server's safety net: a phone number or email that survived the browser's redaction is rejected.
      if (/\d{2,4}-\d{2,4}-\d{3,4}|[\w.+-]+@[\w-]+\.[\w.]+/.test(parsed.text)) {
        throw new MockApiError("unredacted");
      }
      return reply(
        parsed.kind === "file" && parsed.fileType === "pdf"
          ? mockImportNotice
          : mockImport,
      );
    },

    async withdraw(noteId) {
      const id = NoteId.parse(noteId);
      if (!notesOf(persona).some((note) => note.id === id)) {
        throw new MockApiError("not_found");
      }
      const withdrawnAt = state.withdrawn.get(id) ?? now();
      state.withdrawn.set(id, withdrawnAt);
      // Every answer that cited the note is answered again, in every pane.
      for (const [questionId, { asker, result }] of state.answers) {
        const cited = result.sentences.some((sentence) =>
          sentence.citations.some((citation) => citation.noteId === id),
        );
        if (cited) {
          push(
            asker,
            "answers",
            {
              question_id: questionId,
              payload: withoutWithdrawn(result),
              created_at: withdrawnAt,
            },
            latencyMs,
          );
        }
      }
      push(persona, "notes", { id, status: "withdrawn" }, latencyMs);
      return reply({ withdrawnAt });
    },

    async myNotes() {
      return reply({
        notes: notesOf(persona).map(
          ({ author: _author, ...note }): MyNote => ({
            ...note,
            status: state.withdrawn.has(note.id) ? "withdrawn" : "live",
          }),
        ),
      });
    },

    subscribe(channel, onRow) {
      const listener: Listener = {
        persona,
        channel,
        onRow: onRow as (row: unknown) => void,
      };
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// The two buttons for the live loop on one device (#4, #6) ----------------------------------------

// The newcomer asks q04: a25's inbox slip arrives.
export function mockNewcomerAsks(): Promise<AskResult> {
  return createMockApi("a26").ask({ seat: SEAT, question: mockQuestions.q04 });
}

// Last year's treasurer answers by voice and publishes: the signed answer lands on a26's screen.
export async function mockPredecessorAnswers(): Promise<PublishResponse> {
  const api = createMockApi("a25");
  const { cards } = await api.draft(mockDraftRequest);
  return api.publish({
    seat: SEAT,
    promptId: mockIds.keyPrompt,
    cards: cards.map((card) => ({ ...card, scope: card.suggested_scope })),
  });
}
