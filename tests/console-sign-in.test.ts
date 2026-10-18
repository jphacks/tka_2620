// F4.6 (issue #89): the pure side of the console's sign-in (components/console-sign-in.ts). Three panes, three demo
// accounts, one password, each pane on its own storage key: all three or none, and a failed press says why.
import { describe, expect, it } from "vitest";
import {
  byPane,
  CONSOLE_PANES,
  consoleCheck,
  consoleSignIn,
  PANES,
  paneKey,
} from "@/components/console-sign-in";
import { ApiClientError, type SignedIn } from "@/lib/api";
import type { Api, DemoAccount } from "@/lib/contracts";

const api = {} as Api;
const as = (account: DemoAccount): SignedIn => ({
  account,
  userId: `user-${account}`,
  api,
});
const fulfilled = (account: DemoAccount): PromiseSettledResult<SignedIn> => ({
  status: "fulfilled",
  value: as(account),
});
const rejected = (code: "unauthorized" | "unavailable") =>
  ({
    status: "rejected",
    reason: new ApiClientError(code),
  }) as PromiseSettledResult<SignedIn>;

describe("the console's panes", () => {
  it("are the newcomer, last year's treasurer and the outsider, each under its own storage key", () => {
    expect(CONSOLE_PANES).toEqual({
      newcomer: "a26",
      senpai: "a25",
      outsider: "x",
    });
    expect(PANES.map(paneKey)).toEqual([
      "daidai-console-a26",
      "daidai-console-a25",
      "daidai-console-x",
    ]);
    // Apart from the device's own session (the seat pages'), and never another key plus -user or -code-verifier.
    const keys = [...PANES.map(paneKey), "daidai-session"];
    for (const key of keys) {
      for (const other of keys) {
        if (key !== other) expect(key.startsWith(`${other}-`)).toBe(false);
      }
    }
  });

  it("collects results by pane, in the panes' order", () => {
    expect(byPane(["first", "second", "third"])).toEqual({
      newcomer: "first",
      senpai: "second",
      outsider: "third",
    });
  });
});

describe("consoleCheck", () => {
  it("shows the panes only when all three are signed in, each as its own account", () => {
    const all = { newcomer: as("a26"), senpai: as("a25"), outsider: as("x") };
    expect(consoleCheck(all)).toEqual({ kind: "signedIn", panes: all });
  });

  it("counts anything less, or a pane under someone else, as signed out", () => {
    const none = {
      newcomer: undefined,
      senpai: undefined,
      outsider: undefined,
    };
    expect(consoleCheck(none)).toEqual({ kind: "signedOut" });
    expect(
      consoleCheck({
        newcomer: as("a26"),
        senpai: as("a25"),
        outsider: undefined,
      }),
    ).toEqual({ kind: "signedOut" });
    expect(
      consoleCheck({
        newcomer: as("a25"),
        senpai: as("a25"),
        outsider: as("x"),
      }),
    ).toEqual({ kind: "signedOut" });
  });
});

describe("consoleSignIn", () => {
  it("signs in all three, or nobody", () => {
    expect(
      consoleSignIn({
        newcomer: fulfilled("a26"),
        senpai: fulfilled("a25"),
        outsider: fulfilled("x"),
      }),
    ).toEqual({
      kind: "signedIn",
      panes: { newcomer: as("a26"), senpai: as("a25"), outsider: as("x") },
    });
    expect(
      consoleSignIn({
        newcomer: fulfilled("a26"),
        senpai: fulfilled("a25"),
        outsider: rejected("unavailable"),
      }),
    ).toEqual({ kind: "failed", why: "unavailable" });
  });

  it("names a wrong password when Auth turned it down for any pane", () => {
    expect(
      consoleSignIn({
        newcomer: rejected("unauthorized"),
        senpai: rejected("unauthorized"),
        outsider: rejected("unauthorized"),
      }),
    ).toEqual({ kind: "failed", why: "wrongPassword" });
    expect(
      consoleSignIn({
        newcomer: rejected("unavailable"),
        senpai: rejected("unauthorized"),
        outsider: fulfilled("x"),
      }),
    ).toEqual({ kind: "failed", why: "wrongPassword" });
  });
});
