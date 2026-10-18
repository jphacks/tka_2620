// The only place screens and engine meet (docs/SPEC.md → Interfaces and LLM contracts). Change it by PR plus one
// line in Slack. API fields are camelCase; CardDraft, the Realtime rows and the LLM outputs keep SPEC's and the
// database's snake_case. Zod only, so route handlers, client components and tsx scripts can all import it.
import { z } from "zod";

// Shared values ----------------------------------------------------------------

// tests/mocks.test.ts pins these to i18n/config.ts and to the label packs (messages/*.json → seatTypes).
export const Lang = z.enum(["ja", "en"]);
export type Lang = z.infer<typeof Lang>;

export const SeatType = z.enum(["club_role", "exchange_route", "lab_duty"]);
export type SeatType = z.infer<typeof SeatType>;

export const Scope = z.enum(["successor", "group", "institution", "public"]);
export type Scope = z.infer<typeof Scope>;

export const NoteKind = z.enum([
  "deadline",
  "contact",
  "rule_of_thumb",
  "pitfall",
  "unwritten_rule",
]);
export type NoteKind = z.infer<typeof NoteKind>;

export const NoteStatus = z.enum(["live", "withdrawn"]);
export type NoteStatus = z.infer<typeof NoteStatus>;

export const NoteSource = z.enum([
  "handover",
  "live",
  "import",
  "file",
  "chat",
]);
export type NoteSource = z.infer<typeof NoteSource>;

// Where an added card came from (import = pasted text). The server sets handover or live for the others.
export const ImportSource = NoteSource.extract(["import", "file", "chat"]);
export type ImportSource = z.infer<typeof ImportSource>;

export const SeatSlug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/); // smash-kaikei

// notes.id is text: seed notes keep readable ids (smash-2025-hokenjo), new notes get a uuid.
export const NoteId = z.string().min(1);
export const Uuid = z.uuid(); // question, prompt and user ids
export const IsoDate = z.iso.date(); // YYYY-MM-DD
export const Timestamp = z.iso.datetime({ offset: true }); // timestamptz in ISO 8601
const Count = z.number().int().nonnegative();

// A note an answer sentence rests on. byline is the formatted stamp (「2025年度 会計」); termLabel is the raw term
// (「2025」, 「2025秋」), which screens format with the label pack.
export const Citation = z.object({
  noteId: NoteId,
  byline: z.string(),
  termLabel: z.string(),
});
export type Citation = z.infer<typeof Citation>;

// A drafted note for author review (card drafting, import). ModelCard below is the model's unchecked version.
export const CardDraft = z.object({
  kind: NoteKind,
  title: z.string(),
  body: z.string(),
  deadline_date: IsoDate.optional(), // always on a deadline card: one given without a date is drafted as another kind
  suggested_scope: Scope,
  critical: z.boolean(),
  valid_until: IsoDate.optional(), // seats with noteExpiry
  lang: Lang, // notes.lang; drafted cards render as notes
  flags: z.object({ person_verdict: z.boolean(), secret: z.boolean() }),
});
export type CardDraft = z.infer<typeof CardDraft>;

// GET /api/seats/[slug] ------------------------------------------------------------

export const SeatView = z.object({
  seat: z.object({
    slug: SeatSlug,
    name: z.string(),
    seatType: SeatType, // picks the label pack; never branch UI on it
    group: z.string(),
    institution: z.string(),
    // seats.settings with every flag filled in; the UI shows a control only when its flag is on.
    settings: z.object({
      noteExpiry: z.boolean(),
      groupOwnsCriticalNotes: z.boolean(),
      requiredPrompts: z.boolean(),
    }),
  }),
  viewer: z.object({ isHolder: z.boolean(), termLabel: z.string().optional() }),
  // Terms only, oldest first; opening the page never grants membership.
  lineage: z.array(
    z.object({
      termLabel: z.string(),
      termOrder: z.number().int(),
      isViewer: z.boolean(),
    }),
  ),
  // Deadline notes the viewer may read, soonest first. date is the deadline's next occurrence: a predecessor's
  // 2025-10-20 shows as 2026-10-20.
  upcoming: z.array(
    z.object({
      noteId: NoteId,
      title: z.string(),
      date: IsoDate,
      byline: z.string(),
      lang: Lang,
    }),
  ),
});
export type SeatView = z.infer<typeof SeatView>;

