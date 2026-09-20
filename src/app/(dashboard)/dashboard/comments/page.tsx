import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { approveComment, hideComment, deleteComment, suspendCommenter } from "./actions";
import { PageBody, PageHeader } from "../../PageHeader";
import { FlagIcon } from "@/components/icons";
import { formatDateTime, initials } from "@/lib/format";

export const metadata: Metadata = { title: "Comment moderation", robots: { index: false, follow: false } };

export default async function CommentModerationPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [pending, reported] = await Promise.all([
    db.comment.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      include: { author: { select: { id: true, name: true, email: true } }, article: { select: { title: true, slug: true } } },
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

  return (
    <main id="main-content">
      <PageHeader
        kicker="Community"
        title="Comment moderation"
        description="New accounts and anything the spam heuristics flag land here before they appear publicly."
      />

      <PageBody narrow>
        <section aria-labelledby="pending-heading">
          <h2 id="pending-heading" className="section-title">
            Awaiting review ({pending.length})
          </h2>
          {pending.length === 0 && (
            <p className="card mt-4 px-4 py-8 text-center text-sm text-ink-3">Nothing waiting.</p>
          )}
          <ul className="mt-4 flex flex-col gap-3">
            {pending.map((c) => (
              <li key={c.id} className="card p-4">
                <div className="flex items-start gap-3">
                  <span className="avatar h-9 w-9 text-xs">{initials(c.author.name)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <strong>{c.author.name}</strong>{" "}
                      <span className="text-ink-3">on</span>{" "}
                      <Link href={`/article/${c.article.slug}`} className="text-link">{c.article.title}</Link>
                    </p>
                    <p className="text-xs text-ink-3">
                      {c.author.email} · {formatDateTime(c.createdAt)}
                    </p>
                  </div>
                </div>
                <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-sm whitespace-pre-wrap text-ink">{c.body}</p>
                <div className="mt-3 flex flex-wrap gap-1">
                  <form action={async () => { "use server"; await approveComment(c.id); }}>
                    <button className="btn btn-sm btn-primary">Approve</button>
                  </form>
                  <form action={async () => { "use server"; await hideComment(c.id); }}>
                    <button className="btn btn-sm btn-ghost">Hide</button>
                  </form>
                  <form action={async () => { "use server"; await deleteComment(c.id); }}>
                    <button className="btn btn-sm btn-ghost text-danger">Delete</button>
                  </form>
                  <form action={async () => { "use server"; await suspendCommenter(c.author.id); }} className="ml-auto">
                    <button className="btn btn-sm btn-danger">Suspend author</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="reported-heading" className="mt-12">
          <h2 id="reported-heading" className="section-title">
            Reported by readers ({reported.length})
          </h2>
          {reported.length === 0 && (
            <p className="card mt-4 px-4 py-8 text-center text-sm text-ink-3">No open reports.</p>
          )}
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
                      <form action={async () => { "use server"; await hideComment(r.comment!.id); }}>
                        <button className="btn btn-sm btn-secondary">Hide</button>
                      </form>
                      <form action={async () => { "use server"; await deleteComment(r.comment!.id); }}>
                        <button className="btn btn-sm btn-ghost text-danger">Delete</button>
                      </form>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      </PageBody>
    </main>
  );
}
