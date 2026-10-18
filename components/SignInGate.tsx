"use client";
// Real data behind a sign-in (F7.5, #87; docs/SPEC.md → Auth): one session per device (lib/api.ts → signedIn, signIn,
// signOut). Signed out, the page shows SignIn in place, so its URL stays what was opened; signed in, it shows its content
// as that account, then SignedInAs with 「切り替える」, which signs out this device only (the demo phone stays signed
// in). Any page can use it: `<SignInGate>{({ account, api }) => …}</SignInGate>`.
//
// The content is one account's data (an answer is readable by its asker only), so it never outlives that account on
// screen: 「切り替える」 takes it away before signing out, and a session that changes anywhere on the device (another
// tab switching, a session that ends after `pnpm demo:reset`) brings the switcher, or the new account, at once.
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { SignIn } from "@/components/SignIn";
import { accountLabel } from "@/components/sign-in";
import { onSessionChange, type SignedIn, signedIn, signOut } from "@/lib/api";
import type { DemoAccount } from "@/lib/contracts";

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

  // The device's session, checked with Auth: a reset or an ended session shows the switcher, no network a calm retry.
  const check = useCallback(() => {
    let alive = true;
    setSession({ kind: "checking" });
    signedIn().then(
      (signed) => {
        if (alive) {
          setSession(
            signed ? { kind: "signedIn", signed } : { kind: "signedOut" },
          );
        }
      },
      () => {
        if (alive) setSession({ kind: "offline" });
      },
    );
    return () => {
      alive = false;
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
        <div className="dd-col" style={{ gap: "var(--s-7)" }}>
          {children(session.signed)}
          <SignedInAs
            account={session.signed.account}
            onSwitch={switchAccount}
          />
        </div>
      );
  }
}

// The page's foot: which demo account this device is, and 「切り替える」. SignInGate renders it and does the switching.
export function SignedInAs({
  account,
  onSwitch,
}: {
  account: DemoAccount;
  onSwitch: () => void;
}) {
  const t = useTranslations();
  const label = accountLabel(account);
  return (
    <div className="dd-who">
      <p>{t("signIn.signedInAs", { account: t(label.key, label.values) })}</p>
      <button type="button" className="dd-btn" onClick={onSwitch}>
        {t("signIn.switch")}
      </button>
    </div>
  );
}
