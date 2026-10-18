// F7.5 (issue #87): the pure side of the login screen (components/sign-in.ts). The switcher names the five demo
// accounts the way scripts/seed.ts sets them up, never by name: a holder by the label pack's byline, the other two by
// their group or school. A password Auth turned down reads differently from no answer at all, and the passphrase
// link's strings are gone.
import { readFileSync } from "node:fs";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_LABELS,
  accountLabel,
  signInFailure,
} from "@/components/sign-in";
import { ApiClientError } from "@/lib/api";
import { DEMO_EMAIL, DemoAccount } from "@/lib/contracts";
import en from "@/messages/en.json";
import ja from "@/messages/ja.json";

const inJapanese = createTranslator({ locale: "ja", messages: ja });
const inEnglish = createTranslator({ locale: "en", messages: en });

const labels = (t: typeof inJapanese) =>
  DemoAccount.options.map((account) => {
    const { key, values } = accountLabel(account);
    return t(key, values);
  });

describe("accountLabel", () => {
  it("names holders by the label pack's byline and the others by group or school, in the switcher's order", () => {
    expect(labels(inJapanese)).toEqual([
      "2026年度 会計",
      "2025年度 会計",
      "2024年度 会計",
      "軽音サークルの部員",
      "やまて大学の学生",
    ]);
    expect(labels(inEnglish)).toEqual([
      "2026 会計",
      "2025 会計",
      "2024 会計",
      "軽音サークル member",
      "やまて大学 student",
    ]);
  });

  it("never names anyone: no email, no account key", () => {
    const keys = Object.values(DEMO_EMAIL).map((email) => email.split("@")[0]);
    for (const label of [...labels(inJapanese), ...labels(inEnglish)]) {
      expect(label).not.toContain("@");
      for (const key of keys) expect(label).not.toContain(key);
    }
  });

  it("says what scripts/seed.ts gives each account", () => {
    const seed = readFileSync(
      new URL("../scripts/seed.ts", import.meta.url),
      "utf8",
    );
    const seats = new Map(
      [
        ...seed.matchAll(
          /slug: "([^"]+)",\s*name: "([^"]+)",\s*group: "[^"]+",\s*type: "([^"]+)"/g,
        ),
      ].map(([, slug, name, type]) => [slug, { name, type }]),
    );
    const groups = new Map(
      [
        ...seed.matchAll(
          /\{ key: "([^"]+)", name: "([^"]+)", institution: "([^"]+)" \}/g,
        ),
      ].map(([, key, name, institution]) => [key, { name, institution }]),
    );
    const people = new Map(
      [
        ...seed.matchAll(
          /alias: "([^"]+)",\s*signIn: true,\s*groups: \{ (\w+): "\w+" \},\s*holds: \[([^\]]*)\]/g,
        ),
      ].map(([, alias, group, holds]) => [alias, { group, holds }]),
    );
    // Fails loudly if the seed is ever written another way.
    expect([...people.keys()].sort()).toEqual([...DemoAccount.options].sort());

    for (const account of DemoAccount.options) {
      const person = people.get(account);
      const who = ACCOUNT_LABELS[account];
      const seat = person?.holds.match(/seat: "([^"]+)"/)?.[1];
      const term = person?.holds.match(/term: "([^"]+)"/)?.[1];
      if ("seatType" in who) {
        expect({
          seat: who.seat,
          seatType: who.seatType,
          term: who.term,
        }).toEqual({
          seat: seats.get(seat ?? "")?.name,
          seatType: seats.get(seat ?? "")?.type,
          term,
        });
      } else {
        // Holds no seat: named by the group they're in, or by its school.
        expect(seat).toBeUndefined();
        const group = groups.get(person?.group ?? "");
        if ("group" in who) expect(who.group).toBe(group?.name);
        else expect(who.institution).toBe(group?.institution);
      }
    }
  });
});

describe("signInFailure", () => {
  it("tells a password Auth turned down from no answer at all", () => {
    expect(signInFailure(new ApiClientError("unauthorized"))).toBe(
      "wrongPassword",
    );
    expect(signInFailure(new ApiClientError("unavailable"))).toBe(
      "unavailable",
    );
    expect(signInFailure(new TypeError("fetch failed"))).toBe("unavailable");
  });
});

it("drops the passphrase link's strings from the seat page", () => {
  for (const messages of [ja, en]) {
    expect(
      Object.keys(messages.seat).filter((key) => key.startsWith("sign")),
    ).toEqual([]);
  }
});

// The screens have no DOM test environment here, so these read their source.
describe("the login screen's source", () => {
  const source = (file: string) =>
    readFileSync(new URL(`../components/${file}`, import.meta.url), "utf8");

  it("keeps the password out of the markup: an uncontrolled field with no name", () => {
    // React copies a controlled input's value into its value attribute, and a name would let a native submit send it.
    // The seat pages' switcher and the console's form both.
    for (const file of ["SignIn.tsx", "ConsoleSignIn.tsx"]) {
      const text = source(file);
      const at = text.indexOf('type="password"');
      expect(at).toBeGreaterThan(0);
      expect(text.indexOf('type="password"', at + 1)).toBe(-1);
      const field = text.slice(
        text.lastIndexOf("<input", at),
        text.indexOf("/>", at),
      );
      expect(field).not.toMatch(/\b(value|defaultValue|name)=/);
    }
  });

  it("signs in with the demo password only, never with a link: nothing reads the address bar or keeps a tab's persona", () => {
    for (const file of [
      "SeatSignIn.tsx",
      "SignInGate.tsx",
      "SignIn.tsx",
      "ConsoleSignIn.tsx",
    ]) {
      expect(source(file)).not.toMatch(
        /sessionStorage|\.get\("(key|as)"\)|location\.hash\)\.get/,
      );
    }
  });

  it("wires the console so only its latest step acts, and a pane slot already empty counts as signed out", () => {
    // components/console-sign-in.ts tests the steps; this pins how ConsoleSignIn calls them (no DOM harness here).
    const text = source("ConsoleSignIn.tsx");
    expect(text.match(/const mine = \+\+latest\.current/g)).toHaveLength(3);
    expect(text).toContain("initialSignedOut: true");
  });
});
