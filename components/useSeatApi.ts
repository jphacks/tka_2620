"use client";
// The signed-in client for the seat pages that SeatSignIn doesn't run (/me, and the handover guide): the mocks' persona
// on mocks; on real data the persona this tab signed in with on a seat page (#key=…&as=…, components/SeatSignIn.tsx),
// else this device's session (lib/api.ts → signedIn(), F7.4). Signed out, the page says so and links back to the seat
// page, where sign-in happens. The login screen (#87, components/SignInGate.tsx) replaces this hook once it is in dev.
import { useEffect, useState } from "react";
import { consoleKey } from "@/components/ConsoleSignIn";
import { signedIn, signInConsolePane } from "@/lib/api";
import { type Api, ConsolePersona } from "@/lib/contracts";
import { createMockApi, type Persona, USE_MOCKS } from "@/lib/mocks";

// Where SeatSignIn keeps this tab's persona, beside the console key.
const SEAT_PERSONA = "daidai-seat-persona";

export type SeatApi =
  | { state: "loading" }
  | { state: "ready"; api: Api }
  | { state: "signedOut" }
  | { state: "failed" };

function tabPersona(): ConsolePersona | undefined {
  try {
    return ConsolePersona.safeParse(sessionStorage.getItem(SEAT_PERSONA)).data;
  } catch {
    return undefined; // storage off (private window)
  }
}

// One client per persona for this tab: each signInConsolePane call is a new session on the server with its own refresh
// timer, so going between the seat page and /me reuses the first one instead of piling them up.
const panes = new Map<ConsolePersona, Promise<Api>>();

async function realApi(): Promise<Api | undefined> {
  // First, so a #key=… fragment always leaves the address bar, whichever way the page signs in.
  const key = consoleKey();
  // The tab's persona before the device's session, as SeatSignIn signs in: /me then describes the same person as the
  // seat page open in this tab.
  const persona = tabPersona();
  if (persona && key) {
    let pane = panes.get(persona);
    if (!pane) {
      pane = signInConsolePane(persona, key);
      panes.set(persona, pane);
      pane.catch(() => panes.delete(persona)); // a failed sign-in can be tried again
    }
    return pane;
  }
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
