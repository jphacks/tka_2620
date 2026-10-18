"use client";
// docs/DESIGN.md → SignIn (F7.5, #87): the demo-account switcher a signed-out page shows in place, so the URL stays the
// seat link and an NFC tap still lands on the seat. The five demo accounts, never by name (components/sign-in.ts), one
// password field and 「ログインする」; nobody signs up. The password goes to Supabase Auth only (lib/api.ts → signIn): it
// lives in this form's state, is never logged, and is cleared after a wrong one. SignInGate renders this only after
// it has checked the device's session, so the form never exists before hydration and can't submit itself as a GET.
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useRef, useState } from "react";
import { accountLabel, signInFailure } from "@/components/sign-in";
import { type SignedIn, signIn } from "@/lib/api";
import { DemoAccount } from "@/lib/contracts";

export function SignIn({
  onSignedIn,
}: {
  onSignedIn: (signed: SignedIn) => void;
}) {
  const t = useTranslations();
  const title = useId();
  const field = useRef<HTMLInputElement>(null);
  const [account, setAccount] = useState<DemoAccount>();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<"wrongPassword" | "unavailable">();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account || !password || busy) return;
    setBusy(true);
    setFailure(undefined);
    try {
      onSignedIn(await signIn(account, password));
    } catch (error) {
      const why = signInFailure(error);
      setFailure(why);
      if (why === "wrongPassword") setPassword("");
      setBusy(false);
      field.current?.focus();
    }
  }

  return (
    <form className="dd-signin" onSubmit={submit} aria-labelledby={title}>
      <div className="dd-col">
        <h1 id={title} className="dd-h">
          {t("signIn.title")}
        </h1>
        <p style={{ margin: 0, color: "var(--ink-2)" }}>{t("signIn.lead")}</p>
      </div>
      <fieldset className="dd-choices">
        <legend className="dd-label">{t("signIn.accounts")}</legend>
        {DemoAccount.options.map((key) => {
          const label = accountLabel(key);
          return (
            <label key={key} className="dd-choice">
              <input
                type="radio"
                name="account"
                value={key}
                checked={account === key}
                onChange={() => setAccount(key)}
              />
              {t(label.key, label.values)}
            </label>
          );
        })}
      </fieldset>
      <input
        ref={field}
        type="password"
        className="dd-line"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder={t("signIn.password")}
        aria-label={t("signIn.password")}
        autoComplete="current-password"
        enterKeyHint="go"
      />
      <button
        type="submit"
        className="dd-btn dd-btn-primary dd-btn-wide"
        disabled={busy || !account || !password}
      >
        {t(busy ? "signIn.submitting" : "signIn.submit")}
      </button>
      {failure && (
        <p role="alert" style={{ margin: 0, color: "var(--ink-2)" }}>
          {t(`signIn.${failure}`)}
        </p>
      )}
    </form>
  );
}
