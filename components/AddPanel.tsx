"use client";

import { useTranslations } from "next-intl";
import { lazy, Suspense, useEffect, useState } from "react";
import type { Api, ImportResponse } from "@/lib/contracts";

// 「＋ 追加」 on 残す (docs/SPEC.md → adding knowledge: at the start and any time after). The slip, the parsers and the
// redaction load apart from the page and are fetched once it's on screen, so the live loop's inbox above never waits
// for them; if they can't load (an old phone's browser), the inbox still works and the slip says so.
const AddSlip = lazy(() =>
  import("@/components/AddSlip").then(
    (module) => ({ default: module.AddSlip }),
    () => ({ default: SlipUnavailable }),
  ),
);

function SlipUnavailable() {
  const t = useTranslations("import");
  return (
    <p role="alert" style={{ margin: 0 }}>
      {t("unavailable")}
    </p>
  );
}

export type Dropped = { id: number; file: File };

export function AddPanel({
  slug,
  api,
  onImported,
}: {
  slug: string;
  /** The signed-in client (SeatSignIn); mocks as a25 when left out. */
  api?: Api;
  onImported?: (response: ImportResponse) => void;
}) {
  const t = useTranslations("import");
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dropped, setDropped] = useState<Dropped>();

  // Fetch the slip's code now, so the first tap opens it at once (on `pnpm dev`, this also compiles it early).
  useEffect(() => {
    import("@/components/AddSlip").catch(() => undefined);
  }, []);

  // A file dropped anywhere on the page opens the slip and is read there, on the device. Without this the browser
  // would open the file in the tab, which on stage puts the raw export on the projector.
  useEffect(() => {
    const carriesFiles = (event: DragEvent) =>
      event.dataTransfer?.types.includes("Files") ?? false;
    function over(event: DragEvent) {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      setDragging(true);
    }
    function leave(event: DragEvent) {
      if (!event.relatedTarget) setDragging(false); // left the window
    }
    function drop(event: DragEvent) {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer?.files[0];
      if (!file) return;
      setOpen(true);
      setDropped((last) => ({ id: (last?.id ?? 0) + 1, file }));
    }
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  return (
    <section className="dd-col" style={{ gap: "var(--s-3)" }}>
      <div className="dd-row" style={{ gap: "var(--s-3)" }}>
        <button
          type="button"
          className="dd-btn"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          {t("add")}
        </button>
        <p className="dd-cap" style={{ margin: 0 }}>
          {t("anytime")}
        </p>
      </div>
      {open && (
        <Suspense
          fallback={
            <output className="dd-cap" style={{ display: "block" }}>
              {t("reading")}
            </output>
          }
        >
          <AddSlip
            slug={slug}
            api={api}
            dragging={dragging}
            dropped={dropped}
            onClose={() => {
              setOpen(false);
              setDropped(undefined);
            }}
            onImported={onImported}
          />
        </Suspense>
      )}
    </section>
  );
}
