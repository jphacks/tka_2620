"use client";
// Real data behind a sign-in (F7.5, #87; docs/SPEC.md → Auth): one session per device (lib/api.ts → signedIn, signIn,
// signOut). Signed out, the page shows SignIn in place, so its URL stays what was opened; signed in, it shows its content
// as that account and hands the account up to 「あなた」 in the bar (components/AccountMenu.tsx), whose
// 「アカウントを切り替える」 runs switchAccount here: this device signs out only (the demo phone stays signed in). Any page
// can use it: `<SignInGate>{({ account, api }) => …}</SignInGate>`.
//
// The content is one account's data (an answer is readable by its asker only), so it never outlives that account on
// screen: 「切り替える」 takes it away before signing out, and a session that changes anywhere on the device (another
// tab switching, a session that ends after `pnpm demo:reset`) brings the switcher, or the new account, at once.
import { useTranslations } from "next-intl";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAccountSlot } from "@/components/AccountMenu";
import { SignIn } from "@/components/SignIn";
import { onSessionChange, type SignedIn, signedIn, signOut } from "@/lib/api";

type Session =
  | { kind: "checking" }
  | { kind: "offline" }
  | { kind: "signedOut" }
  | { kind: "signingOut" }
  | { kind: "signedIn"; signed: SignedIn };

export function SignInGate({
  children,
}: {
  children: (signed: SignedIn) => ReactNode;
}) {
  const t = useTranslations("signIn");
  const [session, setSession] = useState<Session>({ kind: "checking" });
  const latest = useRef(0);

  // The device's session, checked with Auth: a reset or an ended session shows the switcher, no network a calm retry.
  // Only the latest check may answer, so two quick changes in another tab can't leave the older account on screen.
  const check = useCallback(() => {
    const mine = ++latest.current;
    setSession({ kind: "checking" });
    signedIn().then(
      (signed) => {
        if (latest.current !== mine) return;
        setSession(
          signed ? { kind: "signedIn", signed } : { kind: "signedOut" },
        );
      },
      () => {
        if (latest.current === mine) setSession({ kind: "offline" });
      },
    );
    // Unmounted (or re-run): no check that's still on its way may answer.
    return () => {
      latest.current += 1;
    };
  }, []);
  useEffect(check, [check]);

  // While an account's data is on screen: signed out anywhere on the device → the switcher; someone else → check again.
  const shown = session.kind === "signedIn" ? session.signed.userId : undefined;
  useEffect(() => {
    if (!shown) return;
    return onSessionChange((userId) => {
      if (userId === shown) return;
      if (userId) check();
      else setSession({ kind: "signedOut" });
    });
  }, [shown, check]);

  async function switchAccount() {
    setSession({ kind: "signingOut" }); // the data leaves the screen now, not when Auth answers
    await signOut().catch(() => undefined);
    setSession({ kind: "signedOut" });
  }
  // The bar's 「あなた」 names the account only while its data is on screen here, and switches through this gate.
  useAccountSlot(
    session.kind === "signedIn" ? session.signed.account : undefined,
    switchAccount,
  );

  switch (session.kind) {
    case "checking":
    case "signingOut":
      return (
        <output className="dd-cap" style={{ display: "block" }}>
          {t(session.kind === "checking" ? "checking" : "signingOut")}
        </output>
      );
    case "offline":
      return (
        <div className="dd-col">
          <p role="alert" style={{ margin: 0, color: "var(--ink-2)" }}>
            {t("offline")}
          </p>
          <div>
            <button type="button" className="dd-btn" onClick={() => check()}>
              {t("retry")}
            </button>
          </div>
        </div>
      );
    case "signedOut":
      return (
        <SignIn
          onSignedIn={(signed) => setSession({ kind: "signedIn", signed })}
        />
      );
    case "signedIn":
      return (
        // fades in (.dd-fade-in) when the switcher or the check gives way to the account's page
        <div className="dd-fade-in">{children(session.signed)}</div>
      );
  }
}
