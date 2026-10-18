// F5.8 (#38): pnpm test:redact. No canary leaves the browser, for chats and for files (docs/SPEC.md → F5: "none of
// seed/chat-canaries.txt appears in the request body, the LLM payload, any note or any log"), and the README's privacy
// numbers (metrics/latest.json → redaction, through pnpm metrics).
//
//   pnpm test:redact        no dev server needed: the route runs in this process (.env.local, the Claude key)
//
// Every made-up file in seed/ (seed/*.sample.*) is added the way 「＋ 追加」 adds it, by a25 at smash-kaikei:
// - read and redacted on this "device" as the browser does it (tests/browser-send.ts: lib/ingest, readSource, the
//   default roles メンバーA/B/C, nothing typed into 「ほかに隠す言葉」). A chat goes twice: as the preview opens it, and
//   with 「全部使う」, which sends every message;
// - sent by the browser's own client (lib/api.ts) with a25's token;
// - answered by the real route handler (app/api/import/route.ts) in this process, so the sign-in, RLS, the safety net,
//   Sonnet and record_import are the real ones, and the check sees what the server sends on.
// scripts/outgoing.ts records every request that leaves this process and everything printed, and counts what reaches
// the network, so nothing goes out unseen. For each request sent:
//   request body    what leaves the browser: no canary in any of its strings
//   model           no canary; and every line of the text, as the server's second pass leaves it, is in the payload,
//                   so a recorder that saw nothing can't pass
//   database        reads, the notes search, and record_import with numbers only: the import stores nothing else
//   elsewhere       nothing: another destination fails, and so does a request the recorder couldn't read
//   drafted notes   every string of the route's answer: no canary
//   log             no canary and no line of the text
// Then once, with the service role and read only: no canary in any note, prompt or import event in the database.
//
// seed/scan.sample.pdf has no text layer: the browser refuses it (the paste hint) and sends nothing (SPEC → F5).
// Printed: counts, and the line numbers of canaries in seed/chat-canaries.txt; never a canary, a sample's text or a
// reply. Each request costs a Sonnet call (a few cents in all) and leaves one counts-only events row (0008), kept like
// the loop and leak records. Nothing else is written: no question, prompt or note, nothing in a25's inbox.
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { untrusted } from "@/lib/ai";
import { ApiClientError, createApi } from "@/lib/api";
import type {
  Api,
  ImportRequest,
  ImportResponse,
  Metrics,
  RedactionCounts,
} from "@/lib/contracts";
import { Uuid } from "@/lib/contracts";
import { screenImport, seedCanaries } from "@/lib/engine/safety-net";
import { reportMetrics } from "@/scripts/metrics-line";
import {
  decoded,
  installTap,
  joined,
  ORIGIN,
  type Outgoing,
  strings,
  type Tap,
  urlStrings,
  type Window,
} from "@/scripts/outgoing";
import { type Added, addFile, SAMPLES, type Send } from "@/tests/browser-send";
import { canaryCount as CANARIES, foundLines } from "@/tests/canaries";
import { viewers } from "@/tests/visibility-table";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SEAT = "smash-kaikei";
const PERSONA = "a25"; // the outgoing treasurer: 残す → 「＋ 追加」 is theirs
// What the device refuses on purpose: a scan has no text to read, so the slip shows the paste hint.
const REFUSED: Record<string, string> = { "scan.sample.pdf": "no_text" };
const SEND_MS = 180_000; // one import, Sonnet included
const CAP = 100_000; // record_import's cap on each count (lib/engine/import.ts)
const LINE_CHARS = 8; // a line of the text this long, found in a log, is the text and not a coincidence
const KINDS = [
  "names",
  "people",
  "phones",
  "emails",
  "urls",
  "ids",
  "addresses",
  "accounts",
  "secrets",
] as const satisfies readonly (keyof RedactionCounts)[];

