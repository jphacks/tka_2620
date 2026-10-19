"use client";
// 残す on /s/<seat>/handover: the page's heading with the seat it's for, newcomers' questions, the handover prompts, then
// 「＋ 追加」. A newcomer's question shows once, on its inbox slip: the prompts below leave out what the inbox holds, and
// publishing in one has the other read its list again. Only the seat's holders get 「＋ 追加」. The sections appear
// together, in place, once the seat, the inbox and the prompts have been read: until then they are there but unseen, so
// 「＋ 追加」 doesn't slide down under a finger as the slips and prompts above it arrive.
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
  useEffect(() => {
    let alive = true;
    seatApi.seat(slug).then(
      (seat) => {
        if (alive) setView(seat);
      },
      () => {
        // the heading stays without its seat line; the sections below say what failed
        if (alive) setSeatFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [seatApi, slug]);
  // Each section says when its first read is done, whether it worked or not.
  const [inboxLoaded, setInboxLoaded] = useState(false);
  const [promptsLoaded, setPromptsLoaded] = useState(false);
  const onInboxLoaded = useCallback(() => setInboxLoaded(true), []);
  const onPromptsLoaded = useCallback(() => setPromptsLoaded(true), []);
  const ready =
    (view !== undefined || seatFailed) && inboxLoaded && promptsLoaded;

  return (
    <div className="dd-col" style={{ gap: "var(--s-7)" }}>
      <header className="dd-page-head">
        <h1 className="dd-h dd-page-title">{t("verbs.handover")}</h1>
        <p className="dd-cap">
          {view
            ? t("handover.seatLine", {
                seat: view.seat.name,
                group: view.seat.group,
              })
            : " "}
        </p>
      </header>
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
          refresh={promptsRead}
          hidden={inInbox}
          onLoaded={onPromptsLoaded}
          onPublished={() => setInboxRead((n) => n + 1)}
        />
        {/* Only once the seat says who may add: a non-holder never sees 「＋ 追加」 flash before its caption */}
        {view && (
          <AddPanel slug={slug} api={api} canAdd={view.viewer.isHolder} />
        )}
      </div>
    </div>
  );
}
