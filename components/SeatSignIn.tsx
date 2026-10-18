"use client";
// The seat pages on real data (F7.5, #87): as the demo account signed in on this device (components/SignInGate.tsx),
// with the login screen in place when none is, so an NFC tap on the seat link always lands on the seat. 聞く shows the
// seat page, 残す the inbox and 「＋ 追加」. The one-device shortcuts play the other person on mocks; on real data the
// other person is real, so they're off.
import { AddPanel } from "@/components/AddPanel";
import { InboxPanel } from "@/components/InboxPanel";
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
  return (
    <SignInGate>
      {({ api }) =>
        panel === "ask" ? (
          <SeatHome slug={slug} api={api} mockShortcuts={false} />
        ) : (
          <div className="dd-col" style={{ gap: "var(--s-7)" }}>
            <InboxPanel slug={slug} api={api} mockShortcuts={false} />
            <AddPanel slug={slug} api={api} />
          </div>
        )
      }
    </SignInGate>
  );
}
