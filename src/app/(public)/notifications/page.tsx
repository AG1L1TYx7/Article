import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { MarkAllReadButton } from "./MarkAllReadButton";
import { BellIcon, CheckIcon, FlagIcon, MessageIcon } from "@/components/icons";
import { initials } from "@/lib/format";
import { PushToggle } from "@/components/push/PushToggle";
import { getI18n } from "@/i18n/server";

export const metadata: Metadata = {
  title: "Notifications",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 50;

export default async function NotificationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/notifications");

  const { t, formatDateTime, formatNumber } = await getI18n();

  const notifications = await db.notification.findMany({
    // Scoped to the signed-in reader. Notifications are per-person by
    // definition; there is no view of anyone else's.
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE,
    select: {
      id: true,
      type: true,
      readAt: true,
      createdAt: true,
      commentId: true,
      actor: { select: { name: true } },
      article: { select: { slug: true, title: true } },
      comment: { select: { body: true, status: true, anonymous: true } },
      // Only what may be shown. Deliberately not the reporter: a district
      // alert must never carry who filed the report, and the surest way
      // to guarantee that is never to read it here.
      issue: { select: { slug: true, title: true, district: { select: { name: true } } } },
    },
  });

  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <main id="main-content" className="mx-auto max-w-3xl px-4 pt-10 pb-16 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker">{t("notifications.kicker")}</p>
          <h1 className="headline mt-2 text-4xl">{t("notifications.title")}</h1>
          {unread > 0 && (
            <p className="mt-2 text-sm text-ink-3">{t("notifications.unread", { count: formatNumber(unread) })}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PushToggle variant="button" />
          {unread > 0 && <MarkAllReadButton count={unread} />}
        </div>
      </div>

      {notifications.length === 0 && (
        <div className="card mt-8 flex flex-col items-center px-6 py-12 text-center">
          <span className="avatar h-12 w-12">
            <BellIcon size={20} />
          </span>
          <p className="mt-4 font-medium">{t("notifications.nothingYet")}</p>
          <p className="mt-1 max-w-sm text-sm text-ink-2">{t("notifications.howTo")}</p>
        </div>
      )}

      <ul className="mt-8 flex flex-col gap-2">
        {notifications.map((n) => {
          // A comment can be hidden or deleted after the notification was
          // written, so the text is only shown while it is still public.
          const visibleBody = n.comment?.status === "APPROVED" ? n.comment.body : null;
          const href = n.article
            ? `/article/${n.article.slug}${n.commentId ? `#comment-${n.commentId}` : ""}`
            : n.issue
              ? `/issues/${n.issue.slug}`
              : null;

          // An anonymous reply stays anonymous here too: the author's name
          // must not leak through the notification about their comment.
          const actorName = n.comment?.anonymous ? t("notifications.someone") : (n.actor?.name ?? t("notifications.someone"));
          const headline =
            n.type === "COMMENT_REPLY"
              ? t("notifications.replied", { name: actorName })
              : n.type === "BREAKING_NEWS"
                ? t("notifications.breakingNews")
                : n.type === "ISSUE_IN_YOUR_DISTRICT"
                  ? t("notifications.issueNearby", {
                      district: n.issue?.district.name ?? t("notifications.yourDistrict"),
                    })
                  : n.type === "YOUR_ISSUE_UPDATED"
                    ? t("notifications.yourIssueUpdated")
                    : t("notifications.approved");

          const glyph =
            n.type === "COMMENT_REPLY" ? (
              <span className="avatar h-9 w-9 text-xs">{initials(n.comment?.anonymous ? "?" : (n.actor?.name ?? "?"))}</span>
            ) : n.type === "ISSUE_IN_YOUR_DISTRICT" || n.type === "YOUR_ISSUE_UPDATED" ? (
              <span className="avatar h-9 w-9 bg-accent-soft text-accent ring-accent/20">
                <FlagIcon size={16} />
              </span>
            ) : n.type === "BREAKING_NEWS" ? (
              <span className="avatar h-9 w-9 bg-accent-soft text-accent ring-accent/20">
                <BellIcon size={16} />
              </span>
            ) : (
              <span className="avatar h-9 w-9 bg-ok-soft text-ok ring-ok/20">
                <CheckIcon size={16} />
              </span>
            );

          return (
            <li
              key={n.id}
              className={`card flex gap-4 px-4 py-4 ${n.readAt ? "" : "border-l-4 border-l-accent"}`}
            >
              {glyph}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">
                  {!n.readAt && <span className="sr-only">{t("notifications.unreadPrefix")} </span>}
                  {headline}
                </p>

                {n.article && (
                  <p className="mt-0.5 text-xs text-ink-3">
                    {t("notifications.on")}{" "}
                    <span className="font-serif text-[13px] text-ink-2 italic">“{n.article.title}”</span>
                  </p>
                )}

                {/* Plain text, rendered as text — comments are never HTML. */}
                {visibleBody && (
                  <p className="mt-2 flex gap-2 text-sm text-ink-2">
                    <MessageIcon size={14} className="mt-0.5 shrink-0 text-ink-3" />
                    <span className="line-clamp-3 whitespace-pre-wrap">{visibleBody}</span>
                  </p>
                )}

                <p className="mt-2 flex flex-wrap items-center gap-x-3 text-xs text-ink-3">
                  <time dateTime={n.createdAt.toISOString()}>{formatDateTime(n.createdAt)}</time>
                  {href && (
                    <Link href={href} className="text-link">
                      {t("notifications.viewInThread")}
                    </Link>
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
