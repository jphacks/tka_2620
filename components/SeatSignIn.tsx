"use client";
// The seat pages on real data (F3.10, #12): the page signs in as one demo persona the way a console pane does
// (lib/api.ts → signInConsolePane), so a26 asks on the laptop and a25 answers on a phone. Open the page as
// /s/<seat>#key=<passphrase>&as=a26 (or a25 on /s/<seat>/handover). The fragment never reaches a server; both values
// move into this tab's sessionStorage (a reload keeps working) and out of the address bar. Without a matching key the
// page says sign-in is off. There is no sign-in screen this weekend (docs/SPEC.md → The golden path).
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { AskPanel } from "@/components/AskPanel";
import { consoleKey } from "@/components/ConsoleSignIn";
import { InboxPanel } from "@/components/InboxPanel";
import { signInConsolePane } from "@/lib/api";
import { type Api, ApiError, ConsolePersona } from "@/lib/contracts";

const PERSONA_STORE = "daidai-seat-persona";

// The persona from #as=…, kept for this tab like the key.
function persona(): ConsolePersona | undefined {
  const fromHash = ConsolePersona.safeParse(
    new URLSearchParams(window.location.hash.slice(1)).get("as"),
  );
  if (fromHash.success) {
    try {
      sessionStorage.setItem(PERSONA_STORE, fromHash.data);
    } catch {
      // Storage off (private window): the persona still works for this load.
    }
    return fromHash.data;
  }
  try {
    return ConsolePersona.safeParse(sessionStorage.getItem(PERSONA_STORE)).data;
  } catch {
    return undefined;
  }
}

export function SeatSignIn({
  slug,
  panel,
}: {
  slug: string;
  /** 聞く on the seat page, or the inbox on /handover. */
  panel: "ask" | "inbox";
}) {
  const t = useTranslations("seat");
  const [api, setApi] = useState<Api>();
  const [failure, setFailure] = useState<"off" | "failed">();

  useEffect(() => {
    const as = persona(); // before consoleKey(), which clears the fragment
    const key = consoleKey();
    if (!as || !key) {
      setFailure("off");
      return;
    }
    let alive = true;
    signInConsolePane(as, key).then(
      (signedIn) => {
        if (alive) setApi(signedIn);
      },
      (error: unknown) => {
        if (!alive) return;
        // not_found: the route is off on this server, or the key doesn't match.
        const code = ApiError.safeParse(error).data?.error;
        setFailure(code === "not_found" ? "off" : "failed");
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  if (failure) {
    return (
      <p role="alert" style={{ margin: 0, color: "var(--ink-2)" }}>
        {t(failure === "off" ? "signInOff" : "signInFailed")}
      </p>
    );
  }
  if (!api) {
    return (
      <output className="dd-cap" style={{ display: "block" }}>
        {t("signingIn")}
      </output>
    );
  }
  // The one-device shortcuts play the other person on mocks; on real data the other person is real.
  return panel === "ask" ? (
    <AskPanel slug={slug} api={api} mockShortcuts={false} />
  ) : (
    <InboxPanel slug={slug} api={api} mockShortcuts={false} />
  );
}
