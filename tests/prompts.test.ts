// GET /api/handover/prompts (F6.1), offline: the ranking, the recent-note rule, the lazy coverage checks, and the flow as
// the caller with a scripted Supabase client (the seat, the caller's term, inbox(), the prompts the policy lets through,
// search_notes for each checked prompt), plus the handler's checks before Supabase.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  type HandoverPrompt,
  PromptsResponse,
} from "@/lib/contracts";
import {
  choosePrompts,
  coversPrompt,
  type DemandRow,
  handlePrompts,
  type OpenRow,
  PROMPT_COUNT,
  promptsAsCaller,
  rankPrompts,
} from "@/lib/engine/prompts";
import type { FoundNote } from "@/lib/engine/retrieve";
import { q01Notes, type Result, SMASH_KAIKEI, stubClient } from "./fakes";

afterEach(() => {
  vi.restoreAllMocks();
});

const ok = (data: unknown): Result => ({ data, error: null });
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

// A newcomer's question routed to the caller, as inbox() gives it.
const demand = (
  n: number,
  askCount: number,
  askedAt: string,
  question = `質問${n}`,
): DemandRow => ({
  prompt_id: uuid(n),
  question,
  ask_count: askCount,
  asked_at: askedAt,
});
// A gap, required or core prompt as the prompts table gives it.
const open = (
  n: number,
  kind: OpenRow["kind"],
  seq: number,
  text = `${kind}${n}`,
): OpenRow => ({ id: uuid(n), kind, text, ask_count: 0, seq });

const reasons = (prompts: HandoverPrompt[]) =>
  prompts.map((prompt) => prompt.reason);
const ids = (prompts: HandoverPrompt[]) => prompts.map((prompt) => prompt.id);

describe("rankPrompts", () => {
  it("puts demand prompts first, the most asked first and the longest waiting among equals", () => {
    const ranked = rankPrompts(
      [
        demand(1, 1, "2026-10-18T02:00:00+00:00"),
        demand(2, 3, "2026-10-18T03:00:00+00:00"),
        demand(3, 1, "2026-10-18T01:00:00+00:00"),
      ],
      [],
    );
    expect(ids(ranked)).toEqual([uuid(2), uuid(3), uuid(1)]);
    expect(ranked[0]).toEqual({
      id: uuid(2),
      text: "質問2",
      reason: "demand",
      askCount: 3,
    });
  });

  it("then gap, required and core prompts, each kind in the order it was added", () => {
    const ranked = rankPrompts(
      [demand(1, 1, "2026-10-18T02:00:00+00:00")],
      [
        open(10, "core", 2),
        open(11, "gap", 40),
        open(12, "core", 1),
        open(13, "required", 30),
        open(14, "gap", 35),
      ],
    );
    expect(reasons(ranked)).toEqual([
      "demand",
      "gap",
      "gap",
      "required",
      "core",
      "core",
    ]);
    expect(ids(ranked)).toEqual([
      uuid(1),
      uuid(14),
      uuid(11),
      uuid(13),
      uuid(12),
      uuid(10),
    ]);
    expect(ranked.at(-1)?.askCount).toBe(0);
  });
});

