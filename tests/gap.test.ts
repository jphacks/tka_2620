// POST /api/handover/prompts (F5.7), offline: 「先輩に聞く」 as the caller with a scripted Supabase client (the seat, the
// guard before add_gap_prompt(), what the database answers), and the handler's checks before Supabase. Nothing here
// prints a canary: the rule cases use made-up names and numbers that aren't canaries, the canary case a made-up one,
// and a check against the seed's canaries compares booleans.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ApiError,
  type BlockReason,
  GapRequest,
  GapResponse,
} from "@/lib/contracts";
import { gapAsCaller, handleGap } from "@/lib/engine/gap";
import { canaryCount, parseCanaries } from "@/lib/engine/safety-net";
import { shownReason } from "@/lib/engine/shown";
import { mockImport } from "@/lib/mocks";
import { type Result, stubClient } from "./fakes";

const SEAT_ID = "33333333-3333-4333-8333-333333333333";
const PROMPT_ID = "44444444-4444-4444-8444-444444444444";
// The old handover's first missing item (docs/SPEC.md → demo): 「保健所申請の締切が書かれていません」.
const ASK = "模擬店の保健所申請の締切はいつですか？";
const CANARY = "テストカナリア"; // made up, not one of seed/chat-canaries.txt
const seedCanaries = parseCanaries(
  readFileSync(new URL("../seed/chat-canaries.txt", import.meta.url), "utf8"),
);

const ok = (data: unknown): Result => ({ data, error: null });

async function run(
  options: {
    text?: string;
    seat?: Result;
    added?: Result;
    canaries?: readonly string[];
  } = {},
) {
  const stub = stubClient(
    { seats: [options.seat ?? ok({ id: SEAT_ID })] },
    { add_gap_prompt: options.added ?? ok(PROMPT_ID) },
  );
  let result: unknown;
  let error: unknown;
  try {
    // Parsed as the handler parses the body, so the text arrives trimmed.
    const request = GapRequest.parse({
      seat: "smash-kaikei",
      text: options.text ?? ASK,
    });
    result = await gapAsCaller(stub.client, request, {
      canaries: options.canaries ?? [CANARY],
    });
  } catch (thrown) {
    error = thrown;
  }
  return { ...stub, result, error };
}

// What the seat's other holders must never read, and what finds it: the import's output guard, or the canaries.
const refused: [string, string, BlockReason | "canary"][] = [
  ["a phone number", "学生課の03-9876-5432に聞けばいいですか？", "contact"],
  ["an email", "書類は kaikei@example.com に送ればいいですか？", "contact"],
  ["a placeholder", "[電話番号]に電話すればいいですか？", "placeholder"],
  [
    "the default role of a speaker",
    "メンバーAに聞けばいいですか？",
    "placeholder",
  ],
  ["a name", "加藤さんに聞けばいいですか？", "name"],
  [
    "a credential with its value",
    "金庫の暗証番号は5813のままですか？",
    "secret",
  ],
  ["a canary", `${CANARY}の件はどうなりましたか？`, "canary"],
];

