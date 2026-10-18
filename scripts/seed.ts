// Seeds the demo world from docs/SPEC.md ("World", "Personas") and seed/*.csv. `pnpm demo:reset` runs the same
// script. Each run removes all demo data first, so it can run any number of times. Uses the service-role key,
// which belongs in scripts/ only. All data is synthetic; nothing here logs note bodies.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";
import { embed, noteText } from "@/lib/embed";

type Status = "current" | "alumni";
type Holding = {
  seat: string;
  term: string;
  order: number;
  status: Status;
  reachable?: boolean;
};
type Person = {
  key: string; // named after the seat they hold; the email is <key>@example.com
  alias: string; // the key seed/*.csv uses
  signIn: boolean; // personas sign in with DEMO_PASSWORD; other note authors get no password
  groups: Record<string, Status>;
  holds: Holding[];
};

const institutions = ["みなと大学", "やまて大学"];

const groups = [
  { key: "smash", name: "テニスサークル Smash", institution: "みなと大学" },
  { key: "gakusai", name: "学祭実行委員会", institution: "みなと大学" },
  { key: "keion", name: "軽音サークル", institution: "みなと大学" },
  { key: "tum", name: "TUM交換留学", institution: "みなと大学" },
  { key: "bioeng", name: "生体工学研", institution: "みなと大学" },
  { key: "photo", name: "写真部", institution: "やまて大学" },
];

const seats = [
  {
    slug: "smash-kaikei",
    name: "会計",
    group: "smash",
    type: "club_role",
    settings: {},
  },
  {
    slug: "gakusai-mogiten",
    name: "模擬店担当",
    group: "gakusai",
    type: "club_role",
    settings: {},
  },
  {
    slug: "tum-ist-autumn",
    name: "TUM → 東大IST / 秋学期",
    group: "tum",
    type: "exchange_route",
    settings: {},
  },
  {
    slug: "lab-bioprinter",
    name: "バイオプリンタ担当",
    group: "bioeng",
    type: "lab_duty",
    settings: { noteExpiry: true, groupOwnsCriticalNotes: true },
  },
];

const people: Person[] = [
  {
    key: "smash-kaikei-2024",
    alias: "a24",
    signIn: true,
    groups: { smash: "alumni" },
    holds: [
      { seat: "smash-kaikei", term: "2024", order: 2024, status: "alumni" },
    ],
  },
  {
    key: "smash-kaikei-2025",
    alias: "a25",
    signIn: true,
    groups: { smash: "current" },
    holds: [
      {
        seat: "smash-kaikei",
        term: "2025",
        order: 2025,
        status: "alumni",
        reachable: true,
      },
    ],
  },
  {
    key: "smash-kaikei-2026",
    alias: "a26",
    signIn: true,
    groups: { smash: "current" },
    holds: [
      { seat: "smash-kaikei", term: "2026", order: 2026, status: "current" },
    ],
  },
  {
    key: "keion-member",
    alias: "b",
    signIn: true,
    groups: { keion: "current" },
    holds: [],
  },
  {
    key: "yamate-outsider",
    alias: "x",
    signIn: true,
    groups: { photo: "current" },
    holds: [],
  },
  {
    key: "gakusai-mogiten-2025",
    alias: "f25",
    signIn: false,
    groups: { gakusai: "alumni" },
    holds: [
      { seat: "gakusai-mogiten", term: "2025", order: 2025, status: "alumni" },
    ],
  },
  {
    key: "tum-ist-autumn-2025",
    alias: "ex25",
    signIn: false,
    groups: { tum: "alumni" },
    holds: [
      { seat: "tum-ist-autumn", term: "2025秋", order: 2025, status: "alumni" },
    ],
  },
  {
    key: "lab-bioprinter-2025",
    alias: "lab25",
    signIn: false,
    groups: { bioeng: "alumni" },
    holds: [
      { seat: "lab-bioprinter", term: "2025", order: 2025, status: "alumni" },
    ],
  },
];

