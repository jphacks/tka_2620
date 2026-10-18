"use client";
// 残す on /s/<seat>/handover: newcomers' questions, the handover prompts, then 「＋ 追加」. A newcomer's question is in
// both the inbox and the prompts (demand ranks first), so publishing in one has the other read its list again.
import { useState } from "react";
import { AddPanel } from "@/components/AddPanel";
import { HandoverPrompts } from "@/components/HandoverPrompts";
import { InboxPanel } from "@/components/InboxPanel";
import type { Api } from "@/lib/contracts";

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
  const [inboxRead, setInboxRead] = useState(0);
  const [promptsRead, setPromptsRead] = useState(0);
  return (
    <div className="dd-col" style={{ gap: "var(--s-7)" }}>
      <InboxPanel
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
        onPublished={() => setInboxRead((n) => n + 1)}
      />
      <AddPanel slug={slug} api={api} />
    </div>
  );
}
