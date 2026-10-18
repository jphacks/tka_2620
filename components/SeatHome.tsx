"use client";
// 聞く (/s/[seat]): the club-room key and its notebook. The key tag, the lineage, the deadlines coming up and the way to
// the whole handover guide (引き継ぎ書), then the ask panel. AskPanel loads the seat view (as a26 on mocks, as the signed-in persona on real data) and hands it up, so
// the page reads GET /api/seats/[slug] once.
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AskPanel } from "@/components/AskPanel";
import { LineageRail } from "@/components/LineageRail";
import { SeatHeader } from "@/components/SeatHeader";
import { UpcomingList } from "@/components/UpcomingList";
import type { Api, SeatView } from "@/lib/contracts";

export function SeatHome({
  slug,
  api,
  mockShortcuts,
}: {
  slug: string;
  /** The signed-in persona's client; mocks as a26 when left out. */
  api?: Api;
  mockShortcuts?: boolean;
}) {
  const t = useTranslations("guide");
  const [view, setView] = useState<SeatView>();
  return (
    <div className="dd-col" style={{ gap: "var(--s-6)" }}>
      {view && (
        <>
          <SeatHeader seat={view.seat} />
          <LineageRail view={view} />
          <UpcomingList items={view.upcoming} />
          <Link
            className="dd-link dd-guide-link"
            href={`/s/${encodeURIComponent(slug)}/guide`}
          >
            {t("open")}
          </Link>
        </>
      )}
      <AskPanel
        slug={slug}
        api={api}
        mockShortcuts={mockShortcuts}
        onSeat={setView}
      />
    </div>
  );
}
