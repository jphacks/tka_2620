// F6.4 (issue #43): the pure side of the handover prompts (components/handover.ts). The list keeps the prompts already
// shown in their places, so three answered read as done and only a newcomer's question joins after the first answer;
// the review publishes every card at the scope picked for it, and a seat setting that is off publishes nothing of it.
import { describe, expect, it } from "vitest";
import { choiceOf, mergePrompts, publishCardsOf } from "@/components/handover";
import type {
  CardDraft,
  HandoverPrompt,
  PromptKind,
  SeatView,
} from "@/lib/contracts";

const prompt = (id: string, reason: PromptKind): HandoverPrompt => ({
  id,
  text: `${id}?`,
  reason,
  askCount: reason === "demand" ? 1 : 0,
});
const ids = (prompts: HandoverPrompt[]) => prompts.map((p) => p.id);

// The server's side, like GET /api/handover/prompts: the three best prompts the caller hasn't answered, demand first.
const core = Array.from({ length: 10 }, (_, i) =>
  prompt(`core${i + 1}`, "core"),
);
function server(answered: Set<string>, demand: HandoverPrompt[] = []) {
  return [...demand, ...core].filter((p) => !answered.has(p.id)).slice(0, 3);
}

describe("mergePrompts", () => {
  it("takes the server's ranking as it is until a prompt is answered or open", () => {
    const shown = [core[0], core[1], core[2]];
    const next = [prompt("new", "demand"), core[0], core[1]];
    expect(mergePrompts(shown, next, new Map(), undefined)).toEqual(next);
  });

  it("keeps three answered prompts as the whole list, though the server lists the next core prompts", () => {
    const answered = new Set<string>();
    let shown = mergePrompts([], server(answered), new Map(), undefined);
    for (const id of ["core1", "core2", "core3"]) {
      answered.add(id);
      const published = new Map([...answered].map((a) => [a, ["successor"]]));
      shown = mergePrompts(shown, server(answered), published, undefined);
    }
    expect(ids(shown)).toEqual(["core1", "core2", "core3"]);
  });

  it("lets a newcomer's question join below after the first answer", () => {
    const shown = [core[0], core[1], core[2]];
    const published = new Map([["core1", ["group"]]]);
    const newcomer = prompt("newcomer", "demand");
    const next = server(new Set(["core1"]), [newcomer]); // newcomer, core2, core3
    expect(ids(mergePrompts(shown, next, published, undefined))).toEqual([
      "core1",
      "core2",
      "core3",
      "newcomer",
    ]);
  });

  it("keeps the prompt being answered when a newcomer's question pushes it out of the server's three", () => {
    const shown = [core[0], core[1], core[2]];
    const next = server(new Set(), [prompt("newcomer", "demand")]); // newcomer, core1, core2
    expect(ids(mergePrompts(shown, next, new Map(), "core3"))).toEqual([
      "core1",
      "core2",
      "core3",
      "newcomer",
    ]);
  });

  it("drops a prompt the server no longer lists when it is neither answered nor open", () => {
    const shown = [prompt("asked", "demand"), core[0], core[1]];
    const next = [core[0], core[1], core[2]]; // the newcomer's question was answered in the inbox
    expect(ids(mergePrompts(shown, next, new Map(), "core1"))).toEqual([
      "core1",
      "core2",
    ]);
  });
});

const settingsOff: SeatView["seat"]["settings"] = {
  noteExpiry: false,
  groupOwnsCriticalNotes: false,
  requiredPrompts: false,
};
const settingsOn = {
  ...settingsOff,
  noteExpiry: true,
  groupOwnsCriticalNotes: true,
};
const card: CardDraft = {
  kind: "deadline",
  title: "保健所申請の締切",
  body: "10月20日までに学生課に出す。",
  deadline_date: "2026-10-20",
  suggested_scope: "group",
  critical: true,
  valid_until: "2026-10-20",
  lang: "ja",
  flags: { person_verdict: false, secret: false },
};

describe("publishCardsOf", () => {
  it("starts every card at successor, whatever the draft suggests", () => {
    expect(choiceOf(card).scope).toBe("successor");
    const [published] = publishCardsOf([card], [], settingsOff);
    expect(published.scope).toBe("successor");
  });

  it("publishes no expiry and never critical when the seat's settings are off, whatever the draft holds", () => {
    const [published] = publishCardsOf(
      [card],
      [{ scope: "institution", validUntil: "2027-03-31", critical: true }],
      settingsOff,
    );
    expect(published.scope).toBe("institution");
    expect(published.valid_until).toBeUndefined();
    expect(published.critical).toBe(false);
    expect(published.deadline_date).toBe("2026-10-20"); // the card itself stays as drafted
  });

  it("publishes the author's expiry and critical choice when the settings are on", () => {
    const [published] = publishCardsOf(
      [card],
      [{ scope: "group", validUntil: "2027-03-31", critical: false }],
      settingsOn,
    );
    expect(published).toMatchObject({
      scope: "group",
      valid_until: "2027-03-31",
      critical: false,
    });
  });
});
