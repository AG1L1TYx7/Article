import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { MarkAllReadButton } from "./MarkAllReadButton";

export const metadata: Metadata = {
  title: "Notifications",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 50;

export default async function NotificationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/notifications");

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
      comment: { select: { body: true, status: true } },
    },
  });

  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Notifications</h1>
        {unread > 0 && <MarkAllReadButton count={unread} />}
      </div>

      {notifications.length === 0 && (
        <p className="mt-8 text-neutral-600">
          Nothing yet. When someone replies to one of your comments, it will show up here.
        </p>
      )}

      <ul className="mt-8 flex flex-col gap-4">
        {notifications.map((n) => {
          // A comment can be hidden or deleted after the notification was
          // written, so the text is only shown while it is still public.
          const visibleBody = n.comment?.status === "APPROVED" ? n.comment.body : null;
          const href = n.article
            ? `/article/${n.article.slug}${n.commentId ? `#comment-${n.commentId}` : ""}`
            : null;

          const headline =
            n.type === "COMMENT_REPLY"
              ? `${n.actor?.name ?? "Someone"} replied to your comment`
              : n.type === "BREAKING_NEWS"
                ? "Breaking news"
                : "Your comment was approved and is now public";

          return (
            <li
              key={n.id}
              className={`rounded-md border px-4 py-3 ${
                n.readAt ? "border-neutral-200" : "border-neutral-400 bg-neutral-50"
              }`}
            >
              <p className="text-sm font-medium text-neutral-800">
                {!n.readAt && (
                  <span className="mr-2 inline-block h-2 w-2 rounded-full bg-neutral-900 align-middle">
                    <span className="sr-only">Unread</span>
                  </span>
                )}
                {headline}
              </p>

              {n.article && (
                <p className="mt-1 text-xs text-neutral-500">on “{n.article.title}”</p>
              )}

              {/* Plain text, rendered as text — comments are never HTML. */}
              {visibleBody && (
                <p className="mt-2 line-clamp-3 text-sm whitespace-pre-wrap text-neutral-700">
                  {visibleBody}
                </p>
              )}

              <p className="mt-2 text-xs text-neutral-500">
                {n.createdAt.toLocaleString()}
                {href && (
                  <>
                    {" · "}
                    <Link href={href} className="underline">
                      View in thread
                    </Link>
                  </>
                )}
              </p>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
