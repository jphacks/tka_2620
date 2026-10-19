"use client";
// docs/DESIGN.md → Motion, page change: when a seat page gives way to another (a verb tab, the guide link),
// the new page's content fades in over 160ms, like a notebook page turning. Opacity only, no slide; never on the first
// load (the page is simply there); instant under prefers-reduced-motion. Lives in app/(seat)/layout.tsx and runs before
// paint, so the new page never shows for a frame before it fades.
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef } from "react";

export function PageTurn() {
  const pathname = usePathname();
  const previous = useRef(pathname);
  useLayoutEffect(() => {
    if (previous.current === pathname) return; // the first load, or the same page
    previous.current = pathname;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.querySelector("main")?.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 160,
      easing: "ease-out",
    });
  }, [pathname]);
  return null;
}