// Children before parents. Every row goes, so a reset also clears live-loop questions, answers and meter events. Only
// the test records in events stay (numbers only, readable by nobody signed in): the live-loop timings (kind "loop",
// `pnpm test:loop` records them and then resets) and the leak test's counts (kind "leak", `pnpm test:leak`). They are
// a record of every run, not demo data.
const tablesInDeleteOrder = [
  ["answers", "question_id"],
  ["prompt_routes", "prompt_id"],
  ["prompts", "id"],
  ["questions", "id"],
  ["notes", "id"],
  ["seat_holders", "seat_id"],
  ["group_members", "group_id"],
  ["seats", "id"],
  ["groups", "id"],
  ["institutions", "id"],
] as const;

const kinds = [
  "deadline",
  "contact",
  "rule_of_thumb",
  "pitfall",
  "unwritten_rule",
];
const scopes = ["successor", "group", "institution", "public"];

type NoteRow = Record<
  | "id"
  | "seat_slug"
  | "term_label"
  | "term_order"
  | "author"
  | "kind"
  | "title"
  | "body"
  | "deadline_date"
  | "scope"
  | "critical"
  | "valid_until",
  string
>;
type QuestionRow = Record<
  "id" | "persona" | "seat_slug" | "expected_notes",
  string
>;
// What every leaver should hand over, per seat type: F6's core prompts and F5's checklist (seed/README.md).
type CorePromptRow = Record<
  "seat_type" | "topic" | "text_ja" | "text_en",
  string
>;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set in .env.local`);
  return value;
}

function personFor(key: string): Person | undefined {
  return people.find((person) => person.key === key || person.alias === key);
}

async function readCsv<Row>(path: string): Promise<Row[]> {
  const text = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  }) as Row[];
}

function validate(
  notes: NoteRow[],
  questions: QuestionRow[],
  corePrompts: CorePromptRow[],
): string[] {
  const problems: string[] = [];
  const noteIds = new Set<string>();
  for (const note of notes) {
    const where = `notes.csv ${note.id || "(row without id)"}`;
    if (noteIds.has(note.id)) problems.push(`${where}: duplicate id`);
    noteIds.add(note.id);
    if (!seats.some((seat) => seat.slug === note.seat_slug)) {
      problems.push(`${where}: unknown seat ${note.seat_slug}`);
    }
    const author = personFor(note.author);
    const term = Number(note.term_order);
    if (!author) problems.push(`${where}: unknown author ${note.author}`);
    else if (
      !author.holds.some(
        (hold) =>
          hold.seat === note.seat_slug &&
          hold.term === note.term_label &&
          hold.order === term,
      )
    ) {
      problems.push(
        `${where}: ${author.key} doesn't hold ${note.seat_slug} in ${note.term_label}`,
      );
    }
    if (!kinds.includes(note.kind))
      problems.push(`${where}: unknown kind ${note.kind}`);
    if (!scopes.includes(note.scope))
      problems.push(`${where}: unknown scope ${note.scope}`);
    if (note.kind === "deadline" && !note.deadline_date) {
      problems.push(`${where}: a deadline needs a deadline_date`);
    }
    if (!["true", "false", ""].includes(note.critical)) {
      problems.push(`${where}: critical must be true or false`);
    }
    if (!note.title || !note.body)
      problems.push(`${where}: missing title or body`);
  }
  for (const question of questions) {
    const where = `questions.csv ${question.id}`;
    if (!personFor(question.persona)?.signIn) {
      problems.push(`${where}: unknown persona ${question.persona}`);
    }
    if (!seats.some((seat) => seat.slug === question.seat_slug)) {
      problems.push(`${where}: unknown seat ${question.seat_slug}`);
    }
    for (const id of question.expected_notes
      .split(";")
      .map((part) => part.trim())) {
      if (id && !noteIds.has(id))
        problems.push(`${where}: expected note ${id} isn't in notes.csv`);
    }
  }
  const topics = new Set<string>();
  for (const prompt of corePrompts) {
    const where = `core-prompts.csv ${prompt.seat_type}/${prompt.topic}`;
    if (!seats.some((seat) => seat.type === prompt.seat_type)) {
      problems.push(`${where}: no seat of type ${prompt.seat_type}`);
    }
    if (topics.has(where)) problems.push(`${where}: duplicate topic`);
    topics.add(where);
    if (!prompt.topic || !prompt.text_ja || !prompt.text_en) {
      problems.push(`${where}: missing topic, text_ja or text_en`);
    }
  }
  return problems;
}

