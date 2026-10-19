"use client";
// docs/DESIGN.md → VerbTabs: the three verbs, 聞く · 残す · 自分のメモ, as notebook index tabs on the bottom edge, the
// same for every seat type. They are links between the verb pages (not ARIA tabs); the page they're on is
// aria-current. 自分のメモ isn't under a seat, so it carries the seat along to link back. Changing tabs slides the page
// sideways by the tabs' order (PageTurn → slideTo, Nico's call): a tab to the right brings its page in from the right.
// A click with a modifier key (a new tab or window) keeps the link's own behaviour.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { MouseEvent } from "react";
import { slideTo } from "@/components/PageTurn";

export type Verb = "ask" | "handover" | "myNotes";

const ORDER: Verb[] = ["ask", "handover", "myNotes"];

// current: the verb page this is; none on /me, which isn't a verb.
export function VerbTabs({ seat, current }: { seat: string; current?: Verb }) {
  const t = useTranslations("verbs");
  const router = useRouter();
  const slug = encodeURIComponent(seat);
  const hrefs: Record<Verb, string> = {
    ask: `/s/${slug}`,
    handover: `/s/${slug}/handover`,
    myNotes: `/me/notes?seat=${slug}`,
  };
  function go(event: MouseEvent<HTMLAnchorElement>, verb: Verb) {
    if (!current || verb === current) return;
    const plain =
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey;
    if (!plain || event.defaultPrevented) return;
    const direction =
      ORDER.indexOf(verb) > ORDER.indexOf(current) ? "forward" : "back";
    if (slideTo(direction, () => router.push(hrefs[verb]))) {
      event.preventDefault();
    }
  }
  return (
    // Labelled, since every seat page has a second nav (SeatBar).
    <nav className="dd-verbs" aria-label={t("label")}>
      <div className="dd-tabs">
        {ORDER.map((verb) => (
          <Link
            key={verb}
            href={hrefs[verb]}
            className="dd-tab"
            aria-current={verb === current ? "page" : undefined}
            onClick={(event) => go(event, verb)}
          >
            {t(verb)}
          </Link>
        ))}
      </div>
    </nav>
  );
}