// What the import may ask of the database: reads, the notes search (F1.3; F5.6 looks for similar notes with it), and
// record_import, whose body may hold the seat and numbers only.
const READ_CALLS = new Set(["/rest/v1/rpc/search_notes"]);
const RECORD_CALL = "/rest/v1/rpc/record_import";
const Recorded = z
  .object({
    seat: Uuid,
    counts: z.record(z.string(), z.number().int().min(0).max(CAP)),
  })
  .strict();

// Ctrl-C (or pnpm metrics stopping) ends the check after the request in flight.
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopping = true;
  });
}

// An error worded by this check, so its message is safe to print (an error from elsewhere could quote a text).
class Stop extends Error {}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Stop(`${name} is not set in .env.local`);
  return value;
}

type Destination = "database" | "model" | "embeddings" | "elsewhere";

// Where a request goes, by origin: the shared project, the model's API, the embeddings server (F5.6), or elsewhere.
function destinations(supabaseUrl: string): (url: string) => Destination {
  const origin = (url: string) => new URL(url).origin;
  const database = origin(supabaseUrl);
  const model = origin(
    process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
  );
  const embeddings = process.env.OLLAMA_BASE_URL
    ? origin(process.env.OLLAMA_BASE_URL)
    : undefined;
  return (url) => {
    const at = origin(url);
    if (at === database) return "database";
    if (at === model) return "model";
    return at === embeddings ? "embeddings" : "elsewhere";
  };
}

async function signIn(
  url: string,
  anonKey: string,
  password: string,
): Promise<SupabaseClient> {
  const email = viewers.find((viewer) => viewer.key === PERSONA)?.email;
  if (!email) throw new Stop(`no demo account for ${PERSONA}`);
  const db = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session) {
    throw new Stop(`sign in as ${PERSONA}: ${error?.code ?? "no session"}`);
  }
  return db;
}

type Answer =
  | { ok: true; response: ImportResponse; seconds: number }
  | { ok: false; code: string };

// One press of 「送る」, through the browser's client. The route's unavailable (a database or model hiccup) is tried
// once more; a request without an answer in SEND_MS is given up on.
async function press(api: Api, request: ImportRequest): Promise<Answer> {
  for (let attempt = 1; ; attempt++) {
    const started = performance.now();
    const answer: Answer = await within(api.import(request), SEND_MS).then(
      (response) => ({
        ok: true as const,
        response,
        seconds: (performance.now() - started) / 1000,
      }),
      (error: unknown) => ({
        ok: false as const,
        code:
          error instanceof ApiClientError
            ? error.error
            : error instanceof Error
              ? error.name
              : "error",
      }),
    );
    if (answer.ok || answer.code !== "unavailable" || attempt === 2) {
      return answer;
    }
  }
}

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`no answer in ${ms / 1000} s`);
      error.name = "TimeoutError";
      reject(error);
    }, ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

const hiddenText = (counts: RedactionCounts) =>
  KINDS.filter((kind) => counts[kind] > 0)
    .map((kind) => `${kind} ${counts[kind]}`)
    .join(", ") || "nothing";

const lines = (found: number[]) =>
  `canary line${found.length === 1 ? "" : "s"} ${found.join(", ")}`;

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

// The run's findings: problems by count, and every canary seen outside the browser by its line in the canary file.
class Findings {
  problems = 0;
  readonly left = new Set<number>();

  constructor(private readonly say: (line: string) => void) {}

  // A check on what went out: ✓ when no canary is in it.
  canaries(place: string, found: number[], detail: string): void {
    for (const line of found) this.left.add(line);
    if (found.length > 0) this.problems += 1;
    this.say(
      `    ${found.length ? "✗" : "✓"} ${place}: ${detail}${found.length ? `; ${lines(found)}` : ", no canary"}`,
    );
  }

  problem(text: string): void {
    this.problems += 1;
    this.say(`    ✗ ${text}`);
  }
}

