"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { NotificationsLink } from "./NotificationsLink";
import { BookmarkIcon } from "./icons";
import { initials } from "@/lib/format";
import { useI18n } from "@/i18n/client";

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
  const { t } = useI18n();

  // Render nothing rather than "Log in" while we don't know yet — showing
  // the wrong state for a moment on every page load is worse than a brief
  // gap. The fixed height keeps the row from jumping when links arrive.
  if (status === "loading") return <span className="block h-9 w-24" />;

  const role = session?.user?.role;
  const isStaff = role === "MODERATOR" || role === "ADMIN";

  return (
    <div className="flex items-center gap-1 text-sm">
      {session?.user ? (
        <>
          <NotificationsLink />
          <Link href="/saved" className="btn btn-ghost btn-sm gap-1.5">
            <BookmarkIcon size={16} />
            {t("header.saved")}
          </Link>
          {isStaff && (
            <Link href="/dashboard" className="btn btn-secondary btn-sm ml-1">
              {t("common.dashboard")}
            </Link>
          )}
          <Link
            href="/account"
            className="avatar ml-1 h-8 w-8 text-[11px] transition-shadow hover:ring-ink"
            title={t("common.yourAccount")}
          >
            {initials(session.user.name ?? session.user.email ?? "?")}
            <span className="sr-only">{t("common.yourAccount")}</span>
          </Link>
        </>
      ) : (
        <>
          <Link href="/login" className="btn btn-ghost btn-sm">
            {t("common.login")}
          </Link>
          <Link href="/register" className="btn btn-primary btn-sm">
            {t("common.register")}
          </Link>
        </>
      )}
    </div>
  );
}
