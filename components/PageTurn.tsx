"use client";
// docs/DESIGN.md → Motion, page change. Two ways a seat page gives way to another:
// - Between the verb tabs (slideTo, Nico's call): the page slides out sideways while the chosen one slides in from the
//   other side, by the tabs' order (聞く · 残す · 自分のメモ), through the browser's View Transitions. The top bar and the
//   tabs stay put (styles/components.css → view-transition).
// - Anything else (the guide page, a redirect), or a browser without View Transitions: the new page's content fades in
//   over 160ms, opacity only.
// Never on the first load (the page is simply there); nothing moves under prefers-reduced-motion. Lives in
// app/(seat)/layout.tsx and runs before paint, so the new page never shows for a frame before it moves in.
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef } from "react";

export type SlideDirection = "forward" | "back";

// The slide waiting for its new page: PageTurn ends it once the new path has committed.
let landed: (() => void) | undefined;
// While the slide waits, the page is held still and doesn't answer taps, so it waits this long at most. A page that comes
// later (a cold route, a slow network) skips the slide and fades in when it arrives instead, as other page changes do.
const SLIDE_WAIT_MS = 300;

const lessMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Navigates with the sideways slide; false when the browser can't, or the person asked for less motion, so the
 * caller's link goes the usual way (and fades). */
export function slideTo(
  direction: SlideDirection,
  navigate: () => void,
): boolean {
  if (typeof document.startViewTransition !== "function" || lessMotion()) {
    return false;
  }
  const root = document.documentElement;
  root.dataset.slide = direction;
  let transition: ViewTransition | undefined;
  transition = document.startViewTransition(
    () =>
      new Promise<void>((done) => {
        const giveUp = window.setTimeout(() => {
          landed = undefined; // PageTurn fades the page in when it comes
          transition?.skipTransition();
          done();
        }, SLIDE_WAIT_MS);
        landed = () => {
          window.clearTimeout(giveUp);
          done();
        };
        navigate();
      }),
  );
  const settle = () => {
    delete root.dataset.slide;
    landed = undefined;
  };
  transition.finished.then(settle, settle);
  transition.ready.catch(() => undefined); // a skipped transition (a hidden tab) just navigates
  return true;
}

export function PageTurn() {
  const pathname = usePathname();
  const previous = useRef(pathname);
  useLayoutEffect(() => {
    if (previous.current === pathname) return; // the first load, or the same page
    previous.current = pathname;
    if (landed) {
      // A tab's slide: the new page is in, so the slide can run; no fade on top of it
      landed();
      return;
    }
    if (lessMotion()) return;
    document.querySelector("main")?.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 160,
      easing: "ease-out",
    });
  }, [pathname]);
  return null;
}