// A window's output, minus its marker, printed only once it holds no canary and no line of the texts given. A canary
// there is one more that left the browser (a log); the text there breaks "never log the text".
function replay(
  window: Window,
  texts: string[],
  findings: Findings,
  say: (line: string) => void,
): { clean: boolean; printed: number; marked: boolean } {
  const marked = window.output.includes(window.marker);
  const output = window.output.replace(`${window.marker}\n`, "").trimEnd();
  const found = foundLines(output);
  const quoted = texts
    .flatMap((text) => text.split("\n"))
    .map((line) => line.trim())
    .filter((line) => line.length >= LINE_CHARS && output.includes(line));
  for (const line of found) findings.left.add(line);
  if (found.length > 0 || quoted.length > 0) {
    findings.problems += 1;
    say(
      `    ✗ log (${window.label}): ${output.length} characters withheld: ${
        found.length
          ? lines(found)
          : `${plural(quoted.length, "line")} of the text`
      }`,
    );
    return { clean: false, printed: 0, marked };
  }
  const printed = output ? output.split("\n") : [];
  for (const line of printed) say(`    | ${line}`);
  return { clean: true, printed: printed.length, marked };
}

type Measured = { measured: boolean; seconds?: number };

// One request: what left the browser, then everything the server sent on, answered and printed.
async function check(
  sample: Added,
  item: Send,
  context: {
    tap: Tap;
    api: Api;
    canaries: string[];
    where: (url: string) => Destination;
    findings: Findings;
    say: (line: string) => void;
  },
): Promise<Measured> {
  const { tap, api, canaries, where, findings, say } = context;
  const label = item.keepAll
    ? "with 「全部使う」"
    : item.messages
      ? "as the preview opens it"
      : "as sent";
  const messages = item.messages
    ? `${item.messages.kept} of ${item.messages.total} messages, `
    : "";
  say(
    `  ${label}: ${messages}${item.request.text.length} characters; hidden: ${hiddenText(item.counts)}`,
  );

  // What leaves the browser.
  findings.canaries(
    "request body",
    foundLines(joined(decoded(item.body))),
    `${item.body.length} characters`,
  );

  replay(tap.next(`${sample.name} ${label}`), [], findings, say);
  const answer = await press(api, item.request);
  const window = tap.next("between");

  const browser = window.sent.filter((call) => call.from === "browser");
  const server = window.sent.filter((call) => call.from === "server");
  const asSent = browser.every(
    (call) =>
      call.method === "POST" &&
      call.url === `${ORIGIN}/api/import` &&
      call.body === item.body,
  );
  if (browser.length === 0 || !asSent) {
    findings.problem(
      `the browser's client sent ${plural(browser.length, "request")}, not exactly the preview's text to /api/import`,
    );
  }
  if (!answer.ok) {
    findings.problem(`POST /api/import answered ${answer.code}: not measured`);
  }

  // Everything the server sent on, readable and accounted for.
  if (window.network !== server.length) {
    findings.problem(
      `${plural(window.network, "request")} reached the network, ${server.length} went through the recorder`,
    );
  }
  const unread = server.filter((call) => call.unverifiable);
  if (unread.length > 0) {
    findings.problem(
      `${plural(unread.length, "request")} the recorder couldn't read (${[...new Set(unread.map((call) => call.unverifiable))].join(", ")})`,
    );
  }
  const to = (destination: Destination) =>
    server.filter((call) => where(call.url) === destination);
  const elsewhere = to("elsewhere");
  if (elsewhere.length > 0) {
    findings.problem(
      `${plural(elsewhere.length, "request")} to another destination (${[...new Set(elsewhere.map((call) => new URL(call.url).host))].join(", ")})`,
    );
  }
  const texts = (calls: Outgoing[]) =>
    joined(
      calls.flatMap((call) => [...urlStrings(call.url), ...decoded(call.body)]),
    );

  // The model's payload, and the positive control: the text the server's second pass leaves, made inert as the
  // prompt makes it, is in there line by line.
  const model = to("model");
  const screened = screenImport(item.request.text, canaries);
  let control = "";
  if (!screened.ok) {
    findings.problem(
      `the server's safety net would refuse it (phones ${screened.phones}, emails ${screened.emails}, canaries ${screened.canaries})`,
    );
  } else if (model.length > 0) {
    const expected = untrusted("doc", screened.text)
      .split("\n")
      .slice(1, -1)
      .filter((line) => line.trim());
    const payload = model.flatMap((call) => decoded(call.body));
    const missing = expected.filter(
      (line) => !payload.some((text) => text.includes(line)),
    ).length;
    if (missing > 0) {
      findings.problem(
        `${missing} of ${plural(expected.length, "line")} of the text aren't in the model's payload: the recorder may not see what the model gets`,
      );
    }
    control = `; it holds ${missing ? `${expected.length - missing} of` : "all"} ${plural(expected.length, "line")} of the text`;
  } else if (answer.ok) {
    findings.problem("no request to the model was seen: nothing to check");
  }
  findings.canaries(
    "model",
    foundLines(texts(model)),
    `${plural(model.length, "request")}${control}`,
  );

  // The database: reads, the search, and the counts.
  const database = to("database");
  const reads = database.filter(
    (call) => (call.method === "GET" || call.method === "HEAD") && !call.body,
  );
  const searches = database.filter(
    (call) =>
      call.method === "POST" && READ_CALLS.has(new URL(call.url).pathname),
  );
  const records = database.filter(
    (call) =>
      call.method === "POST" && new URL(call.url).pathname === RECORD_CALL,
  );
  const writes = database.filter(
    (call) =>
      !reads.includes(call) &&
      !searches.includes(call) &&
      !records.includes(call),
  );
  for (const call of writes) {
    findings.problem(
      `a ${call.method} to ${new URL(call.url).pathname}: the import stores nothing but counts`,
    );
  }
  const countsOnly = records.every((call) => {
    let body: unknown;
    try {
      body = JSON.parse(call.body);
    } catch {
      return false;
    }
    const parsed = Recorded.safeParse(body);
    return (
      parsed.success &&
      KINDS.every(
        (kind) =>
          parsed.data.counts[kind] ===
          Math.min(item.request.redaction[kind], CAP),
      )
    );
  });
  if (!countsOnly) {
    findings.problem("record_import carried more than the browser's counts");
  }
  if (answer.ok && records.length === 0) {
    findings.problem("no record_import: the import's counts weren't recorded");
  }
  findings.canaries(
    "database",
    foundLines(texts(database)),
    `${plural(reads.length, "read")}, ${plural(searches.length, "search", "searches")}, ${plural(records.length, "record_import")}${countsOnly && records.length ? " with counts only" : ""}`,
  );
  const embeddings = to("embeddings");
  if (embeddings.length > 0) {
    findings.canaries(
      "embeddings",
      foundLines(texts(embeddings)),
      plural(embeddings.length, "request"),
    );
  }

  // The drafted notes: every string of the route's answer, as it left the server (before the client's schema).
  const answers = browser.flatMap((call) =>
    call.answer === undefined ? [] : decoded(call.answer),
  );
  findings.canaries(
    "drafted notes",
    foundLines(joined(answers)),
    answer.ok
      ? `${plural(answer.response.cards.length, "card")}, ${answer.response.missing.length} missing, ${answer.response.blocked.length} blocked`
      : "no answer",
  );

  // The log: everything printed while the request ran (shown above this line when there is any).
  const log = replay(window, [item.request.text], findings, say);
  if (!log.marked) {
    findings.problem(
      "log: the capture missed the marker, so it can't vouch for the log",
    );
  } else if (log.clean) {
    say(
      log.printed
        ? `    ✓ log: ${plural(log.printed, "line")}, no canary and none of the text`
        : "    ✓ log: nothing printed",
    );
  }

  return answer.ok
    ? { measured: true, seconds: answer.seconds }
    : { measured: false };
}

