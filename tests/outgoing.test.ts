// scripts/outgoing.ts: the tap pnpm test:redact (scripts/check-redact.ts) reads everything that leaves the process
// through. It must see every request and everything printed, or the check would pass on what it never saw. Made-up
// canaries stand in for the seed's: TEST-4242, 中村健 and 7654321 aren't in seed/chat-canaries.txt.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canaryCount } from "@/lib/engine/safety-net";
import { decoded, installTap, joined, type Tap } from "@/scripts/outgoing";

const CANARIES = ["TEST-4242", "中村健", "7654321"];
const found = (text: string) => canaryCount(text, CANARIES);

describe("decoded: what a body says, not how JSON spells it", () => {
  it("finds a canary split by a line break, which serialized JSON hides", () => {
    const body = JSON.stringify({
      messages: [{ content: [{ text: "金庫の番号は TEST-\n4242 です" }] }],
    });
    expect(found(body)).toBe(0); // there the line break is the two characters \n
    expect(found(joined(decoded(body)))).toBe(1);
  });

  it("reads numbers and keys too, and never joins two strings into one", () => {
    expect(found(joined(decoded(JSON.stringify({ account: 7654321 }))))).toBe(
      1,
    );
    expect(found(joined(decoded(JSON.stringify({ 中村健: true }))))).toBe(1);
    expect(found(joined(decoded(JSON.stringify({ a: "中村", b: "健" }))))).toBe(
      0,
    );
    expect(found(joined(decoded("not JSON: TEST-4242")))).toBe(1);
  });
});

describe("installTap: everything that leaves the process", () => {
  let tap: Tap | undefined;
  let server: http.Server | undefined;

  // The tap opens each window with a marker through console.log; vitest's own console would print it.
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    tap?.restore();
    tap = undefined;
    server?.close();
    server = undefined;
    vi.restoreAllMocks();
  });

  async function listen(): Promise<string> {
    const started = http.createServer((request, response) => {
      request.resume();
      request.on("end", () => response.end("ok"));
    });
    server = started;
    await new Promise<void>((resolve) =>
      started.listen(0, "127.0.0.1", resolve),
    );
    return `http://127.0.0.1:${(started.address() as AddressInfo).port}`;
  }

  it("records what the server sends, as a string or a stream, and counts it on the network", async () => {
    const base = await listen();
    tap = installTap();
    tap.next("send");
    await (
      await fetch(`${base}/model`, {
        method: "POST",
        body: JSON.stringify({ prompt: "TEST-4242" }),
      })
    ).text();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("中村健"));
        controller.close();
      },
    });
    await (
      await fetch(`${base}/stream`, {
        method: "POST",
        body: stream,
        duplex: "half",
      } as RequestInit)
    ).text();
    const window = tap.next("after");
    expect(
      window.sent.map(({ from, method, url }) => [
        from,
        method,
        new URL(url).pathname,
      ]),
    ).toEqual([
      ["server", "POST", "/model"],
      ["server", "POST", "/stream"],
    ]);
    expect(
      found(joined(window.sent.flatMap(({ body }) => decoded(body)))),
    ).toBe(2);
    expect(window.network).toBe(2);
  });

  it("hands the browser's call to the route and keeps the answer it gave", async () => {
    tap = installTap();
    tap.route(async (request) =>
      Response.json({ cards: [{ title: (await request.json()).text }] }),
    );
    tap.next("send");
    const answer = await fetch("/api/import", {
      method: "POST",
      body: JSON.stringify({ text: "TEST-4242" }),
    });
    expect(await answer.json()).toEqual({ cards: [{ title: "TEST-4242" }] });
    const window = tap.next("after");
    expect(window.network).toBe(0); // never on the network
    const [call] = window.sent;
    expect([call.from, call.url]).toEqual([
      "browser",
      "http://localhost:3000/api/import",
    ]);
    expect(found(joined(decoded(call.body)))).toBe(1);
    expect(found(joined(decoded(call.answer ?? "")))).toBe(1);
  });

  it("counts a request that went around fetch", async () => {
    const base = await listen();
    tap = installTap();
    tap.next("send");
    await new Promise<void>((resolve) =>
      http.get(`${base}/around`, (response) => {
        response.resume();
        response.on("end", resolve);
      }),
    );
    const window = tap.next("after");
    expect(window.sent).toEqual([]);
    expect(window.network).toBe(1);
  });

  it("can't read a compressed body, and says so", async () => {
    const base = await listen();
    tap = installTap();
    tap.next("send");
    await (
      await fetch(`${base}/gzip`, {
        method: "POST",
        headers: { "content-encoding": "gzip" },
        body: "TEST-4242",
      })
    ).text();
    expect(
      tap.next("after").sent.map(({ unverifiable }) => unverifiable),
    ).toEqual(["encoded"]);
  });

  it("keeps what is written to stdout and stderr until the check has read it", () => {
    const written: string[] = [];
    const out = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      tap = installTap();
      tap.next("send");
      process.stdout.write("TEST-4242 on stdout\n");
      process.stderr.write("中村健 on stderr\n");
      tap.say("the check's own line");
      expect(found(tap.next("after").output)).toBe(2);
      tap.restore();
      tap = undefined;
      expect(written).toContain("the check's own line\n");
      expect(written.filter((text) => found(text) > 0)).toEqual([]);
    } finally {
      process.stdout.write = out;
    }
  });
});
