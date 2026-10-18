"use client";
// /console's three panes (F4.1, #25; F4.6, #89; docs/SPEC.md → Console panes). Each pane runs as its own demo account on
// its own client and session (lib/api.ts → signIn under the pane's storage key; components/console-sign-in.ts), so three
// people run side by side in one browser, apart from this device's own session (the seat pages'). The demo password
// is typed once and signs in all three; a reload keeps them; 「ログアウト」 ends the three on this device only. All
// three or none: when one pane can't sign in, the others are signed out again, so the proof never runs with a pane
// missing. On mocks the panes are createMockApi personas and リセット restores the mock seed.
import { useTranslations } from "next-intl";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  byPane,
  CONSOLE_PANES,
  consoleCheck,
  consoleSignIn,
  PANES,
  type Panes,
  paneKey,
} from "@/components/console-sign-in";
import { type ConsoleApis, TrustConsole } from "@/components/TrustConsole";
import {
  onSessionChange,
  type SignedIn,
  signedIn,
  signIn,
  signOut,
} from "@/lib/api";
import type { Metrics } from "@/lib/contracts";
import { createMockApi, resetMocks, USE_MOCKS } from "@/lib/mocks";

export function ConsoleSignIn({ metrics }: { metrics?: Metrics }) {
  return USE_MOCKS ? (
    <MockConsole metrics={metrics} />
  ) : (
    <RealConsole metrics={metrics} />
  );
}

// On mocks, as before: the three personas at once, and リセット.
function MockConsole({ metrics }: { metrics?: Metrics }) {
  const t = useTranslations("console");
  const [apis, setApis] = useState<ConsoleApis>();
  useEffect(() => {
    setApis({
      newcomer: createMockApi("a26"),
      senpai: createMockApi("a25"),
      outsider: createMockApi("x"),
    });
  }, []);
  if (!apis) {
    return (
      <ConsoleFrame>
        <Caption>{t("signingIn")}</Caption>
      </ConsoleFrame>
    );
  }
  return <TrustConsole apis={apis} metrics={metrics} onReset={resetMocks} />;
}

type Console =
  | { kind: "checking" }
  | { kind: "offline" }
  | {
      kind: "signedOut";
      busy: boolean;
      failure?: "wrongPassword" | "unavailable";
    }
  | { kind: "signedIn"; panes: Panes<SignedIn> }
  | { kind: "signingOut" };

// This device only (scope local), and never throws: a pane that can't reach Auth is still cleared here.
const signOutAll = () =>
  Promise.all(
    PANES.map((pane) => signOut(paneKey(pane)).catch(() => undefined)),
  );

function RealConsole({ metrics }: { metrics?: Metrics }) {
  const t = useTranslations();
  const [state, setState] = useState<Console>({ kind: "checking" });
  const latest = useRef(0);

  // The three sessions this device has, each checked with Auth (lib/api.ts → signedIn): all three, or none of them.
  // Only the latest check may answer.
  const check = useCallback(() => {
    const mine = ++latest.current;
    setState({ kind: "checking" });
    Promise.all(PANES.map((pane) => signedIn(paneKey(pane)))).then(
      async (found) => {
        const outcome = consoleCheck(byPane(found));
        if (outcome.kind === "signedOut") await signOutAll();
        if (latest.current !== mine) return;
        setState(
          outcome.kind === "signedIn"
            ? { kind: "signedIn", panes: outcome.panes }
            : { kind: "signedOut", busy: false },
        );
      },
      () => {
        if (latest.current === mine) setState({ kind: "offline" });
      },
    );
    // Unmounted (or re-run): no check that's still on its way may answer.
    return () => {
      latest.current += 1;
    };
  }, []);
  useEffect(check, [check]);

  // While the panes show their data: a pane signed out or switched anywhere on this device → check all three again.
  const shown = state.kind === "signedIn" ? state.panes : undefined;
  useEffect(() => {
    if (!shown) return;
    const stops = PANES.map((pane) =>
      onSessionChange((userId) => {
        if (userId !== shown[pane].userId) check();
      }, paneKey(pane)),
    );
    return () => {
      for (const stop of stops) stop();
    };
  }, [shown, check]);

  async function submit(password: string) {
    setState({ kind: "signedOut", busy: true });
    const results = await Promise.allSettled(
      PANES.map((pane) => signIn(CONSOLE_PANES[pane], password, paneKey(pane))),
    );
    const outcome = consoleSignIn(byPane(results));
    if (outcome.kind === "signedIn") {
      setState({ kind: "signedIn", panes: outcome.panes });
      return;
    }
    await signOutAll(); // all three or none
    setState({ kind: "signedOut", busy: false, failure: outcome.why });
  }

  async function logOut() {
    setState({ kind: "signingOut" }); // the panes leave the screen now, not when Auth answers
    await signOutAll();
    setState({ kind: "signedOut", busy: false });
  }

  switch (state.kind) {
    case "checking":
    case "signingOut":
      return (
        <ConsoleFrame>
          <Caption>
            {t(
              state.kind === "checking"
                ? "signIn.checking"
                : "signIn.signingOut",
            )}
          </Caption>
        </ConsoleFrame>
      );
    case "offline":
      return (
        <ConsoleFrame>
          <div className="dd-col" style={{ width: "min(390px, 100%)" }}>
            <p role="alert" style={{ margin: 0, color: "var(--ink-2)" }}>
              {t("signIn.offline")}
            </p>
            <div>
              <button type="button" className="dd-btn" onClick={() => check()}>
                {t("signIn.retry")}
              </button>
            </div>
          </div>
        </ConsoleFrame>
      );
    case "signedOut":
      return (
        <ConsoleFrame>
          <PanesSignIn
            busy={state.busy}
            failure={state.failure}
            onSubmit={submit}
          />
        </ConsoleFrame>
      );
    case "signedIn": {
      const { panes } = state;
      return (
        <TrustConsole
          apis={{
            newcomer: panes.newcomer.api,
            senpai: panes.senpai.api,
            outsider: panes.outsider.api,
          }}
          metrics={metrics}
          onSignOut={logOut}
        />
      );
    }
  }
}

