"use client";
// The ask field docked right above the verb tabs on 聞く (docs/DESIGN.md → AskField; Nico's call): always in reach. While
// the page scrolls it fades out and stops taking taps, so what you read isn't covered, and it fades back in once the
// scrolling has stopped for 300ms. Never while focus is in it: typing, and a phone's keyboard scrolling the page up to
// the field, keep it on screen (styles/components.css → .dd-ask-dock).
import { type ReactNode, useEffect, useState } from "react";

const SETTLE_MS = 300;

export function AskDock({ children }: { children: ReactNode }) {
  const [scrolling, setScrolling] = useState(false);
  useEffect(() => {
    let settle: number | undefined;
    const scrolled = () => {
      setScrolling(true);
      window.clearTimeout(settle);
      settle = window.setTimeout(() => setScrolling(false), SETTLE_MS);
    };
    window.addEventListener("scroll", scrolled, { passive: true });
    return () => {
      window.removeEventListener("scroll", scrolled);
      window.clearTimeout(settle);
    };
  }, []);
  return (
    <div className={`dd-ask-dock${scrolling ? " is-scrolling" : ""}`}>
      {children}
    </div>
  );
}