// POST /api/ask --------------------------------------------------------------------

export const AskRequest = z.object({
  seat: SeatSlug,
  question: z.string().trim().min(1).max(500),
});
export type AskRequest = z.infer<typeof AskRequest>;

export const AnswerSentence = z.object({
  text: z.string().min(1),
  citations: z.array(Citation).min(1), // every sentence cites at least one retrieved note
});
export type AnswerSentence = z.infer<typeof AnswerSentence>;

const LiveByline = z.object({ byline: z.string() }); // the predecessor who just answered: 「2025年度 会計」

export const AnsweredResult = z.object({
  status: z.literal("answered"),
  questionId: Uuid,
  sentences: z.array(AnswerSentence).min(1), // no sentence left → abstained
  // Computed in code from deadline_date across terms, never by the model.
  ruleChange: z
    .object({ termLabel: z.string(), summary: z.string() })
    .optional(),
  language: Lang, // the asker's language; sets lang on every sentence
  live: LiveByline.optional(),
});
export type AnsweredResult = z.infer<typeof AnsweredResult>;

export const AbstainedResult = z.object({
  status: z.literal("abstained"),
  questionId: Uuid,
  // The demand prompt it created or joined. Absent when the question routes nowhere, because the asker holds no seat
  // at the seat they asked or nobody but the asker could receive it: no prompt is created, so routedTo is 0 and there
  // is no prompt to name.
  promptId: Uuid.optional(),
  routedTo: Count, // reachable predecessors whose inbox it reached
});
export type AbstainedResult = z.infer<typeof AbstainedResult>;

export const AskResult = z.discriminatedUnion("status", [
  AnsweredResult,
  AbstainedResult,
]);
export type AskResult = z.infer<typeof AskResult>;

// Realtime `answers` in the live loop: the waiting question, answered and signed by the predecessor.
export const LiveAnswer = AnsweredResult.extend({ live: LiveByline });
export type LiveAnswer = z.infer<typeof LiveAnswer>;

// GET /api/inbox?seat= ---------------------------------------------------------------

export const SeatQuery = z.object({ seat: SeatSlug }); // also GET /api/handover/prompts?seat=
export type SeatQuery = z.infer<typeof SeatQuery>;

// A newcomer's question in a reachable predecessor's inbox. askedBy is the asker's seat and term
// (「2026年度 会計」), never a name; lang is questions.lang.
export const InboxItem = z.object({
  promptId: Uuid,
  question: z.string(),
  askedBy: z.string(),
  askCount: z.number().int().positive(),
  askedAt: Timestamp,
  lang: Lang,
});
export type InboxItem = z.infer<typeof InboxItem>;

export const InboxResponse = z.object({ items: z.array(InboxItem) });
export type InboxResponse = z.infer<typeof InboxResponse>;

// POST /api/inbox/seen ----------------------------------------------------------------

// The predecessor opened a slip (prompt_routes.seen_at). The first open counts: opening it again answers the same time.
export const SeenRequest = z.object({ promptId: Uuid });
export type SeenRequest = z.infer<typeof SeenRequest>;

export const SeenResponse = z.object({ seenAt: Timestamp });
export type SeenResponse = z.infer<typeof SeenResponse>;

// POST /api/handover/draft -------------------------------------------------------------

