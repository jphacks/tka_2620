"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type AnswerMode, InboxSlip } from "@/components/InboxSlip";
import { VoiceAnswer } from "@/components/VoiceAnswer";
import type { Api, InboxItem } from "@/lib/contracts";
import { createMockApi, mockNewcomerAsks } from "@/lib/mocks";
import { useRealtime } from "@/lib/realtime";

// Long enough to read 「公開しました」 and the card, short enough that the pane is clear before the next step.
const CLOSE_AFTER_PUBLISH_MS = 3000;
const newestFirst = (a: InboxItem, b: InboxItem) =>
  Date.parse(b.askedAt) - Date.parse(a.askedAt);

// The inbox on the predecessor's phone (残す): newcomers' questions nobody could answer, arriving without a reload.
// Mocks only for now (NEXT_PUBLIC_USE_MOCKS=1), as last year's treasurer (a25); the real client replaces
// createMockApi when /api/inbox exists (#8). The console hides the one-phone shortcut (the a26 pane asks instead)
// and closes the published card by itself, so 自分のメモ is back in view for the withdrawal.
export function InboxPanel({
  slug,
  onAnswer,
  mockShortcuts = true,
  closeAfterPublish = false,
  api: given,
}: {
  slug: string;
  onAnswer?: (item: InboxItem, mode: AnswerMode) => void;
  mockShortcuts?: boolean;
  closeAfterPublish?: boolean;
  /** The signed-in predecessor's client (a console pane's); mocks as a25 when left out. */
  api?: Api;
}) {
  const t = useTranslations();
  const api = useMemo(() => given ?? createMockApi("a25"), [given]);
  const [items, setItems] = useState<InboxItem[]>();
  const [arrived, setArrived] = useState<ReadonlySet<string>>(new Set());
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState(false);
  // The slip being answered, with the mode the person tapped (声で答える / 文字で答える).
  const [answering, setAnswering] = useState<{
    item: InboxItem;
    mode: AnswerMode;
  }>();
  const known = useRef<Set<string> | undefined>(undefined);

  // The first load shows what is already waiting; anything new after that arrives.
  const load = useCallback(async () => {
    let next: InboxItem[];
    try {
      ({ items: next } = await api.inbox({ seat: slug }));
    } catch {
      setFailed(true); // slips already shown stay
      return;
    }
    setFailed(false);
    const seen = known.current;
    known.current = new Set(next.map((item) => item.promptId));
    setItems([...next].sort(newestFirst));
    const fresh = seen ? next.filter((item) => !seen.has(item.promptId)) : [];
    if (fresh.length === 0) return;
    setArrived(
      (previous) =>
        new Set([...previous, ...fresh.map((item) => item.promptId)]),
    );
    // Android only, and only after the page was tapped once; iPhones can't vibrate from a web page.
    if ("vibrate" in navigator) navigator.vibrate([180, 80, 180]);
  }, [api, slug]);

  useEffect(() => {
    load();
  }, [load]);
  // A route row holds no question text, so fetch the inbox again.
  useRealtime(api, "prompt_routes", () => {
    load();
  });

  async function newcomerAsks() {
    setAsking(true);
    try {
      await mockNewcomerAsks();
    } finally {
      setAsking(false);
    }
  }

  return (
    <section
      className="dd-col"
      style={{ gap: "var(--s-5)" }}
      aria-labelledby="inbox-title"
    >
      <h2 id="inbox-title" className="dd-h">
        {t("inbox.title")}
      </h2>
      <div className="dd-col" style={{ gap: "var(--s-5)" }} aria-live="polite">
        {items?.map((item) => (
          <InboxSlip
            key={item.promptId}
            item={item}
            arriving={arrived.has(item.promptId)}
            onAnswer={(next, mode) => {
              setAnswering({ item: next, mode });
              onAnswer?.(next, mode);
            }}
          />
        ))}
        {items?.length === 0 && (
          <p style={{ margin: 0, color: "var(--ink-2)" }}>{t("inbox.empty")}</p>
        )}
        {failed && (
          <p style={{ margin: 0, color: "var(--ink-2)" }}>
            {t("inbox.failed")}
          </p>
        )}
      </div>
      {/* 声で/文字で答える opens here; publishing shows the card and refreshes the inbox. */}
      {answering && (
        <VoiceAnswer
          key={answering.item.promptId}
          item={answering.item}
          seat={slug}
          mode={answering.mode}
          api={api}
          onPublished={() => {
            load();
            if (!closeAfterPublish) return;
            const { promptId } = answering.item;
            setTimeout(
              () =>
                setAnswering((current) =>
                  current?.item.promptId === promptId ? undefined : current,
                ),
              CLOSE_AFTER_PUBLISH_MS,
            );
          }}
          onClose={() => setAnswering(undefined)}
        />
      )}
      {/* Plays the newcomer asking q04 in this tab (lib/mocks.ts), so the loop works on one phone. */}
      {mockShortcuts && items?.length === 0 && (
        <button
          type="button"
          className="dd-link"
          style={{ justifySelf: "start", minHeight: "44px" }}
          disabled={asking}
          onClick={newcomerAsks}
        >
          {t("mock.newcomerAsks")}
        </button>
      )}
    </section>
  );
}
