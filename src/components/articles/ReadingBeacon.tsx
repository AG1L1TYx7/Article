"use client";

import { useEffect } from "react";

/**
 * Measures how an article is read — active seconds and furthest scroll —
 * and sends one small beacon when the reader leaves. Nothing about who:
 * no id, no cookie, no fingerprint; the server adds the numbers to the
 * day's totals for the article and forgets the request.
 *
 * "Active" means the tab was visible: a story left open in a background
 * tab for an hour is not an hour of reading. The beacon goes on
 * pagehide / hidden, via sendBeacon so it survives navigation, and no
 * more than once per page view.
 */
export function ReadingBeacon({ articleId }: { articleId: string }) {
  useEffect(() => {
    let visibleSince = document.visibilityState === "visible" ? performance.now() : null;
    let activeMs = 0;
    let maxScroll = 0;
    let sent = false;

    const accumulate = () => {
      if (visibleSince !== null) {
        activeMs += performance.now() - visibleSince;
        visibleSince = null;
      }
    };

    const onScroll = () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight;
      const depth = scrollable <= 0 ? 100 : Math.round(((window.scrollY + window.innerHeight) / doc.scrollHeight) * 100);
      if (depth > maxScroll) maxScroll = Math.min(100, depth);
    };

    const send = () => {
      if (sent) return;
      accumulate();
      const activeSeconds = Math.round(activeMs / 1000);
      // Under two seconds is a bounce or a misclick, and not worth a
      // request — the view itself was already counted server-side.
      if (activeSeconds < 2) return;
      sent = true;
      const body = JSON.stringify({ articleId, activeSeconds, scrollDepth: maxScroll });
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/analytics/read", new Blob([body], { type: "application/json" }));
      } else {
        fetch("/api/analytics/read", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => {});
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        accumulate();
        send();
      } else {
        visibleSince = performance.now();
        // A tab brought back is a new stretch of reading; allow a second
        // beacon only if the first was never sent.
      }
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", send);

    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", send);
      // Client-side navigation away from the article counts as leaving.
      send();
    };
  }, [articleId]);

  return null;
}
