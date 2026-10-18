// Everything that leaves this process while pnpm test:redact runs (scripts/check-redact.ts, F5.8 #38), so the check
// judges what really went out, not what the code means to send. The check runs the browser half and the route handler
// in one process, and this tap sits between them and the rest of the world:
// - fetch: the browser's calls to an API route (lib/api.ts calls a relative /api/… path) are recorded and handed to
//   the route handler in this process, with the answer it gave; every other request (the model, the database, the
//   embeddings) is recorded with its body before it goes out.
// - the network itself: node:diagnostics_channel counts every request undici (fetch) or the http module makes, so a
//   request that went around the fetch wrapper shows up as one more than was recorded.
// - stdout and stderr: everything written (console.* included) is kept, and the check prints it only after reading
//   it; the check's own lines go through say().
// Windows split the run: next(label) ends the current one and starts the next, so each request the check sends has
// its own requests and output. Nothing here prints what it records.
import diagnostics from "node:diagnostics_channel";

// Where the browser's relative calls resolve. Never reached: they're handed to the route handler in this process.
export const ORIGIN = "http://localhost:3000";

export type Outgoing = {
  from: "browser" | "server";
  method: string;
  url: string;
  body: string; // "" without a body
  unverifiable?: string; // why the body couldn't be read as text: then nothing can be said about it
  answer?: string; // a browser call's answer, as the route gave it (before the client checks it)
};

export type Window = {
  label: string;
  sent: Outgoing[];
  network: number; // requests that reached undici or the http module, recorded or not
  output: string; // everything written to stdout and stderr, the marker included
  marker: string; // the line next() printed through console.log, to prove that console output is caught
};

export type Tap = {
  // The handler the browser's API calls go to (app/api/import/route.ts → POST).
  route(handler: (request: Request) => Promise<Response>): void;
  next(label: string): Window; // ends the current window and starts the next
  say(line: string): void; // the check's own output, past the capture
  restore(): Window; // puts fetch, stdout and stderr back, and ends the last window
};

type Write = typeof process.stdout.write;

export function installTap(): Tap {
  const original = globalThis.fetch;
  const writes = { out: process.stdout.write, err: process.stderr.write };
  let handler: ((request: Request) => Promise<Response>) | undefined;
  let windows = 0;
  let current: Window = {
    label: "",
    sent: [],
    network: 0,
    output: "",
    marker: "",
  };

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const sent = current.sent;
    if (typeof input === "string" && input.startsWith("/")) {
      const request = new Request(new URL(input, ORIGIN), init);
      const call = await describe("browser", request);
      sent.push(call);
      if (!handler) throw new TypeError(`no route handler for ${input}`);
      const response = await handler(request);
      call.answer = await response.clone().text();
      return response;
    }
    const request = new Request(input, init);
    sent.push(await describe("server", request));
    return original(request);
  }) as typeof fetch;

  // Counted in whichever window is open when the request starts.
  const counted = () => {
    current.network += 1;
  };
  diagnostics.subscribe("undici:request:create", counted);
  diagnostics.subscribe("http.client.request.start", counted);

  const capture = ((chunk: unknown, encoding?: unknown, done?: unknown) => {
    current.output +=
      typeof chunk === "string"
        ? chunk
        : Buffer.from(chunk as Uint8Array).toString("utf8");
    const callback = typeof encoding === "function" ? encoding : done;
    if (typeof callback === "function") process.nextTick(callback);
    return true;
  }) as Write;
  process.stdout.write = capture;
  process.stderr.write = capture;

  // A new window, opened with its marker (console.log, as a route logs) now that the capture is in place.
  function window(label: string): Window {
    windows += 1;
    const opened: Window = {
      label,
      sent: [],
      network: 0,
      output: "",
      marker: `[tap ${windows}: ${label}]`,
    };
    current = opened;
    console.log(opened.marker);
    return opened;
  }
  window("setup");

  return {
    route: (given) => {
      handler = given;
    },
    next: (label) => {
      const ended = current;
      window(label);
      return ended;
    },
    say: (line) => {
      writes.out.call(process.stdout, `${line}\n`);
    },
    restore: () => {
      globalThis.fetch = original;
      diagnostics.unsubscribe("undici:request:create", counted);
      diagnostics.unsubscribe("http.client.request.start", counted);
      process.stdout.write = writes.out;
      process.stderr.write = writes.err;
      return current;
    },
  };
}

// A request as it leaves: its body read from a copy, so the request itself still goes out whole. A body that is
// encoded (compressed) or isn't UTF-8 text can't be checked, and says so.
async function describe(
  from: Outgoing["from"],
  request: Request,
): Promise<Outgoing> {
  const call = { from, method: request.method, url: request.url, body: "" };
  if (!request.body) return call;
  if (request.headers.get("content-encoding")) {
    return { ...call, unverifiable: "encoded" };
  }
  try {
    const bytes = await request.clone().arrayBuffer();
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ...call, body };
  } catch {
    return { ...call, unverifiable: "not UTF-8 text" };
  }
}

// Every key, string and number in a JSON body, or the body itself when it isn't JSON. A body is checked as these, not
// as its serialized JSON: there a line break is the two characters \n, and a canary split by one would be missed.
export function decoded(body: string): string[] {
  try {
    return strings(JSON.parse(body));
  } catch {
    return [body];
  }
}

export function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => [
      key,
      ...strings(item),
    ]);
  }
  return [];
}

// A URL and its decoded query, where a filter's value travels percent-encoded.
export function urlStrings(url: string): string[] {
  try {
    const parsed = new URL(url);
    return [
      url,
      decodeURIComponent(parsed.pathname),
      ...[...parsed.searchParams].flat(),
    ];
  } catch {
    return [url];
  }
}

// Strings checked together, with a separator the canary matching keeps (lib/engine/safety-net.ts drops spaces,
// dashes, dots and slashes), so the end of one string and the start of the next never read as one canary.
export function joined(texts: string[]): string {
  return texts.join("\n|\n");
}