// Read only, with the service role: every note, prompt and import event in the database, whoever added it.
async function sweep(
  service: SupabaseClient,
  findings: Findings,
  say: (line: string) => void,
): Promise<void> {
  const PAGE = 1000;
  const tables = [
    {
      name: "note",
      table: "notes",
      columns: "id, title, body, byline, provenance",
    },
    { name: "prompt", table: "prompts", columns: "id, text" },
    {
      name: "import event",
      table: "events",
      columns: "id, payload",
      kind: "import",
    },
  ];
  const counted: string[] = [];
  const found = new Set<number>();
  let rowsWithCanary = 0;
  for (const { name, table, columns, kind } of tables) {
    let rows = 0;
    for (let from = 0; ; from += PAGE) {
      let query = service.from(table).select(columns);
      if (kind) query = query.eq("kind", kind);
      const { data, error } = await query
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) throw new Stop(`read ${table}: ${error.code}`);
      for (const row of data ?? []) {
        // The id only orders the pages: a growing number or a uuid could hold a canary's digits by chance.
        const fields = Object.entries(row as object).filter(
          ([column]) => column !== "id",
        );
        const inRow = foundLines(joined(strings(Object.fromEntries(fields))));
        for (const line of inRow) found.add(line);
        if (inRow.length > 0) rowsWithCanary += 1;
      }
      rows += data?.length ?? 0;
      if ((data?.length ?? 0) < PAGE) break;
    }
    counted.push(plural(rows, name));
  }
  for (const line of found) findings.left.add(line);
  if (found.size > 0) findings.problems += 1;
  say(
    `${found.size ? "✗" : "✓"} in the database: ${counted.join(", ")}${found.size ? `; ${lines([...found].sort((a, b) => a - b))} in ${plural(rowsWithCanary, "row")}` : ", no canary"}`,
  );
}

