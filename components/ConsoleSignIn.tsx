"use client";
// /console's three clients (F4.1, #25; docs/SPEC.md → Console panes): each pane signs in as its own persona with its
// own Supabase client (persistSession: false), so three people run side by side in one browser and none of them is
// the page's signed-in user. On mocks the panes are createMockApi personas and リセット restores the mock seed.
// The real sign-in needs the console passphrase: CONSOLE_SIGN_IN on the server, and /console#key=<passphrase> here
// (lib/engine/console.ts). The fragment never reaches a server; it is kept for this tab only and taken out of the
// address bar at once, so the projector doesn't show it. Without a matching key the console says how to open it.
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { type ConsoleApis, TrustConsole } from "@/components/TrustConsole";
import { signInConsolePane } from "@/lib/api";
import { ApiError, type Metrics } from "@/lib/contracts";
import { createMockApi, resetMocks, USE_MOCKS } from "@/lib/mocks";

const KEY_STORE = "daidai-console-key";

// The passphrase from #key=…, moved into this tab's sessionStorage (a reload keeps working) and out of the URL.
export function consoleKey(): string | undefined {
  const fromHash = new URLSearchParams(window.location.hash.slice(1)).get(
    "key",
  );
  if (fromHash) {
    try {
      sessionStorage.setItem(KEY_STORE, fromHash);
    } catch {
      // Storage off (private window): the key still works for this load.
    }
    history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
    return fromHash;
  }
  try {
    return sessionStorage.getItem(KEY_STORE) ?? undefined;
  } catch {
    return undefined;
  }
}

export function ConsoleSignIn({ leaks }: { leaks?: Metrics["leaks"] }) {
  const t = useTranslations("console");
  const [apis, setApis] = useState<ConsoleApis>();
  const [failure, setFailure] = useState<"off" | "failed">();

  useEffect(() => {
    if (USE_MOCKS) {
      setApis({
        newcomer: createMockApi("a26"),
        senpai: createMockApi("a25"),
        outsider: createMockApi("x"),
      });
      return;
    }
    const key = consoleKey();
    if (!key) {
      setFailure("off");
      return;
    }
    let alive = true;
    Promise.all([
      signInConsolePane("a26", key),
      signInConsolePane("a25", key),
      signInConsolePane("x", key),
    ])
      .then(([newcomer, senpai, outsider]) => {
        if (alive) setApis({ newcomer, senpai, outsider });
      })
      .catch((error: unknown) => {
        if (!alive) return;
        // not_found: the route is off on this server, or the key doesn't match.
        const code = ApiError.safeParse(error).data?.error;
        setFailure(code === "not_found" ? "off" : "failed");
      });
    return () => {
      alive = false;
    };
  }, []);

  if (failure) {
    return (
      <p role="alert" className="dd-pad" style={{ margin: 0 }}>
        {t(failure === "off" ? "signInOff" : "signInFailed")}
      </p>
    );
  }
  if (!apis) {
    return (
      <p className="dd-pad dd-cap" style={{ margin: 0 }}>
        {t("signingIn")}
      </p>
    );
  }
  return (
    <TrustConsole
      apis={apis}
      leaks={leaks}
      onReset={USE_MOCKS ? resetMocks : undefined}
    />
  );
}
