"use client";
// The ask field docked right above the verb tabs on 聞く (docs/DESIGN.md → AskField; Nico's call): always in reach. While
// the reader scrolls the page it fades out and stops taking taps, so what they read isn't covered, and it fades back in
// once the scrolling has stopped for 300ms. Never while focus is in it: typing, and a phone's keyboard scrolling the page
// up to the field, keep it on screen (styles/components.css → .dd-ask-dock).
// - Only the reader's own scrolling fades it (a wheel, a finger, a key, and the glide after them): the page moving by
//   itself (an answer brought into view, the page getting shorter as the live answer lands) leaves it alone.
// - Its height goes to the page as --ask-dock-h, so the page's end and an answer brought into view stop above it, also
//   while it holds an alert and grows.
import { type ReactNode, useEffect, useRef, useState } from "react";

const SETTLE_MS = 300;
// How long after a wheel, touch or key a scroll still counts as the reader's (a phone's glide runs on after the finger).
const GLIDE_MS = 2000;

export function AskDock({ children }: { children: ReactNode }) {
  const [scrolling, setScrolling] = useState(false);
  const dock = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let settle: number | undefined;
    let touched = Number.NEGATIVE_INFINITY;
    const input = () => {
      touched = performance.now();
    };
    const scrolled = () => {
      if (performance.now() - touched > GLIDE_MS) return; // not the reader's
      setScrolling(true);
      window.clearTimeout(settle);
      settle = window.setTimeout(() => setScrolling(false), SETTLE_MS);
    };
    window.addEventListener("wheel", input, { passive: true });
    window.addEventListener("touchmove", input, { passive: true });
    window.addEventListener("keydown", input);
    window.addEventListener("scroll", scrolled, { passive: true });
    return () => {
      window.removeEventListener("wheel", input);
      window.removeEventListener("touchmove", input);
      window.removeEventListener("keydown", input);
      window.removeEventListener("scroll", scrolled);
      window.clearTimeout(settle);
    };
  }, []);
  useEffect(() => {
    const node = dock.current;
    const root = document.documentElement;
    if (!node || typeof ResizeObserver === "undefined") return;
    const measured = new ResizeObserver(() => {
      root.style.setProperty(
        "--ask-dock-h",
        `${Math.ceil(node.getBoundingClientRect().height)}px`,
      );
    });
    measured.observe(node);
    return () => {
      measured.disconnect();
      root.style.removeProperty("--ask-dock-h");
    };
  }, []);
  return (
    <div
      ref={dock}
      className={`dd-ask-dock${scrolling ? " is-scrolling" : ""}`}
    >
      {children}
    </div>
  );
}
