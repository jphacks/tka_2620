// docs/DESIGN.md → VerbTabs: the three verbs, 聞く · 残す · 自分のメモ, as notebook index tabs on the bottom edge, the
// same for every seat type. They are links between the verb pages (not ARIA tabs); the page they're on is
// aria-current. 自分のメモ isn't under a seat, so it carries the seat along to link back.
import Link from "next/link";
import { useTranslations } from "next-intl";

export type Verb = "ask" | "handover" | "myNotes";

export function VerbTabs({ seat, current }: { seat: string; current: Verb }) {
  const t = useTranslations("verbs");
  const slug = encodeURIComponent(seat);
  const verbs: { verb: Verb; href: string }[] = [
    { verb: "ask", href: `/s/${slug}` },
    { verb: "handover", href: `/s/${slug}/handover` },
    { verb: "myNotes", href: `/me/notes?seat=${slug}` },
  ];
  return (
    <nav className="dd-verbs">
      <div className="dd-tabs">
        {verbs.map(({ verb, href }) => (
          <Link
            key={verb}
            href={href}
            className="dd-tab"
            aria-current={verb === current ? "page" : undefined}
          >
            {t(verb)}
          </Link>
        ))}
      </div>
    </nav>
  );
}
