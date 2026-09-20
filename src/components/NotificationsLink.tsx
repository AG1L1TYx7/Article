"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellIcon } from "./icons";

/**
 * The header's Notifications link, with an unread count.
 *
 * The count is fetched after mount rather than rendered on the server:
 * reading the session in the shared layout would make every page dynamic
 * and cost the static homepage. See HeaderAccountLinks for the full
 * reasoning. Until it arrives the link simply shows no badge, which is
 * better than showing a wrong one.
 */
export function NotificationsLink() {
  const [count, setCount] = useState<number | null>(null);
  const pathname = usePathname();
  // Guards against a slow response landing after the component has gone,
  // and against two in-flight requests resolving out of order.
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    let cancelled = false;

    fetch("/api/notifications/unread-count")
      .then((r) => (r.ok ? r.json() : { count: 0 }))
      .then((data: { count?: number }) => {
        if (cancelled || id !== requestId.current) return;
        setCount(typeof data.count === "number" ? data.count : 0);
      })
      // A failed count is not worth surfacing to a reader — the link still
      // works, it just has no badge.
      .catch(() => {});

    return () => {
      cancelled = true;
    };
    // Re-checked on navigation, so reading the list updates the badge.
  }, [pathname]);

  const unread = count !== null && count > 0;

  return (
    <Link href="/notifications" className="btn btn-ghost btn-icon relative" aria-label="Notifications">
      <BellIcon size={18} />
      {/* The accessible name stays "Notifications" whether or not the
          badge is showing; the count is read out after it. */}
      <span className="sr-only">Notifications</span>
      {unread && (
        <span className="absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white ring-2 ring-paper">
          {count > 99 ? "99+" : count}
          <span className="sr-only"> unread</span>
        </span>
      )}
    </Link>
  );
}