// The console's title, centred as the proof is, with what stands in for the panes below it.
function ConsoleFrame({ children }: { children: ReactNode }) {
  const t = useTranslations("console");
  return (
    <div
      className="dd-pad dd-col dd-console"
      style={{ gap: "var(--s-5)", width: "fit-content", marginInline: "auto" }}
    >
      <h1 className="dd-h" style={{ fontSize: "var(--text-xxl)", margin: 0 }}>
        {t("title")}
      </h1>
      {children}
    </div>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return (
    <output className="dd-cap" style={{ display: "block" }}>
      {children}
    </output>
  );
}

// docs/DESIGN.md → PersonaPane (signed out): where the panes will be, one password field and 「3人でログインする」, as
// SignIn on the seat pages. The field is uncontrolled and has no name, so the typed password never enters the page's
// markup (React copies a controlled input's value into its value attribute); it is read when the form is sent, goes to
// Supabase Auth only, and is cleared after a wrong one. The form exists only after the check, never before hydration.
function PanesSignIn({
  busy,
  failure,
  onSubmit,
}: {
  busy: boolean;
  failure?: "wrongPassword" | "unavailable";
  onSubmit: (password: string) => void;
}) {
  const t = useTranslations();
  const lead = useId();
  const field = useRef<HTMLInputElement>(null);
  const message = useRef<HTMLParagraphElement>(null);

  // After a failure the field is ready again (empty after a wrong password), and the line saying what to do is in view.
  useEffect(() => {
    if (!failure) return;
    if (failure === "wrongPassword" && field.current) field.current.value = "";
    field.current?.focus();
    message.current?.scrollIntoView({ block: "nearest" });
  }, [failure]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = field.current?.value ?? "";
    if (busy) return;
    if (!password) {
      field.current?.focus();
      return;
    }
    onSubmit(password);
  }

  return (
    <form
      className="dd-signin"
      onSubmit={submit}
      aria-label={t("console.signIn")}
      aria-describedby={lead}
      style={{ width: "min(390px, 100%)" }}
    >
      <p
        id={lead}
        className="dd-phrase"
        style={{ margin: 0, color: "var(--ink-2)" }}
      >
        {t("console.signInLead")}
      </p>
      <input
        ref={field}
        type="password"
        className="dd-line"
        placeholder={t("signIn.password")}
        aria-label={t("signIn.password")}
        autoComplete="current-password"
        enterKeyHint="go"
      />
      <button
        type="submit"
        className="dd-btn dd-btn-primary dd-btn-wide"
        disabled={busy}
      >
        {t(busy ? "console.signingIn" : "console.signIn")}
      </button>
      {failure && (
        <p
          ref={message}
          role="alert"
          style={{ margin: 0, color: "var(--ink-2)" }}
        >
          {t(
            failure === "wrongPassword"
              ? "signIn.wrongPassword"
              : "console.signInFailed",
          )}
        </p>
      )}
    </form>
  );
}