export const DraftRequest = z.object({
  seat: SeatSlug,
  promptId: Uuid,
  answer: z.string().trim().min(1).max(4000), // spoken or typed
  // The reply round (F6.3): the one follow-up the first draft asked, and the predecessor's reply to it. A draft with it
  // never asks again, so an answer gets at most one follow-up.
  followup: z
    .object({
      question: z.string().trim().min(1).max(200),
      answer: z.string().trim().min(1).max(1000),
    })
    .optional(),
});
export type DraftRequest = z.infer<typeof DraftRequest>;

export const FollowupMissing = z.enum(["date", "contact", "threshold"]);
export type FollowupMissing = z.infer<typeof FollowupMissing>;

export const Followup = z.object({
  missing: FollowupMissing,
  question: z.string(),
}); // at most one per answer: the reply round (DraftRequest.followup) gets none
export type Followup = z.infer<typeof Followup>;

export const DraftResponse = z.object({
  cards: z.array(CardDraft),
  followup: Followup.optional(),
});
export type DraftResponse = z.infer<typeof DraftResponse>;

// POST /api/handover/publish -----------------------------------------------------------

export const PublishCard = CardDraft.extend({
  title: z.string().trim().min(1).max(100),
  body: z.string().trim().min(1).max(2000),
  scope: Scope, // the picker defaults to successor
  supersedes: NoteId.optional(), // 「更新する」: the live note this card replaces
  provenance: z.string().optional(), // 「LINEグループ・2024年10月」, never a name
  source: ImportSource.optional(), // added cards only: import is stateless, so publish says where they came from
}).refine(
  (card) => card.kind !== "deadline" || card.deadline_date !== undefined,
  { message: "a deadline needs deadline_date", path: ["deadline_date"] },
);
export type PublishCard = z.infer<typeof PublishCard>;

export const PublishRequest = z.object({
  seat: SeatSlug,
  // The prompt the cards answer: a routed demand prompt re-answers every question waiting on it; a gap, required or core
  // prompt isn't asked of its author again (notes.prompt_id, 0011). Send it for every handover prompt, not only demand.
  promptId: Uuid.optional(),
  cards: z.array(PublishCard).min(1),
});
export type PublishRequest = z.infer<typeof PublishRequest>;

export const PublishResponse = z.object({
  noteIds: z.array(NoteId),
  reanswered: z.array(Uuid), // question ids
});
export type PublishResponse = z.infer<typeof PublishResponse>;

// GET /api/handover/prompts?seat= ------------------------------------------------------

export const PromptKind = z.enum(["demand", "gap", "required", "core"]); // also the ranking order
export type PromptKind = z.infer<typeof PromptKind>;

export const HandoverPrompt = z.object({
  id: Uuid,
  text: z.string(),
  reason: PromptKind,
  askCount: Count,
});
export type HandoverPrompt = z.infer<typeof HandoverPrompt>;

export const PromptsResponse = z.object({ prompts: z.array(HandoverPrompt) });
export type PromptsResponse = z.infer<typeof PromptsResponse>;

// POST /api/handover/prompts ------------------------------------------------------------

// 「先輩に聞く」 on the import review (F5.7): what an added text leaves out (a missing item's prompt) becomes a gap prompt of
// the seat, read by its holders among the handover prompts. The route refuses text with a name, contact details, a
// secret or a placeholder (unredacted); the same open text again is the same prompt.
export const GapRequest = z.object({
  seat: SeatSlug,
  text: z.string().trim().min(1).max(500),
});
export type GapRequest = z.infer<typeof GapRequest>;

export const GapResponse = z.object({ promptId: Uuid });
export type GapResponse = z.infer<typeof GapResponse>;

// GET /api/handover/readers?seat=&scope= ------------------------------------------------

export const ReadersQuery = z.object({ seat: SeatSlug, scope: Scope });
export type ReadersQuery = z.infer<typeof ReadersQuery>;

export const ReadersResponse = z.object({ count: Count }); // people besides the author; counts only
export type ReadersResponse = z.infer<typeof ReadersResponse>;

