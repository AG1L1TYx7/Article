import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { approveComment, hideComment, deleteComment, suspendCommenter } from "./actions";
import { PageBody, PageHeader } from "../../PageHeader";
import { ActionButton } from "@/components/ActionButton";
import { CheckIcon, FlagIcon } from "@/components/icons";
import { formatDateTime, initials } from "@/lib/format";
import { getSettings } from "@/lib/settings";

const MODE_LABEL = {
  trusted: "Comments post immediately; only text the spam checks flag waits here.",
  new_accounts: (n: number) =>
    `A reader's first ${n} comment${n === 1 ? "" : "s"} wait here; after that they post immediately.`,
  all: "Every reader's comment waits here before it appears.",
} as const;

export const metadata: Metadata = { title: "Comment moderation", robots: { index: false, follow: false } };

export default async function CommentModerationPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [pending, reported] = await Promise.all([
    db.comment.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      include: {
        author: { select: { id: true, name: true, email: true, createdAt: true, _count: { select: { comments: true } } } },
        article: { select: { title: true, slug: true } },
      },
      take: 100,
    }),
    db.report.findMany({
      where: { status: "OPEN", commentId: { not: null } },
      orderBy: { createdAt: "asc" },
      include: {
        comment: {
          include: { author: { select: { id: true, name: true } }, article: { select: { title: true, slug: true } } },
        },
        reporter: { select: { name: true } },
      },
      take: 100,
    }),
  ]);

  const queueEmpty = pending.length === 0 && reported.length === 0;
  const settings = await getSettings();
  const modeText =
    settings.commentModeration === "new_accounts"
      ? MODE_LABEL.new_accounts(settings.trustedAfterApprovedComments)
      : MODE_LABEL[settings.commentModeration];

  return (
    <main id="main-content">
      <PageHeader
        kicker="Community"
        title="Comment moderation"
        description={
          <>
            {queueEmpty ? "Nothing waiting. " : `${pending.length} awaiting review · ${reported.length} reported by readers. `}
            {modeText}
            {session.user.role === "ADMIN" && (
              <>
                {" "}
                <Link href="/dashboard/settings" className="text-link">
                  Change in Settings
                </Link>
                .
              </>
            )}
          </>
        }
      />

      <PageBody narrow>
        {queueEmpty && (
          <div className="card flex flex-col items-center px-6 py-14 text-center">
            <span className="avatar h-12 w-12 bg-ok-soft text-ok ring-ok/20">
              <CheckIcon size={20} />
            </span>
            <p className="mt-4 font-medium">The queue is clear</p>
            <p className="mt-1 max-w-sm text-sm text-ink-2">
              Comments from established readers appear immediately; the rest come here first.
            </p>
          </div>
        )}

        {pending.length > 0 && (
          <section aria-labelledby="pending-heading">
            <h2 id="pending-heading" className="section-title">
              Awaiting review ({pending.length})
            </h2>
            <ul className="mt-4 flex flex-col gap-3">
              {pending.map((c) => (
                <li key={c.id} className="card p-4">
                  <div className="flex items-start gap-3">
                    <span className="avatar h-9 w-9 text-xs">{initials(c.author.name)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">
                        <strong>{c.author.name}</strong>{" "}
                        {/* Moderators always see who wrote it; readers will not. */}
                        {c.anonymous && <span className="pill pill-neutral mr-1">posted anonymously</span>}
                        <span className="text-ink-3">on</span>{" "}
                        <Link href={`/article/${c.article.slug}`} className="text-link">{c.article.title}</Link>
                      </p>
                      <p className="text-xs text-ink-3">
                        {c.author.email} · joined {formatDateTime(c.author.createdAt)} · {c.author._count.comments} comment
                        {c.author._count.comments === 1 ? "" : "s"} · posted {formatDateTime(c.createdAt)}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-sm whitespace-pre-wrap text-ink">{c.body}</p>
                  <div className="mt-3 flex flex-wrap items-start gap-1">
                    <ActionButton action={approveComment} args={[c.id]} className="btn btn-sm btn-primary" pendingLabel="Approving…">
                      Approve
                    </ActionButton>
                    <ActionButton action={hideComment} args={[c.id]} className="btn btn-sm btn-ghost" pendingLabel="Hiding…">
                      Hide
                    </ActionButton>
                    <ActionButton
                      action={deleteComment}
                      args={[c.id]}
                      className="btn btn-sm btn-ghost text-danger"
                      pendingLabel="Deleting…"
                      confirm="Delete this comment? The reader will not be told."
                    >
                      Delete
                    </ActionButton>
                    <span className="ml-auto">
                      <ActionButton
                        action={suspendCommenter}
                        args={[c.author.id]}
                        className="btn btn-sm btn-danger"
                        pendingLabel="Suspending…"
                        confirm={`Suspend ${c.author.name}? They will be signed out and unable to log in until reinstated from the People page.`}
                      >
                        Suspend author
                      </ActionButton>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {reported.length > 0 && (
          <section aria-labelledby="reported-heading" className={pending.length > 0 ? "mt-12" : ""}>
            <h2 id="reported-heading" className="section-title">
              Reported by readers ({reported.length})
            </h2>
            <ul className="mt-4 flex flex-col gap-3">
              {reported.map((r) => (
                <li key={r.id} className="card border-danger/30 p-4">
                  <p className="flex items-center gap-2 text-sm">
                    <FlagIcon size={14} className="text-danger" />
                    Reported as <strong>{r.reason}</strong> by {r.reporter.name}
                    <span className="ml-auto text-xs text-ink-3">{formatDateTime(r.createdAt)}</span>
                  </p>
                  {r.comment && (
                    <>
                      <p className="mt-1 text-xs text-ink-3">
                        {r.comment.author.name} on{" "}
                        <Link href={`/article/${r.comment.article.slug}`} className="text-link">
                          {r.comment.article.title}
                        </Link>
                      </p>
                      <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-sm whitespace-pre-wrap text-ink">{r.comment.body}</p>
                      <div className="mt-3 flex flex-wrap gap-1">
                        <ActionButton action={hideComment} args={[r.comment.id]} className="btn btn-sm btn-secondary" pendingLabel="Hiding…">
                          Hide
                        </ActionButton>
                        <ActionButton
                          action={deleteComment}
                          args={[r.comment.id]}
                          className="btn btn-sm btn-ghost text-danger"
                          pendingLabel="Deleting…"
                          confirm="Delete this comment? The reader will not be told."
                        >
                          Delete
                        </ActionButton>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </PageBody>
    </main>
  );
}
