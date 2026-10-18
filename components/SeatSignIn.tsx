"use client";
// The seat pages on real data (F7.5, #87): as the demo account signed in on this device (components/SignInGate.tsx),
// with the login screen in place when none is, so an NFC tap on the seat link always lands on the seat. 聞く shows the
// seat page, 残す the inbox, the handover prompts and 「＋ 追加」. The one-device shortcuts play the other person on
// mocks; on real data the other person is real, so they're off.
import { useEffect } from "react";
import { HandoverColumn } from "@/components/HandoverColumn";
import { SeatHome } from "@/components/SeatHome";
import { SignInGate } from "@/components/SignInGate";

export function SeatSignIn({
  slug,
  panel,
}: {
  slug: string;
  /** 聞く on the seat page, or the inbox on /handover. */
  panel: "ask" | "inbox";
}) {
  // An old passphrase link (#key=…&as=…, before #87) still opens the page: take it out of the address bar, unread, so
  // the console's passphrase isn't left on the projector.
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    if (fragment.has("key") || fragment.has("as")) {
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
  }, []);

  return (
    <SignInGate>
      {({ api }) =>
        panel === "ask" ? (
          <SeatHome slug={slug} api={api} mockShortcuts={false} />
        ) : (
          <HandoverColumn slug={slug} api={api} mockShortcuts={false} />
        )
      }
    </SignInGate>
  );
}
