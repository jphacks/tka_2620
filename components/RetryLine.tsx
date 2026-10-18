"use client";
// A load that failed says so calmly and offers the way back at once (SignInGate's 「もう一度ためす」 pattern), instead of
// asking the person to reopen the page: on a phone with a weak signal, a tap is all it should take.
import { useTranslations } from "next-intl";

export function RetryLine({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const t = useTranslations("retry");
  return (
    <div className="dd-col" style={{ gap: "var(--s-2)" }}>
      <p role="alert" style={{ margin: 0, color: "var(--ink-2)" }}>
        {message}
      </p>
      <div>
        <button type="button" className="dd-btn" onClick={onRetry}>
          {t("action")}
        </button>
      </div>
    </div>
  );
}
