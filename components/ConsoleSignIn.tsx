"use client";
// /console's three clients (F4.1, #25; docs/SPEC.md → Console panes): each pane signs in as its own persona with its
// own Supabase client (persistSession: false), so three people run side by side in one browser and none of them is
// the page's signed-in user. On mocks the panes are createMockApi personas and リセット restores the mock seed.
// The real sign-in needs CONSOLE_SIGN_IN=1 on the server (lib/engine/console.ts); without it the console says so.
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { type ConsoleApis, TrustConsole } from "@/components/TrustConsole";
import { signInConsolePane } from "@/lib/api";
import { ApiError, type Metrics } from "@/lib/contracts";
import { createMockApi, resetMocks, USE_MOCKS } from "@/lib/mocks";

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
    let alive = true;
    Promise.all([
      signInConsolePane("a26"),
      signInConsolePane("a25"),
      signInConsolePane("x"),
    ])
      .then(([newcomer, senpai, outsider]) => {
        if (alive) setApis({ newcomer, senpai, outsider });
      })
      .catch((error: unknown) => {
        if (!alive) return;
        // not_found: the route is off on this server.
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
