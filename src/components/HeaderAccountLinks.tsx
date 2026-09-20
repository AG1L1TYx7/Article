"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { NotificationsLink } from "./NotificationsLink";

/**
 * Account links read the session on the client on purpose.
 *
 * Reading it on the server inside the shared layout would make every page
 * — including the homepage and article pages — dynamically rendered,
 * because touching cookies opts a route out of static rendering. For a
 * news site those pages are the ones most worth serving from cache, so
 * the few links that differ per visitor are hydrated in instead.
 */
export function HeaderAccountLinks() {
  const { data: session, status } = useSession();

  // Render nothing rather than "Log in" while we don't know yet — showing
  // the wrong state for a moment on every page load is worse than a brief
  // gap.
  if (status === "loading") return <span className="h-5" />;

  const role = session?.user?.role;
  const isStaff = role === "MODERATOR" || role === "ADMIN";

  return (
    <div className="ml-auto flex gap-3 text-sm">
      {session?.user ? (
        <>
          <NotificationsLink />
          <Link href="/saved" className="text-neutral-600 hover:underline">
            Saved
          </Link>
          {isStaff && (
            <Link href="/dashboard" className="text-neutral-600 hover:underline">
              Dashboard
            </Link>
          )}
        </>
      ) : (
        <>
          <Link href="/login" className="text-neutral-600 hover:underline">
            Log in
          </Link>
          <Link href="/register" className="text-neutral-600 hover:underline">
            Register
          </Link>
        </>
      )}
    </div>
  );
}