async function insert(db: SupabaseClient, table: string, rows: object[]) {
  const { error } = await db.from(table).insert(rows);
  if (error) throw new Error(`insert into ${table}: ${error.message}`);
}

async function count(
  db: SupabaseClient,
  table: string,
  notNull?: string,
): Promise<number> {
  let query = db.from(table).select("*", { count: "exact", head: true });
  if (notNull) query = query.not(notNull, "is", null);
  const { count: rows, error } = await query;
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return rows ?? 0;
}

async function demoUsers(db: SupabaseClient) {
  const found = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw new Error(`list users: ${error.message}`);
    found.push(
      ...data.users.filter((user) => user.email?.endsWith("@example.com")),
    );
    if (data.users.length < 1000) return found;
  }
}

async function seed() {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const db = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const password = env("DEMO_PASSWORD");
  console.log(`Seeding ${new URL(url).host}`);

  // Check and embed everything before touching the database, so a bad CSV or a stopped Ollama changes nothing.
  const notes = await readCsv<NoteRow>("seed/notes.csv");
  const questions = await readCsv<QuestionRow>("seed/questions.csv");
  const corePrompts = await readCsv<CorePromptRow>("seed/core-prompts.csv");
  const problems = validate(notes, questions, corePrompts);
  if (problems.length > 0) {
    throw new Error(
      `seed data has ${problems.length} problem(s):\n  ${problems.join("\n  ")}`,
    );
  }
  console.log(
    `✓ ${notes.length} notes, ${questions.length} questions and ${corePrompts.length} core prompts are consistent`,
  );
  const vectors = await embed(notes.map(noteText));
  console.log(
    `✓ embedded ${vectors.length} notes (title and body) with ${env("EMBED_MODEL")}`,
  );
  const labelPacks = JSON.parse(
    await readFile(new URL("../messages/ja.json", import.meta.url), "utf8"),
  ).seatTypes as Record<string, { byline: string }>;

  for (const [table, column] of tablesInDeleteOrder) {
    const { error } = await db.from(table).delete().not(column, "is", null);
    if (error) throw new Error(`delete from ${table}: ${error.message}`);
  }
  const { error: eventsError } = await db
    .from("events")
    .delete()
    .not("kind", "in", "(loop,leak)");
  if (eventsError)
    throw new Error(`delete from events: ${eventsError.message}`);
  const previous = await demoUsers(db);
  for (const user of previous) {
    const { error } = await db.auth.admin.deleteUser(user.id);
    // The id, not the email: pnpm metrics shows this output too.
    if (error) throw new Error(`delete user ${user.id}: ${error.message}`);
  }
  console.log(
    `✓ removed the previous demo data and ${previous.length} demo users`,
  );

  const institutionIds = new Map(
    institutions.map((name) => [name, randomUUID()]),
  );
  const groupIds = new Map(groups.map((group) => [group.key, randomUUID()]));
  const seatIds = new Map(seats.map((seat) => [seat.slug, randomUUID()]));
  await insert(
    db,
    "institutions",
    institutions.map((name) => ({ id: institutionIds.get(name), name })),
  );
  await insert(
    db,
    "groups",
    groups.map((group) => ({
      id: groupIds.get(group.key),
      institution_id: institutionIds.get(group.institution),
      name: group.name,
    })),
  );
  await insert(
    db,
    "seats",
    seats.map((seat) => ({
      id: seatIds.get(seat.slug),
      group_id: groupIds.get(seat.group),
      slug: seat.slug,
      name: seat.name,
      seat_type: seat.type,
      settings: seat.settings,
    })),
  );

  const userIds = new Map<string, string>();
  for (const person of people) {
    const { data, error } = await db.auth.admin.createUser({
      email: `${person.key}@example.com`,
      password: person.signIn ? password : undefined,
      email_confirm: true,
      user_metadata: { persona: person.key },
    });
    if (error) throw new Error(`create user ${person.key}: ${error.message}`);
    userIds.set(person.key, data.user.id);
  }
  await insert(
    db,
    "group_members",
    people.flatMap((person) =>
      Object.entries(person.groups).map(([group, status]) => ({
        user_id: userIds.get(person.key),
        group_id: groupIds.get(group),
        status,
      })),
    ),
  );
  await insert(
    db,
    "seat_holders",
    people.flatMap((person) =>
      person.holds.map((hold) => ({
        user_id: userIds.get(person.key),
        seat_id: seatIds.get(hold.seat),
        term_label: hold.term,
        term_order: hold.order,
        status: hold.status,
        reachable: hold.reachable ?? false,
      })),
    ),
  );

  await insert(
    db,
    "notes",
    notes.map((note, i) => {
      const seat = seats.find((candidate) => candidate.slug === note.seat_slug);
      const author = personFor(note.author);
      return {
        id: note.id,
        seat_id: seatIds.get(note.seat_slug),
        term_order: Number(note.term_order),
        author_user_id: author && userIds.get(author.key),
        byline:
          seat &&
          labelPacks[seat.type].byline
            .replace("{term}", note.term_label)
            .replace("{seat}", seat.name),
        kind: note.kind,
        title: note.title,
        body: note.body,
        deadline_date: note.deadline_date || null,
        lang: "ja",
        scope: note.scope,
        critical: note.critical === "true",
        valid_until: note.valid_until || null,
        source: "handover",
        embedding: JSON.stringify(vectors[i]),
      };
    }),
  );

  // Every seat gets its type's core prompts, in Japanese like the seed notes (text_en is for readers of the CSV).
  await insert(
    db,
    "prompts",
    seats.flatMap((seat) =>
      corePrompts
        .filter((prompt) => prompt.seat_type === seat.type)
        .map((prompt) => ({
          seat_id: seatIds.get(seat.slug),
          kind: "core",
          text: prompt.text_ja,
        })),
    ),
  );

  const users = await demoUsers(db);
  const signIns = people.filter((person) => person.signIn).length;
  const rows: [string, number, string?][] = [
    ["institutions", await count(db, "institutions")],
    ["groups", await count(db, "groups")],
    ["seats", await count(db, "seats")],
    [
      "demo users",
      users.length,
      `${signIns} personas sign in with DEMO_PASSWORD`,
    ],
    ["group_members", await count(db, "group_members")],
    ["seat_holders", await count(db, "seat_holders")],
    [
      "notes",
      await count(db, "notes"),
      `${await count(db, "notes", "embedding")} with embeddings`,
    ],
    ["questions", await count(db, "questions")],
    ["answers", await count(db, "answers")],
    ["prompts", await count(db, "prompts")],
    ["prompt_routes", await count(db, "prompt_routes")],
    ["events", await count(db, "events"), "loop and leak test records, kept"],
  ];
  console.log("\nDatabase now:");
  for (const [name, rowCount, detail] of rows) {
    console.log(
      `  ${name.padEnd(14)} ${String(rowCount).padStart(3)}${detail ? `  (${detail})` : ""}`,
    );
  }
}

try {
  await seed();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