type Outcome = {
  redaction?: NonNullable<Metrics["redaction"]>;
  passed: boolean;
};

async function main(tap: Tap, say: (line: string) => void): Promise<Outcome> {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const password = env("DEMO_PASSWORD");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  env("ANTHROPIC_API_KEY");
  env("ANSWER_MODEL");
  // The route's own list, read from this checkout whatever the working directory: the check and the server match
  // the same canaries.
  const canaries = seedCanaries(ROOT);
  const where = destinations(url);
  const findings = new Findings(say);

  // The route is loaded once the tap is in place, so everything it sends goes through it.
  const { POST } = await import("@/app/api/import/route");
  tap.route(POST);
  const api = createApi(await signIn(url, anonKey, password));

  say(
    `pnpm test:redact: ${plural(SAMPLES.length, "made-up file")} from seed/, added by ${PERSONA} at ${SEAT} the way 「＋ 追加」 adds them`,
  );
  const added: Added[] = [];
  for (const name of SAMPLES) added.push(await addFile(name, SEAT));

  // The positive control for the whole run: the samples hold canaries, so there is something to find.
  const planted = new Set(added.flatMap((sample) => foundLines(sample.raw)));
  if (planted.size === 0) findings.problems += 1;
  say(
    `${planted.size ? "✓" : "✗"} ${planted.size} of ${CANARIES} canaries are in the samples as exported${planted.size ? "" : ": nothing to find"}`,
  );

  let chats = 0;
  let files = 0;
  let complete = true;
  const hidden = Object.fromEntries(KINDS.map((kind) => [kind, 0])) as Record<
    (typeof KINDS)[number],
    number
  >;
  const seconds: number[] = [];
  for (const sample of added) {
    if (stopping) {
      complete = false;
      say("✗ stopped before every sample was added");
      break;
    }
    const expected = REFUSED[sample.name];
    if (sample.refused) {
      const asExpected = sample.refused === expected;
      if (!asExpected) {
        findings.problems += 1;
        complete = false;
      }
      say(
        `\n${asExpected ? "✓" : "✗"} ${sample.name}: refused on the device (${sample.refused}), nothing sent${
          asExpected
            ? expected === "no_text"
              ? ": the paste hint"
              : ""
            : "; it should be added"
        }`,
      );
      continue;
    }
    if (expected) {
      findings.problems += 1;
      say(`\n✗ ${sample.name}: the device should refuse it (${expected})`);
    }
    const first = sample.sends[0].request;
    const what =
      first.kind === "chat"
        ? `a chat (${first.platform})`
        : first.kind === "file"
          ? `a file (${first.fileType})`
          : "pasted text";
    say(
      `\n${sample.name}: ${what}, ${plural(foundLines(sample.raw).length, "canary", "canaries")} in it as exported`,
    );
    let measured = true;
    for (const item of sample.sends) {
      if (stopping) {
        measured = false;
        break;
      }
      const result = await check(sample, item, {
        tap,
        api,
        canaries,
        where,
        findings,
        say,
      });
      if (!result.measured) measured = false;
      if (result.seconds !== undefined) seconds.push(result.seconds);
    }
    if (!measured) {
      complete = false;
      continue;
    }
    if (first.kind === "chat") chats += 1;
    else files += 1;
    // What the sample had hidden: its widest send (「全部使う」 for a chat that offers it).
    const widest = sample.sends.at(-1)?.counts;
    for (const kind of KINDS) hidden[kind] += widest?.[kind] ?? 0;
  }

  say("");
  replay(tap.next("database"), [], findings, say);
  if (!stopping) {
    await sweep(
      createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
      findings,
      say,
    );
  } else {
    complete = false;
  }
  replay(tap.next("end"), [], findings, say);

  const total = KINDS.reduce((sum, kind) => sum + hidden[kind], 0);
  const sorted = [...seconds].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  say(
    `\nredaction: ${plural(chats, "chat")} and ${plural(files, "file")} added; the browser hid ${plural(total, "item")} (${hiddenText(hidden as RedactionCounts)}); ${plural(findings.left.size, "canary", "canaries")} left the browser${median === undefined ? "" : ` (${plural(seconds.length, "import")}, median ${median.toFixed(1)} s)`}`,
  );
  const passed =
    complete &&
    findings.problems === 0 &&
    findings.left.size === 0 &&
    chats + files > 0;
  say(
    passed
      ? "✓ every check passed"
      : `✗ ${plural(findings.problems, "check")} failed${complete ? "" : "; not every sample was measured"}`,
  );
  // A complete run's numbers, and any canary seen outside the browser even when the run is cut short: the README
  // never rounds a leak down.
  return complete || findings.left.size > 0
    ? {
        redaction: {
          chats,
          files,
          hidden: total,
          leftBrowser: findings.left.size,
        },
        passed,
      }
    : { passed };
}

const tap = installTap();
let outcome: Outcome = { passed: false };
try {
  outcome = await main(tap, tap.say);
} catch (error) {
  // Only this check's own words: another error's message could quote a sample or a reply.
  tap.say(
    `✗ check-redact stopped: ${error instanceof Stop ? error.message : error instanceof Error ? error.name : typeof error}`,
  );
} finally {
  const last = tap.restore();
  const output = last.output.replace(`${last.marker}\n`, "");
  if (foundLines(output).length > 0) {
    console.log(
      `✗ ${output.length} characters of output withheld: they held a canary`,
    );
    outcome = { ...outcome, passed: false };
  } else if (output.trim()) {
    console.log(output.trimEnd());
  }
}
if (outcome.redaction) reportMetrics({ redaction: outcome.redaction });
else console.log("— redaction: not measured");
process.exitCode = outcome.passed ? 0 : 1;