// POST /api/import -----------------------------------------------------------------------
// text was extracted and redacted in the browser; the file itself is never sent, and nothing is stored.

export const RedactionCounts = z.object({
  names: Count,
  phones: Count,
  emails: Count,
  urls: Count,
  ids: Count,
  addresses: Count,
  accounts: Count,
  secrets: Count,
  people: Count,
});
export type RedactionCounts = z.infer<typeof RedactionCounts>;

const importFields = {
  seat: SeatSlug,
  text: z.string().trim().min(1).max(100_000),
  redaction: RedactionCounts,
};
export const ImportRequest = z.discriminatedUnion("kind", [
  z.object({ ...importFields, kind: z.literal("text") }),
  z.object({
    ...importFields,
    kind: z.literal("file"),
    fileType: z.enum(["pdf", "docx", "txt", "md"]),
  }),
  z.object({
    ...importFields,
    kind: z.literal("chat"),
    platform: z.enum(["line", "whatsapp", "paste"]),
  }),
]);
export type ImportRequest = z.infer<typeof ImportRequest>;

// Something the seat's core checklist expects but nothing covers: 「{topic}が書かれていません」.
export const MissingItem = z.object({
  topic: z.string(),
  reason: z.string(),
  prompt: z.string(), // becomes a gap prompt
});
export type MissingItem = z.infer<typeof MissingItem>;

export const ImportedCard = CardDraft.extend({
  source: ImportSource,
  provenance: z.string().optional(),
});
export type ImportedCard = z.infer<typeof ImportedCard>;

// Why the output guard blocked a drafted card: it held a placeholder from the redaction ([電話番号], [人], メンバーA), a
// credential, contact details or a name. A code: the screen words it (messages → import.blocked).
export const BlockReason = z.enum(["placeholder", "secret", "contact", "name"]);
export type BlockReason = z.infer<typeof BlockReason>;

export const ImportResponse = z.object({
  cards: z.array(ImportedCard),
  missing: z.array(MissingItem),
  // title is empty when the title itself held what blocked the card.
  blocked: z.array(z.object({ title: z.string(), reason: BlockReason })),
  // The seat's live note of the same kind that a card would update (bge-m3 similarity ≥ 0.68, the latest term's when
  // several match; lib/engine/similar.ts), at most one per card; card is an index into cards. scope is the old note's:
  // 「更新する」 publishes at that scope or wider, or the database refuses it (0010).
  duplicates: z.array(
    z.object({
      card: Count,
      noteId: NoteId,
      title: z.string(),
      byline: z.string(),
      similarity: z.number().min(0).max(1),
      scope: Scope,
    }),
  ),
});
export type ImportResponse = z.infer<typeof ImportResponse>;

// POST /api/notes/[id]/withdraw (the author only) ----------------------------------------

export const WithdrawResponse = z.object({ withdrawnAt: Timestamp });
export type WithdrawResponse = z.infer<typeof WithdrawResponse>;

// GET /api/me/notes ------------------------------------------------------------------------

// seat: the slug of the seat the note was written at, so 自分のメモ says each note's scope in that seat's words
// (「次の会計だけ」), also for an author who holds more than one seat.
export const MyNote = z.object({
  id: NoteId,
  seat: SeatSlug,
  title: z.string(),
  scope: Scope,
  status: NoteStatus,
  lang: Lang,
});
export type MyNote = z.infer<typeof MyNote>;

export const MyNotesResponse = z.object({ notes: z.array(MyNote) });
export type MyNotesResponse = z.infer<typeof MyNotesResponse>;

// GET /api/notes/[id] -----------------------------------------------------------------------

// One live note the caller may read: the source a citation's stamp opens (docs/DESIGN.md → AnswerEntry). The notes
// policy decides, so a note out of the caller's scope, a withdrawn one and a missing one are all not_found. The seat
// and term speak in the byline; nothing names a person.
export const NoteView = z.object({
  id: NoteId,
  kind: NoteKind,
  title: z.string(),
  body: z.string(),
  deadlineDate: IsoDate.optional(),
  lang: Lang,
  byline: z.string(),
});
export type NoteView = z.infer<typeof NoteView>;

