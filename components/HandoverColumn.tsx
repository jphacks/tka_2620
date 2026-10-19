"use client";
// 残す on /s/<seat>/handover: newcomers' questions, the handover prompts, then 「＋ 追加」. No title on screen (Nico's call):
// the verb tab says where you are; the h1 is there for a screen reader. A newcomer's question shows once, on its inbox
// slip: the prompts below leave out what the inbox holds, and publishing in one has the other read its list again. Only
// the seat's holders get 「＋ 追加」. The sections appear together, in place, once the seat, the inbox and the prompts
// have been read: until then they are there but unseen, so 「＋ 追加」 doesn't slide down under a finger as the slips and
// prompts above it arrive. The seat is read here once, for the prompts and 「＋ 追加」 alike, with one retry.
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AddPanel } from "@/components/AddPanel";
import { HandoverPrompts } from "@/components/HandoverPrompts";
import { InboxPanel } from "@/components/InboxPanel";
import type { Api, SeatView } from "@/lib/contracts";
import { createMockApi } from "@/lib/mocks";

export function HandoverColumn({
  slug,
  api,
  mockShortcuts = true,
}: {
  slug: string;
  /** The signed-in predecessor's client; mocks as a25 when left out. */
  api?: Api;
  mockShortcuts?: boolean;
}) {
  const t = useTranslations();
  const [inboxRead, setInboxRead] = useState(0);
  const [promptsRead, setPromptsRead] = useState(0);
  const [inInbox, setInInbox] = useState<ReadonlySet<string>>(new Set());
  const seatApi = useMemo(() => api ?? createMockApi("a25"), [api]);
  const [view, setView] = useState<SeatView>();
  const [seatFailed, setSeatFailed] = useState(false);
  const [seatTry, setSeatTry] = useState(0); // the prompts' retry reads the seat again
  // biome-ignore lint/correctness/useExhaustiveDependencies: seatTry is the retry button's way to read the seat again
  useEffect(() => {
    let alive = true;
    seatApi.seat(slug).then(
      (seat) => {
        if (!alive) return;
        setSeatFailed(false);
        setView(seat);
      },
      () => {
        if (alive) setSeatFailed(true); // the prompts say so, with the retry
      },
    );
    return () => {
      alive = false;
    };
  }, [seatApi, slug, seatTry]);
  const retrySeat = useCallback(() => {
    setSeatFailed(false);
    setSeatTry((n) => n + 1);
  }, []);
  // Each section says when its first read is done, whether it worked or not.
  const [inboxLoaded, setInboxLoaded] = useState(false);
  const [promptsLoaded, setPromptsLoaded] = useState(false);
  const onInboxLoaded = useCallback(() => setInboxLoaded(true), []);
  const onPromptsLoaded = useCallback(() => setPromptsLoaded(true), []);
  const ready =
    (view !== undefined || seatFailed) && inboxLoaded && promptsLoaded;

  return (
    <div className="dd-col" style={{ gap: "var(--s-7)" }}>
      <h1 className="dd-sr-only">{t("verbs.handover")}</h1>
      {!ready && <output className="dd-cap">{t("profile.loading")}</output>}
      <div
        className="dd-col"
        style={{
          gap: "var(--s-7)",
          ...(ready ? undefined : { visibility: "hidden" }),
        }}
        aria-hidden={ready ? undefined : true}
      >
        <InboxPanel
          onItems={setInInbox}
          onLoaded={onInboxLoaded}
          refresh={inboxRead}
          slug={slug}
          api={api}
          mockShortcuts={mockShortcuts}
          onPublished={() => setPromptsRead((n) => n + 1)}
        />
        <HandoverPrompts
          slug={slug}
          api={api}
          view={view}
          seatFailed={seatFailed}
          onSeatRetry={retrySeat}
          refresh={promptsRead}
          hidden={inInbox}
          onLoaded={onPromptsLoaded}
          onPublished={() => setInboxRead((n) => n + 1)}
        />
        {/* There from the start, so a file dropped on the page never opens in the tab; it shows 「＋ 追加」 (or why not)
            only once the seat says who may add, so a non-holder never sees the button flash */}
        <AddPanel slug={slug} api={api} canAdd={view?.viewer.isHolder} />
      </div>
    </div>
  );
}
