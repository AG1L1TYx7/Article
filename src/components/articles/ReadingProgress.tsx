"use client";

import { useEffect, useRef } from "react";

/**
 * A 3px line of crimson along the top that fills as the reader moves
 * through the story. The one moving thing on the page, and deliberately
 * quiet: no percentage, no label, nothing to click.
 *
 * Written straight to the element's style from a scroll listener rather
 * than through state — it changes on every scroll frame, and re-rendering
 * React for a width is wasteful. Honours prefers-reduced-motion by
 * skipping the transition, not the bar.
 */
export function ReadingProgress({ target = "article" }: { target?: string }) {
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bar.current;
    const article = document.querySelector(target);
    if (!el || !article) return;

    let frame = 0;
    function update() {
      frame = 0;
      const rect = (article as HTMLElement).getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const done = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 1;
      el!.style.transform = `scaleX(${done})`;
    }
    function onScroll() {
      if (!frame) frame = requestAnimationFrame(update);
    }
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [target]);

  return (
    <div
      ref={bar}
      aria-hidden="true"
      className="fixed inset-x-0 top-0 z-50 h-[3px] origin-left bg-accent motion-safe:transition-transform motion-safe:duration-100"
      style={{ transform: "scaleX(0)" }}
    />
  );
}