// GET /api/seats/[slug]/guide -------------------------------------------------------------------
// The handover guide (引き継ぎ書): one page with everything the caller may read at the seat, to print or export. Here
// rather than beside SeatView because it uses PromptKind and AnsweredResult, which are declared above.

// A live note of the seat the caller may read, not replaced by a later one (「更新する」) and not past its valid_until.
// The list is newest term first, then by kind; termOrder lets the page group it by term.
export const GuideNote = z.object({
  id: NoteId,
  kind: NoteKind,
  title: z.string(),
  body: z.string(),
  deadlineDate: IsoDate.optional(),
  byline: z.string(),
  termOrder: z.number().int(),
  lang: Lang,
});
export type GuideNote = z.infer<typeof GuideNote>;

// What isn't written yet, for a holder of the seat: a gap, required or core prompt that no note the caller reads answers
// (named by notes.prompt_id) or covers. Never a demand prompt: its text can be a newcomer's question as typed.
export const GuideOpen = z.object({
  id: Uuid,
  text: z.string(),
  reason: PromptKind.exclude(["demand"]),
});
export type GuideOpen = z.infer<typeof GuideOpen>;

// One of the caller's own questions at the seat. answer is the saved answer, checked again against the notes the caller
// reads now; absent while nobody has answered, or once none of its sentences stands. It never carries `live`.
export const GuideAsked = z.object({
  questionId: Uuid,
  text: z.string(),
  lang: Lang,
  askedAt: Timestamp,
  answer: AnsweredResult.optional(),
});
export type GuideAsked = z.infer<typeof GuideAsked>;

// openChecked is false when the prompts couldn't be checked against the notes (Ollama stopped): open is then empty, and
// the page says it couldn't check rather than that everything is written. asked is newest first, at most 20.
export const GuideView = z.object({
  notes: z.array(GuideNote),
  open: z.array(GuideOpen),
  openChecked: z.boolean(),
  asked: z.array(GuideAsked),
});
export type GuideView = z.infer<typeof GuideView>;

// Demo sign-in (docs/SPEC.md → Auth) --------------------------------------------------------
// The demo accounts that sign in, in the order a switcher lists them, each with the email scripts/seed.ts gives it
// (tests/sign-in.test.ts checks that the two agree). lib/api.ts signs a device in with one of them and the demo
// password, which the person types: it goes to Supabase Auth only, never into client code or a NEXT_PUBLIC_* variable.

export const DemoAccount = z.enum(["a26", "a25", "a24", "b", "x"]);
export type DemoAccount = z.infer<typeof DemoAccount>;

export const DEMO_EMAIL: Record<DemoAccount, string> = {
  a26: "smash-kaikei-2026@example.com",
  a25: "smash-kaikei-2025@example.com",
  a24: "smash-kaikei-2024@example.com",
  b: "keion-member@example.com",
  x: "yamate-outsider@example.com",
};

// POST /api/console/session (the console only) --------------------------------------------
// The console's three panes sign in as these demo accounts, one session each (docs/SPEC.md → Console panes).

export const ConsolePersona = DemoAccount.extract(["a26", "a25", "x"]);
export type ConsolePersona = z.infer<typeof ConsolePersona>;

export const ConsoleSessionRequest = z.object({ persona: ConsolePersona });
export type ConsoleSessionRequest = z.infer<typeof ConsoleSessionRequest>;

// The persona's own session, for one pane's Supabase client (persistSession: false). Never stored.
export const ConsoleSession = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
});
export type ConsoleSession = z.infer<typeof ConsoleSession>;

// Errors -------------------------------------------------------------------------------------