describe("choosePrompts", () => {
  const ranked = rankPrompts(
    [],
    [1, 2, 3, 4, 5, 6].map((n) => open(n, "core", n)),
  );

  it("checks only as many prompts as there are places, and fills a skipped one's place with the next", async () => {
    const checked: string[][] = [];
    const chosen = await choosePrompts(ranked, async (batch) => {
      checked.push(ids(batch));
      return batch.map((prompt) => prompt.id === uuid(2));
    });
    expect(ids(chosen)).toEqual([uuid(1), uuid(3), uuid(4)]);
    expect(checked).toEqual([[uuid(1), uuid(2), uuid(3)], [uuid(4)]]);
  });

  it("never checks or skips a demand prompt: someone waits for its answer", async () => {
    const withDemand = rankPrompts(
      [demand(9, 1, "2026-10-18T02:00:00+00:00")],
      [1, 2, 3].map((n) => open(n, "core", n)),
    );
    const checked: string[][] = [];
    const chosen = await choosePrompts(withDemand, async (batch) => {
      checked.push(ids(batch));
      return batch.map(() => false);
    });
    expect(ids(chosen)).toEqual([uuid(9), uuid(1), uuid(2)]);
    expect(checked).toEqual([[uuid(1), uuid(2)]]);
  });

  it("asks nothing else when demand prompts fill the list", async () => {
    const full = rankPrompts(
      [1, 2, 3, 4].map((n) => demand(n, n, "2026-10-18T02:00:00+00:00")),
      [open(5, "gap", 1)],
    );
    const covered = vi.fn(async (batch: HandoverPrompt[]) =>
      batch.map(() => false),
    );
    const chosen = await choosePrompts(full, covered);
    expect(chosen).toHaveLength(PROMPT_COUNT);
    expect(reasons(chosen)).toEqual(["demand", "demand", "demand"]);
    expect(covered).not.toHaveBeenCalled();
  });

  it("gives fewer than three when the seat has fewer left", async () => {
    const chosen = await choosePrompts(ranked.slice(0, 3), async (batch) =>
      batch.map((prompt) => prompt.id !== uuid(1)),
    );
    expect(ids(chosen)).toEqual([uuid(1)]);
  });

  it("skips nothing after a failed check, and logs only the code", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const covered = vi.fn(
      async (_batch: HandoverPrompt[]): Promise<boolean[]> => {
        throw new Error(`Ollama is down: ${ranked[0].text}`);
      },
    );
    const chosen = await choosePrompts(ranked, covered);
    expect(ids(chosen)).toEqual([uuid(1), uuid(2), uuid(3)]);
    expect(covered).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      "GET /api/handover/prompts: covered topics failed: unavailable (Error)",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(ranked[0].text);
  });

  it("asks each text once: a gap prompt that repeats a checklist prompt or a newcomer's question isn't asked twice", async () => {
    const repeated = rankPrompts(
      [demand(9, 1, "2026-10-18T02:00:00+00:00", "同じ質問")],
      [
        open(1, "gap", 10, "同じ質問"),
        open(2, "gap", 11, "口座の質問"),
        open(3, "core", 1, "口座の質問"),
        open(4, "core", 2),
      ],
    );
    const checked: string[][] = [];
    const chosen = await choosePrompts(repeated, async (batch) => {
      checked.push(ids(batch));
      return batch.map(() => false);
    });
    expect(ids(chosen)).toEqual([uuid(9), uuid(2), uuid(4)]);
    expect(checked).toEqual([[uuid(2), uuid(4)]]);
  });
});

describe("coversPrompt", () => {
  // q01's notes as search_notes ranks them for a prompt about the 保健所 deadline: the 2024 note is the clear match, the
  // institution-wide 学祭実行委員会 note and the 2025 note come along.
  it("is covered by a note of the seat from the caller's term", () => {
    expect(coversPrompt(q01Notes, SMASH_KAIKEI, 2025)).toBe(true); // a25: their own 2025 note
    expect(coversPrompt(q01Notes, SMASH_KAIKEI, 2024)).toBe(true); // a24
  });

  it("is still asked of a later holder, and never covered by an older predecessor's note alone", () => {
    expect(coversPrompt(q01Notes, SMASH_KAIKEI, 2026)).toBe(false); // a26
    const onlyOld = q01Notes.filter((note) => note.term_order === 2024);
    expect(coversPrompt(onlyOld, SMASH_KAIKEI, 2025)).toBe(false);
  });

  it("isn't covered by another seat's note, or by notes that wouldn't answer it", () => {
    const otherSeat = q01Notes.filter((note) => note.seat_id !== SMASH_KAIKEI);
    expect(otherSeat).toHaveLength(1);
    expect(coversPrompt(otherSeat, SMASH_KAIKEI, 2025)).toBe(false);
    // The checklist's deadline prompt against the 2025 note: 0.574, under MATCH.
    const weak: FoundNote[] = [{ ...q01Notes[2], similarity: 0.574 }];
    expect(coversPrompt(weak, SMASH_KAIKEI, 2025)).toBe(false);
    expect(coversPrompt([], SMASH_KAIKEI, 2025)).toBe(false);
  });

  it("needs the clear match among the seat's own notes: an institution-wide note doesn't pull a loose one in", () => {
    // 学祭実行委員会's note clears MATCH, but the seat's only notes are a loosely related 2025 one and the old 2024 one.
    const [old, other, recent] = q01Notes;
    const found: FoundNote[] = [
      { ...other, similarity: 0.723 },
      { ...old, similarity: 0.62 },
      { ...recent, similarity: 0.52 },
    ];
    expect(coversPrompt(found, SMASH_KAIKEI, 2025)).toBe(false);
    expect(
      coversPrompt([...found, { ...old, similarity: 0.7 }], SMASH_KAIKEI, 2025),
    ).toBe(true);
  });
});

