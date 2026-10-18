// F4.6 (issue #89): the pure side of the console's sign-in (components/console-sign-in.ts). Three panes, three demo
// accounts, one password, each pane on its own storage key: all three or none, and a failed press says why.
import { describe, expect, it } from "vitest";
import {
  byPane,
  CONSOLE_PANES,
  checkPanes,
  consoleCheck,
  consoleSignIn,
  PANES,
  type PaneAuth,
  paneKey,
  signInPanes,
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

// lib/api.ts's sign-in as a stub: which storage keys hold whom, and every sign-out it was asked for.
function stubAuth(
  held: Record<string, DemoAccount>,
  refuse: Partial<Record<DemoAccount, "unauthorized" | "unavailable">> = {},
) {
  const signedOut: string[] = [];
  const auth: PaneAuth = {
    signIn: async (account, _password, key) => {
      const code = refuse[account];
      if (code) throw new ApiClientError(code);
      held[key] = account;
      return as(account);
    },
    signedIn: async (key) => (held[key] ? as(held[key]) : undefined),
    signOut: async (key) => {
      signedOut.push(key);
      delete held[key];
    },
  };
  return { auth, held, signedOut };
}

describe("signInPanes", () => {
  it("keeps all three when all three sign in, and signs nobody out", async () => {
    const { auth, held, signedOut } = stubAuth({ "daidai-session": "a25" });
    expect((await signInPanes("typed", auth)).kind).toBe("signedIn");
    expect(held).toEqual({
      "daidai-session": "a25",
      "daidai-console-a26": "a26",
      "daidai-console-a25": "a25",
      "daidai-console-x": "x",
    });
    expect(signedOut).toEqual([]);
  });

  it("signs the other two out again when one can't sign in, and never the device's own session", async () => {
    const { auth, held, signedOut } = stubAuth(
      { "daidai-session": "a25" },
      { x: "unavailable" },
    );
    expect(await signInPanes("typed", auth)).toEqual({
      kind: "failed",
      why: "unavailable",
    });
    expect(signedOut.sort()).toEqual(PANES.map(paneKey).sort());
    expect(held).toEqual({ "daidai-session": "a25" });
  });
});

describe("checkPanes", () => {
  it("shows the panes when this device holds all three, and signs nothing out", async () => {
    const { auth, signedOut } = stubAuth({
      "daidai-console-a26": "a26",
      "daidai-console-a25": "a25",
      "daidai-console-x": "x",
    });
    expect((await checkPanes(auth))?.kind).toBe("signedIn");
    expect(signedOut).toEqual([]);
  });

  it("signs out what is there when only part of the three is, and leaves the device's own session", async () => {
    const { auth, held } = stubAuth({
      "daidai-session": "a26",
      "daidai-console-a26": "a26",
    });
    expect(await checkPanes(auth)).toEqual({ kind: "signedOut" });
    expect(held).toEqual({ "daidai-session": "a26" });
  });

  it("touches nothing once a newer check, a sign-in or a sign-out has taken over", async () => {
    const { auth, held, signedOut } = stubAuth({ "daidai-console-a26": "a26" });
    expect(await checkPanes(auth, () => false)).toBeUndefined();
    expect(signedOut).toEqual([]);
    expect(held).toEqual({ "daidai-console-a26": "a26" });
  });
});
