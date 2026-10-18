"use client";
// Real data behind a sign-in (F7.5, #87; docs/SPEC.md → Auth): one session per device (lib/api.ts → signedIn, signIn,
// signOut). Signed out, the page shows SignIn in place, so its URL stays what was opened; signed in, it shows its content
// as that account, then SignedInAs with 「切り替える」, which signs out this device only (the demo phone stays signed
// in). Any page can use it: `<SignInGate>{({ account, api }) => …}</SignInGate>`.
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { SignIn } from "@/components/SignIn";
import { accountLabel } from "@/components/sign-in";
import { type SignedIn, signedIn, signOut } from "@/lib/api";
import type { DemoAccount } from "@/lib/contracts";

type Session =
  | { kind: "checking" }
  | { kind: "offline" }
  | { kind: "signedOut" }
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

  switch (session.kind) {
    case "checking":
      return (
        <output className="dd-cap" style={{ display: "block" }}>
          {t("checking")}
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
            onSignedOut={() => setSession({ kind: "signedOut" })}
          />
        </div>
      );
  }
}

// The page's foot: which demo account this device is, and 「切り替える」 (this device only).
export function SignedInAs({
  account,
  onSignedOut,
}: {
  account: DemoAccount;
  onSignedOut: () => void;
}) {
  const t = useTranslations();
  const [busy, setBusy] = useState(false);
  const label = accountLabel(account);

  async function switchAccount() {
    setBusy(true);
    await signOut();
    onSignedOut();
  }

  return (
    <div className="dd-who">
      <p>{t("signIn.signedInAs", { account: t(label.key, label.values) })}</p>
      <button
        type="button"
        className="dd-btn"
        disabled={busy}
        onClick={switchAccount}
      >
        {t("signIn.switch")}
      </button>
    </div>
  );
}