describe("promptsAsCaller", () => {
  const Q04 = "決算後に申請された領収書はどうすれば良いですか？";
  const HOKENJO = "模擬店の保健所申請の締切はいつですか？";
  const ACCOUNT =
    "口座の代表者を変えるとき、銀行に何を持っていけばいいですか？";
  const DEADLINES =
    "毎年締切がある申請や提出は何ですか？いつまでに、どこへ出しますか？";
  const MONEY = "団体のお金は、どこで、どうやって管理していますか？";

  // a25 at Smash's 会計 while q04 waits: one demand prompt, two gap prompts (the 保健所 one covered by a25's 2025 note)
  // and the checklist.
  function a25(
    options: {
      seat?: Result;
      terms?: Result;
      inbox?: Result;
      open?: Result;
      answered?: Result;
      search?: Result[];
      embed?: (texts: string[]) => Promise<number[][]>;
    } = {},
  ) {
    const stub = stubClient(
      {
        seats: [options.seat ?? ok({ id: SMASH_KAIKEI })],
        seat_holders: [options.terms ?? ok([{ term_order: 2025 }])],
        prompts: [
          options.open ??
            ok([
              open(20, "core", 1, DEADLINES),
              open(21, "core", 2, MONEY),
              open(22, "gap", 31, HOKENJO),
              open(23, "gap", 32, ACCOUNT),
            ]),
        ],
        // The live notes of the seat that answer one of these prompts: none yet.
        notes: [options.answered ?? ok([])],
      },
      {
        inbox:
          options.inbox ??
          ok([demand(10, 1, "2026-10-18T02:00:00+00:00", Q04)]),
        // The checked batch: the 保健所 gap prompt finds q01's notes, the account one finds nothing close.
        search_notes: options.search ?? [ok(q01Notes), ok([])],
      },
    );
    const embedded: string[][] = [];
    const embed =
      options.embed ??
      (async (texts: string[]) => {
        embedded.push(texts);
        return texts.map((_, i) => [i]);
      });
    return {
      ...stub,
      embedded,
      run: () => promptsAsCaller(stub.client, "smash-kaikei", { embed }),
    };
  }

  it("asks the demand prompt first, then the gap prompt no recent note covers, then the checklist", async () => {
    const { run, rpcCalls, calls, embedded } = a25({
      search: [ok(q01Notes), ok([]), ok([])],
    });
    const response = PromptsResponse.parse(await run());
    expect(response.prompts).toEqual([
      { id: uuid(10), text: Q04, reason: "demand", askCount: 1 },
      { id: uuid(23), text: ACCOUNT, reason: "gap", askCount: 0 },
      { id: uuid(20), text: DEADLINES, reason: "core", askCount: 0 },
    ]);
    // Two places: the two gap prompts first, then one more for the place the covered one left.
    expect(embedded).toEqual([[HOKENJO, ACCOUNT], [DEADLINES]]);
    expect(rpcCalls.map(([name]) => name)).toEqual([
      "inbox",
      "search_notes",
      "search_notes",
      "search_notes",
    ]);
    expect(rpcCalls[0]).toEqual(["inbox", { seat: SMASH_KAIKEI }]);
    expect(rpcCalls[1][1]).toMatchObject({ seat: "smash-kaikei", k: 8 });
    expect(calls.seat_holders?.[0]).toContainEqual([
      "eq",
      "seat_id",
      SMASH_KAIKEI,
    ]);
    expect(calls.prompts?.[0]).toEqual(
      expect.arrayContaining([
        ["eq", "seat_id", SMASH_KAIKEI],
        ["eq", "retired", false],
        ["in", "kind", ["gap", "required", "core"]],
        ["order", "seq"],
      ]),
    );
  });

  it("doesn't ask again what the caller answered through the handover, from their term or later", async () => {
    const { run, calls, embedded } = a25({
      answered: ok([{ prompt_id: uuid(23) }]),
      search: [ok(q01Notes), ok([]), ok([])],
    });
    const { prompts } = await run();
    expect(prompts.map((prompt) => prompt.text)).toEqual([
      Q04,
      DEADLINES,
      MONEY,
    ]);
    expect(embedded.flat()).not.toContain(ACCOUNT);
    expect(calls.notes?.[0]).toEqual(
      expect.arrayContaining([
        ["select", "prompt_id"],
        ["eq", "seat_id", SMASH_KAIKEI],
        ["eq", "status", "live"],
        ["gte", "term_order", 2025],
        ["in", "prompt_id", [uuid(20), uuid(21), uuid(22), uuid(23)]],
      ]),
    );
  });

  it("asks a26 the 保健所 prompt, since a26 holds a later term than the note that covers it for a25", async () => {
    const { run } = a25({
      terms: ok([{ term_order: 2026 }]),
      inbox: ok([]),
      search: [ok(q01Notes), ok([]), ok([])],
    });
    const { prompts } = await run();
    expect(prompts.map((prompt) => prompt.text)).toEqual([
      HOKENJO,
      ACCOUNT,
      DEADLINES,
    ]);
  });

  it("gives someone who never held the seat no prompts, and reads none", async () => {
    const { run, rpcCalls, calls } = a25({ terms: ok([]) });
    expect(await run()).toEqual({ prompts: [] });
    expect(rpcCalls).toEqual([]);
    expect(calls.prompts).toBeUndefined();
  });

  it("refuses an unknown seat", async () => {
    const { run } = a25({ seat: ok(null) });
    await expect(run()).rejects.toMatchObject({
      name: "ApiFailure",
      code: "not_found",
    });
  });

  it("answers by the database's code when a read fails", async () => {
    await expect(
      a25({ inbox: { data: null, error: { code: "42501" } } }).run(),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      a25({ open: { data: null, error: { code: "PGRST000" } } }).run(),
    ).rejects.toMatchObject({ code: "unavailable" });
    await expect(
      a25({
        open: ok([
          { id: uuid(30), kind: "demand", text: "t", ask_count: 1, seq: 1 },
        ]),
      }).run(),
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("still asks three prompts when Ollama is stopped, skipping nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { run, rpcCalls } = a25({
      embed: async () => {
        throw new Error("fetch failed");
      },
    });
    const { prompts } = await run();
    expect(prompts.map((prompt) => prompt.text)).toEqual([
      Q04,
      HOKENJO,
      ACCOUNT,
    ]);
    expect(rpcCalls.map(([name]) => name)).toEqual(["inbox"]);
  });
});

describe("handlePrompts", () => {
  const get = (query: string, token?: string) =>
    new Request(`http://localhost/api/handover/prompts${query}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  it("refuses a request without a token", async () => {
    const response = await handlePrompts(get("?seat=smash-kaikei"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects a query without a seat slug", async () => {
    for (const query of ["", "?seat=", "?seat=Smash%20Kaikei"]) {
      const response = await handlePrompts(get(query, "test-token"));
      expect(response.status).toBe(400);
      expect(ApiError.parse(await response.json()).error).toBe(
        "invalid_request",
      );
    }
  });
});
