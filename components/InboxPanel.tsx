"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InboxSlip } from "@/components/InboxSlip";
import { RetryLine } from "@/components/RetryLine";
import { VoiceAnswer } from "@/components/VoiceAnswer";
import type { Api, InboxItem } from "@/lib/contracts";
import { createMockApi, mockNewcomerAsks } from "@/lib/mocks";
import { useRealtime } from "@/lib/realtime";

// Long enough to read 「公開しました」 and the card, short enough that the pane is clear before the next step.
const CLOSE_AFTER_PUBLISH_MS = 3000;
// Heard, not seen: the line a screen reader reads when a question arrives.
const SR_ONLY = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
} as const;
const newestFirst = (a: InboxItem, b: InboxItem) =>
  Date.parse(b.askedAt) - Date.parse(a.askedAt);

// The inbox on the predecessor's phone (残す): newcomers' questions nobody could answer, arriving without a reload.
// Mocks only for now (NEXT_PUBLIC_USE_MOCKS=1), as last year's treasurer (a25); the real client replaces
// createMockApi when /api/inbox exists (#8). The console hides the one-phone shortcut (the a26 pane asks instead)
// and closes the published card by itself, so 自分のメモ is back in view for the withdrawal.
export function InboxPanel({
  slug,
  mockShortcuts = true,
  closeAfterPublish = false,
  onPublished,
  refresh = 0,
  onItems,
  onLoaded,
  api: given,
}: {
  slug: string;
  mockShortcuts?: boolean;
  closeAfterPublish?: boolean;
  /** An answer was published here (the handover prompts below read their list again). */
  onPublished?: () => void;
  /** Changes when the handover prompts below published: read the slips again, keeping an answer being written. */
  refresh?: number;
  /** The questions now in the inbox, so the handover prompts below don't show them a second time. */
  onItems?: (promptIds: ReadonlySet<string>) => void;
  /** The first read is done, whether it worked or not (残す shows its sections together then). Stable. */
  onLoaded?: () => void;
  /** The signed-in predecessor's client (a console pane's); mocks as a25 when left out. */
  api?: Api;
}) {
  const t = useTranslations();
  const api = useMemo(() => given ?? createMockApi("a25"), [given]);
  const [items, setItems] = useState<InboxItem[]>();
  const [arrived, setArrived] = useState<ReadonlySet<string>>(new Set());
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState(false);
  // Slips answered here, kept in view with the published card until 閉じる (or, on the console, a few seconds), though
  // the inbox no longer lists them.
  const [kept, setKept] = useState<ReadonlyMap<string, InboxItem>>(new Map());
  const known = useRef<Set<string> | undefined>(undefined);
  // What a screen reader hears when a question arrives: one line, not the whole slip and its answer field.
  const [announced, setAnnounced] = useState<InboxItem>();

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
    onItems?.(known.current);
    setItems([...next].sort(newestFirst));
    const fresh = seen ? next.filter((item) => !seen.has(item.promptId)) : [];
    if (fresh.length === 0) return;
    setArrived(
      (previous) =>
        new Set([...previous, ...fresh.map((item) => item.promptId)]),
    );
    setAnnounced(fresh[0]);
    // Android only, and only after the page was tapped once; iPhones can't vibrate from a web page.
    if ("vibrate" in navigator) navigator.vibrate([180, 80, 180]);
  }, [api, slug, onItems]);

  // A phone that slept, or lost the network, may have missed a Realtime row: read the inbox again when the page is back.
  useEffect(() => {
    const again = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", again);
    window.addEventListener("online", again);
    return () => {
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("online", again);
    };
  }, [load]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh is the signal to read again
  useEffect(() => {
    load();
  }, [load, refresh]);
  const loaded = items !== undefined || failed;
  useEffect(() => {
    if (loaded) onLoaded?.();
  }, [loaded, onLoaded]);
  // A route row holds no question text, so fetch the inbox again.
  useRealtime(api, "prompt_routes", () => {
    load();
  });

  const release = (promptId: string) =>
    setKept((current) => {
      const next = new Map(current);
      next.delete(promptId);
      return next;
    });
  // The inbox as listed, plus the slips answered here that are still open on their card.
  const shown =
    items &&
    [
      ...items,
      ...[...kept.values()].filter(
        (old) => !items.some((item) => item.promptId === old.promptId),
      ),
    ].sort(newestFirst);

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
      <output aria-live="polite" style={SR_ONLY}>
        {announced &&
          t("inbox.announce", {
            from: announced.askedBy,
            question: announced.question,
          })}
      </output>
      <div className="dd-col" style={{ gap: "var(--s-5)" }}>
        {shown?.map((item) => (
          <InboxSlip
            key={item.promptId}
            item={item}
            arriving={arrived.has(item.promptId)}
          >
            {/* Written on the slip; publishing shows the card here and refreshes the inbox. */}
            <VoiceAnswer
              item={item}
              seat={slug}
              api={api}
              describedBy={`inbox-q-${item.promptId}`}
              onPublished={() => {
                setKept((current) => new Map(current).set(item.promptId, item));
                load();
                onPublished?.();
                if (closeAfterPublish) {
                  setTimeout(() => {
                    release(item.promptId);
                    // The console's pane had scrolled down to the card: back up to the inbox's heading, so the pane
                    // reads from its top again instead of cutting the heading off.
                    document
                      .getElementById("inbox-title")
                      ?.scrollIntoView({ block: "nearest" });
                  }, CLOSE_AFTER_PUBLISH_MS);
                }
              }}
              onClose={() => release(item.promptId)}
            />
          </InboxSlip>
        ))}
        {shown?.length === 0 && (
          <p style={{ margin: 0, color: "var(--ink-2)" }}>{t("inbox.empty")}</p>
        )}
        {failed && <RetryLine message={t("inbox.failed")} onRetry={load} />}
      </div>
      {/* Plays the newcomer asking q04 in this tab (lib/mocks.ts), so the loop works on one phone. */}
      {mockShortcuts && shown?.length === 0 && (
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
