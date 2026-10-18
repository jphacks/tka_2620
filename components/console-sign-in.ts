// F4.6 (issue #89): the pure side of the console's sign-in (components/ConsoleSignIn.tsx). Three panes, three demo
// accounts, one password. Each pane runs on its own session under its own storage key, apart from the device's (the
// seat pages'), and it is all three or none: the console never shows a proof with a pane missing.
import { signInFailure } from "@/components/sign-in";
import type { SignedIn } from "@/lib/api";
import type { DemoAccount } from "@/lib/contracts";

// lib/api.ts's sign-in, passed in so the console's all-or-none steps can be tested without Supabase.
export type PaneAuth = {
  signIn: (
    account: DemoAccount,
    password: string,
    storageKey: string,
  ) => Promise<SignedIn>;
  signedIn: (storageKey: string) => Promise<SignedIn | undefined>;
  signOut: (storageKey: string) => Promise<void>;
};

// Who each pane runs as (docs/SPEC.md → Console panes): the newcomer, last year's treasurer, the outsider.
export const CONSOLE_PANES = {
  newcomer: "a26",
  senpai: "a25",
  outsider: "x",
} as const satisfies Record<string, DemoAccount>;

export type ConsolePane = keyof typeof CONSOLE_PANES;
export type Panes<T> = Record<ConsolePane, T>;

export const PANES = Object.keys(CONSOLE_PANES) as ConsolePane[];

// Never another key plus -user or -code-verifier (supabase-js keeps those beside a session).
export const paneKey = (pane: ConsolePane) =>
  `daidai-console-${CONSOLE_PANES[pane]}`;

// The results of PANES.map(…), by pane.
export function byPane<T>(values: readonly T[]): Panes<T> {
  return Object.fromEntries(
    PANES.map((pane, index) => [pane, values[index]]),
  ) as Panes<T>;
}

// The three sessions this device already has: all three, each as its own account, or none of them counts.
export function consoleCheck(
  found: Panes<SignedIn | undefined>,
): { kind: "signedIn"; panes: Panes<SignedIn> } | { kind: "signedOut" } {
  const panes: Partial<Panes<SignedIn>> = {};
  for (const pane of PANES) {
    const signed = found[pane];
    if (signed?.account !== CONSOLE_PANES[pane]) return { kind: "signedOut" };
    panes[pane] = signed;
  }
  return { kind: "signedIn", panes: panes as Panes<SignedIn> };
}

// One press of 「3人でログインする」: all three signed in, or nobody, and why. A password Auth turned down for any pane
// is a wrong password; otherwise one of the three didn't get an answer.
export function consoleSignIn(
  results: Panes<PromiseSettledResult<SignedIn>>,
):
  | { kind: "signedIn"; panes: Panes<SignedIn> }
  | { kind: "failed"; why: "wrongPassword" | "unavailable" } {
  const panes: Partial<Panes<SignedIn>> = {};
  const failures: ("wrongPassword" | "unavailable")[] = [];
  for (const pane of PANES) {
    const result = results[pane];
    if (result.status === "fulfilled") panes[pane] = result.value;
    else failures.push(signInFailure(result.reason));
  }
  if (failures.length === 0) {
    return { kind: "signedIn", panes: panes as Panes<SignedIn> };
  }
  return {
    kind: "failed",
    why: failures.includes("wrongPassword") ? "wrongPassword" : "unavailable",
  };
}

// This device's three pane sessions only (scope local), never its own (the seat pages'); a pane that can't reach Auth
// is still cleared on the device.
export async function signOutPanes(auth: PaneAuth): Promise<void> {
  await Promise.all(
    PANES.map((pane) => auth.signOut(paneKey(pane)).catch(() => undefined)),
  );
}

// The three sessions this device already has, checked with Auth (signedIn): all three, or none of them, in which case
// whatever is there is signed out. current: whether this check still counts; once a newer check, a sign-in or a
// sign-out has taken over, it touches nothing and answers undefined.
export async function checkPanes(
  auth: PaneAuth,
  current: () => boolean = () => true,
): Promise<ReturnType<typeof consoleCheck> | undefined> {
  const found = await Promise.all(
    PANES.map((pane) => auth.signedIn(paneKey(pane))),
  );
  if (!current()) return undefined;
  const outcome = consoleCheck(byPane(found));
  if (outcome.kind === "signedOut") await signOutPanes(auth);
  return current() ? outcome : undefined;
}

// One press of 「3人でログインする」: the three sign-ins at once, and when any of them fails, the others are signed out
// again, so the device never keeps part of the three.
export async function signInPanes(
  password: string,
  auth: PaneAuth,
): Promise<ReturnType<typeof consoleSignIn>> {
  const results = await Promise.allSettled(
    PANES.map((pane) =>
      auth.signIn(CONSOLE_PANES[pane], password, paneKey(pane)),
    ),
  );
  const outcome = consoleSignIn(byPane(results));
  if (outcome.kind === "failed") await signOutPanes(auth);
  return outcome;
}
