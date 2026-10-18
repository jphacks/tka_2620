"use client";
// The signed-in client for the seat pages that SeatSignIn doesn't run (/me, and the handover guide): the mocks' persona
// on mocks; on real data this device's session (lib/api.ts → signedIn(), F7.4). Signed out, the page says so and links
// back to the seat page, where sign-in happens. #121 replaces this hook with components/SignInGate.tsx; until then the
// console's passphrase path is gone from it (#89).
import { useEffect, useState } from "react";
import { signedIn } from "@/lib/api";
import type { Api } from "@/lib/contracts";
import { createMockApi, type Persona, USE_MOCKS } from "@/lib/mocks";

export type SeatApi =
  | { state: "loading" }
  | { state: "ready"; api: Api }
  | { state: "signedOut" }
  | { state: "failed" };

async function realApi(): Promise<Api | undefined> {
  return (await signedIn())?.api;
}

/** mockPersona: who the page plays on mocks (NEXT_PUBLIC_USE_MOCKS=1). */
export function useSeatApi(mockPersona: Persona): SeatApi {
  const [state, setState] = useState<SeatApi>(() =>
    USE_MOCKS
      ? { state: "ready", api: createMockApi(mockPersona) }
      : { state: "loading" },
  );
  useEffect(() => {
    if (USE_MOCKS) return;
    let alive = true;
    realApi().then(
      (api) => {
        if (alive)
          setState(api ? { state: "ready", api } : { state: "signedOut" });
      },
      () => {
        if (alive) setState({ state: "failed" });
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
