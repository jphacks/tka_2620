"use client";
// docs/DESIGN.md → SignIn (F7.5, #87): the demo-account switcher a signed-out page shows in place, so the URL stays the
// seat link and an NFC tap still lands on the seat. The five demo accounts, never by name (components/sign-in.ts), one
// password field and 「ログインする」; nobody signs up. The password goes to Supabase Auth only (lib/api.ts → signIn):
// it is read from the field when the form is sent, never kept in state, never logged, and cleared after a wrong one.
// The field is uncontrolled on purpose: React copies a controlled input's value into its value attribute, which puts
// the password in the page's markup for any extension or DevTools to read. It has no name, and SignInGate renders the
// form only after it has checked the device's session, so the form never exists before hydration and a native submit
// could never carry the password.
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
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
  const message = useRef<HTMLParagraphElement>(null);
  const failureId = useId(); // the line saying what went wrong, read with the field
  const [account, setAccount] = useState<DemoAccount>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<"wrongPassword" | "unavailable">();

  // The line that says what to do sits under the button: on a short phone it would start under the fixed verb tabs.
  useEffect(() => {
    if (failure) message.current?.scrollIntoView({ block: "nearest" });
  }, [failure]);

  // The button waits for an account only: a password the browser fills in may never tell the page it's there.
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = field.current?.value ?? "";
    if (!account || busy) return;
    if (!password) {
      field.current?.focus();
      return;
    }
    setBusy(true);
    setFailure(undefined);
    try {
      onSignedIn(await signIn(account, password));
    } catch (error) {
      const why = signInFailure(error);
      setFailure(why);
      if (why === "wrongPassword" && field.current) field.current.value = "";
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
        <p className="dd-phrase" style={{ margin: 0, color: "var(--ink-2)" }}>
          {t("signIn.lead")}
        </p>
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
        placeholder={t("signIn.password")}
        aria-label={t("signIn.password")}
        aria-invalid={failure === "wrongPassword" || undefined}
        aria-describedby={failure ? failureId : undefined}
        autoComplete="current-password"
        enterKeyHint="go"
      />
      <button
        type="submit"
        className="dd-btn dd-btn-primary dd-btn-wide"
        disabled={busy || !account}
      >
        {t(busy ? "signIn.submitting" : "signIn.submit")}
      </button>
      {failure && (
        <p
          ref={message}
          id={failureId}
          role="alert"
          className="dd-phrase"
          style={{ margin: 0, color: "var(--ink-2)" }}
        >
          {t(`signIn.${failure}`)}
        </p>
      )}
    </form>
  );
}