describe("gapAsCaller", () => {
  it("adds the missing item's prompt as a gap prompt of the seat", async () => {
    const { result, error, calls, rpcCalls } = await run({
      text: `  ${ASK}\n`,
    });
    expect(error).toBeUndefined();
    expect(GapResponse.parse(result)).toEqual({ promptId: PROMPT_ID });
    expect(calls.seats?.[0]).toContainEqual(["eq", "slug", "smash-kaikei"]);
    expect(rpcCalls).toEqual([
      ["add_gap_prompt", { seat: SEAT_ID, prompt_text: ASK }],
    ]);
  });

  it("lets every missing item of the seed import through, with the seed's canaries", async () => {
    expect(mockImport.missing.length).toBeGreaterThan(0);
    for (const [index, { prompt }] of mockImport.missing.entries()) {
      const { error, rpcCalls } = await run({
        text: prompt,
        canaries: seedCanaries,
      });
      expect(error === undefined, `missing item ${index}`).toBe(true);
      expect(rpcCalls.length, `missing item ${index}`).toBe(1);
    }
  });

  it("refuses an unknown seat before anything is sent", async () => {
    const { error, rpcCalls } = await run({ seat: ok(null) });
    expect(error).toMatchObject({ name: "ApiFailure", code: "not_found" });
    expect(rpcCalls).toEqual([]);
  });

  it("answers unavailable when the seat can't be read", async () => {
    const { error, rpcCalls } = await run({
      seat: { data: null, error: { code: "PGRST000" } },
    });
    expect(error).toMatchObject({ name: "ApiFailure", code: "unavailable" });
    expect(rpcCalls).toEqual([]);
  });

  it.each(
    refused,
  )("refuses a text with %s before anything is written", async (_case, text, found) => {
    expect(shownReason(text)).toBe(found === "canary" ? undefined : found);
    const { error, rpcCalls } = await run({ text });
    // The code is the whole message: the text is never in an error.
    expect(error).toMatchObject({
      name: "ApiFailure",
      code: "unredacted",
      message: "unredacted",
    });
    expect(rpcCalls).toEqual([]);
  });

  it("finds a canary by the list it is given", async () => {
    const { error, rpcCalls } = await run({
      text: `${CANARY}の件はどうなりましたか？`,
      canaries: [],
    });
    expect(error).toBeUndefined();
    expect(rpcCalls).toHaveLength(1);
  });

  it("uses made-up names and numbers, none of them the seed's canaries", () => {
    for (const [label, text] of [
      ...refused,
      ["the ask", ASK],
      ["the made-up canary", CANARY],
    ]) {
      expect(canaryCount(text, seedCanaries) === 0, label).toBe(true);
    }
  });

  it("answers forbidden when the caller doesn't hold the seat (42501)", async () => {
    const { error, rpcCalls } = await run({
      added: { data: null, error: { code: "42501" } },
    });
    expect(error).toMatchObject({ name: "ApiFailure", code: "forbidden" });
    expect(rpcCalls).toHaveLength(1);
  });

  it.each<[string, Result]>([
    ["another database error", { data: null, error: { code: "22023" } }],
    ["no id", ok(null)],
    ["an id that isn't a uuid", ok("gap-1")],
    ["a row instead of an id", ok({ id: PROMPT_ID })],
  ])("answers unavailable for %s", async (_case, added) => {
    const { error } = await run({ added });
    expect(error).toMatchObject({ name: "ApiFailure", code: "unavailable" });
  });
});

describe("handleGap", () => {
  const post = (body: BodyInit, token?: string) =>
    new Request("http://localhost/api/handover/prompts", {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body,
    });
  const valid = { seat: "smash-kaikei", text: ASK };

  it("refuses a request without a token", async () => {
    const response = await handleGap(post(JSON.stringify(valid)));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects a body that isn't a gap prompt", async () => {
    for (const body of [
      "not json",
      JSON.stringify({ ...valid, text: "" }),
      JSON.stringify({ ...valid, text: "   " }),
      JSON.stringify({ ...valid, text: "あ".repeat(501) }),
      JSON.stringify({ ...valid, seat: "Smash Kaikei" }),
      JSON.stringify({ text: ASK }),
    ]) {
      const response = await handleGap(post(body, "test-token"));
      expect(response.status).toBe(400);
      expect(ApiError.parse(await response.json()).error).toBe(
        "invalid_request",
      );
    }
  });

  it("holds the text to the limits add_gap_prompt() checks (0009)", () => {
    const sql = readFileSync(
      new URL("../supabase/migrations/0009_gap_prompts.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("length(wording) not between 1 and 500");
    const parse = (text: string) =>
      GapRequest.safeParse({ seat: "smash-kaikei", text }).success;
    expect(parse("あ".repeat(500))).toBe(true);
    expect(parse("あ".repeat(501))).toBe(false);
    expect(parse(" ")).toBe(false);
  });
});