// Every route's error body; the HTTP status says the same: 400 invalid_request, 401 unauthorized, 403 forbidden,
// 404 not_found, 422 unredacted (an import still holds a phone number, email or canary), 503 unavailable.
export const ApiErrorCode = z.enum([
  "invalid_request",
  "unauthorized",
  "forbidden",
  "not_found",
  "unredacted",
  "unavailable",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const ApiError = z.object({ error: ApiErrorCode });
export type ApiError = z.infer<typeof ApiError>;

// Realtime rows ------------------------------------------------------------------------------
// As postgres_changes delivers them in payload.new. Timestamps stay plain strings: Supabase picks the format,
// and a parse error here must never stop the live loop.

// The asker's latest answer: the live answer, or a new one after a cited note was withdrawn.
export const AnswersRow = z.object({
  question_id: Uuid,
  payload: AskResult,
  created_at: z.string(),
});
export type AnswersRow = z.infer<typeof AnswersRow>;

// A question routed to this predecessor. The row holds no question text: refetch GET /api/inbox.
export const PromptRoutesRow = z.object({
  prompt_id: Uuid,
  user_id: Uuid,
  created_at: z.string(),
  seen_at: z.string().nullable(),
});
export type PromptRoutesRow = z.infer<typeof PromptRoutesRow>;

// Status changes only; never read note content from a Realtime row.
export const NotesRow = z.object({ id: NoteId, status: NoteStatus });
export type NotesRow = z.infer<typeof NotesRow>;

// Meter, leak test and live-loop timings: numbers only, never text.
export const EventsRow = z.object({
  id: z.number().int(),
  kind: z.string(),
  payload: z.record(z.string(), z.number()),
  created_at: z.string(),
});
export type EventsRow = z.infer<typeof EventsRow>;

export type RealtimeRows = {
  answers: AnswersRow;
  prompt_routes: PromptRoutesRow;
  notes: NotesRow;
  events: EventsRow;
};

// metrics/latest.json (`pnpm metrics`, F4.5) ------------------------------------------------
// The measured numbers, committed: the README's Numbers table (docs/README-SECTIONS.md) and the console's leak counter
// read them, so no screen ever shows a number someone typed. Counts and seconds only, never text. A section is
// missing until its test has run.

export const Metrics = z.object({
  measuredAt: Timestamp,
  // pnpm test:leak: attempts by outsiders (≥50) and by every persona, and how many returned something out of scope.
  leaks: z
    .object({ outsiderAttempts: Count, totalAttempts: Count, found: Count })
    .optional(),
  // Click to absent in every pane, over runs (SPEC F4: median under 1 s over 10).
  withdraw: z
    .object({ runs: Count, medianS: z.number(), maxS: z.number() })
    .optional(),
  // seed/questions.csv: answer sentences, and those citing a retrieved note.
  citations: z.object({ sentences: Count, cited: Count }).optional(),
  // pnpm test:redact: the seed's made-up chats and files added, items the browser hid in them, and canaries seen
  // outside the browser (in a request, the model's payload, a drafted or stored note, or a log).
  redaction: z
    .object({ chats: Count, files: Count, hidden: Count, leftBrowser: Count })
    .optional(),
  // pnpm test:loop: runs, failures and the median from 「誰も知りません」 to the signed answer.
  loop: z
    .object({ runs: Count, failures: Count, medianS: z.number() })
    .optional(),
});
export type Metrics = z.infer<typeof Metrics>;

// LLM outputs (docs/SPEC.md → LLM contracts) ----------------------------------------------
// No transforms (they can't become JSON Schema) and no minimums: the code checks each item, so one bad
// sentence or card is dropped instead of failing the whole call.

// Answer (Sonnet). A sentence stays only if one of its note_ids is in the retrieved set.
export const AnswerOutput = z.object({
  answerable: z.boolean(),
  sentences: z.array(
    z.object({ text: z.string(), note_ids: z.array(z.string()) }),
  ),
  language: Lang,
});
export type AnswerOutput = z.infer<typeof AnswerOutput>;

// A card as the model writes it. The code checks the dates with IsoDate; a bad or missing deadline date becomes a
// missing item (import) or a follow-up (draft), never an invented date.
export const ModelCard = CardDraft.extend({
  deadline_date: z
    .string()
    .optional()
    .describe("YYYY-MM-DD, only when the text gives the date"),
  valid_until: z.string().optional().describe("YYYY-MM-DD"),
});
export type ModelCard = z.infer<typeof ModelCard>;

// Card drafting (Sonnet): prompt + spoken or typed answer + seat type. A live-loop answer usually gives one card.
export const DraftOutput = z.object({ cards: z.array(ModelCard) });
export type DraftOutput = z.infer<typeof DraftOutput>;

// Import (Sonnet): text in <doc> or <chat> tags + the seat's core checklist and demand prompts.
export const ImportOutput = z.object({
  cards: z.array(ModelCard),
  missing: z.array(MissingItem),
});
export type ImportOutput = z.infer<typeof ImportOutput>;

// Follow-up (Haiku): prompt + answer.
export const FollowupOutput = z.object({
  needs_followup: z.boolean(),
  missing: FollowupMissing.optional(),
  question: z.string().optional(),
});
export type FollowupOutput = z.infer<typeof FollowupOutput>;

// Dedupe and classification (Haiku), two calls side by side, so another holder's prompt text can't steer the wording:
// - match: a new question + the seat's open demand prompts in <prompt id=…> tags. duplicate_of is the prompt it joins
//   (checked against the given ids) or null.
// - wording: the new question alone. prompt is the question as a demand prompt about the seat, reframed when it asked
//   about a person.
export const DedupeMatch = z.object({ duplicate_of: z.string().nullable() });
export type DedupeMatch = z.infer<typeof DedupeMatch>;
export const DedupeWording = z.object({ prompt: z.string() });
export type DedupeWording = z.infer<typeof DedupeWording>;
// Both replies together, as the mocks give them.
export const DedupeOutput = DedupeMatch.extend(DedupeWording.shape);
export type DedupeOutput = z.infer<typeof DedupeOutput>;

// The client ---------------------------------------------------------------------------------

// One signed-in session's view of the API. lib/mocks.ts (createMockApi) implements it now and the real client
// later, so a screen switches per endpoint without other changes.
export type Api = {
  seat(slug: string): Promise<SeatView>; // GET /api/seats/[slug]
  ask(request: AskRequest): Promise<AskResult>; // POST /api/ask
  inbox(query: SeatQuery): Promise<InboxResponse>; // GET /api/inbox?seat=
  seen(request: SeenRequest): Promise<SeenResponse>; // POST /api/inbox/seen
  draft(request: DraftRequest): Promise<DraftResponse>; // POST /api/handover/draft
  publish(request: PublishRequest): Promise<PublishResponse>; // POST /api/handover/publish
  prompts(query: SeatQuery): Promise<PromptsResponse>; // GET /api/handover/prompts?seat=
  gap(request: GapRequest): Promise<GapResponse>; // POST /api/handover/prompts
  readers(query: ReadersQuery): Promise<ReadersResponse>; // GET /api/handover/readers?seat=&scope=
  import(request: ImportRequest): Promise<ImportResponse>; // POST /api/import
  withdraw(noteId: string): Promise<WithdrawResponse>; // POST /api/notes/[id]/withdraw
  myNotes(): Promise<MyNotesResponse>; // GET /api/me/notes
  note(noteId: string): Promise<NoteView>; // GET /api/notes/[id]
  guide(slug: string): Promise<GuideView>; // GET /api/seats/[slug]/guide
  // Realtime: calls onRow for each row this session may see; returns the unsubscribe function.
  subscribe<C extends keyof RealtimeRows>(
    channel: C,
    onRow: (row: RealtimeRows[C]) => void,
  ): () => void;
};
