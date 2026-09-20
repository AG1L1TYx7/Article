import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { publishArticle, unpublishArticle, archiveArticle } from "./actions";
import { PageBody, PageHeader } from "../../PageHeader";
import { StatusPill } from "./StatusPill";
import { ActionButton } from "@/components/ActionButton";
import { PlusIcon } from "@/components/icons";
import { formatDate, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Articles", robots: { index: false, follow: false } };

export default async function ArticlesListPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const isAdmin = session.user.role === "ADMIN";
  // Publishing requires a confirmed email address (see publishArticle in
  // ./actions.ts). Surface that here instead of letting the button look
  // live and then quietly do nothing.
  const canPublish = session.user.emailConfirmed;
  const articles = await db.article.findMany({
    where: isAdmin ? {} : { authorId: session.user.id },
    orderBy: { updatedAt: "desc" },
    // Card fields only — see the note on the homepage query.
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      updatedAt: true,
      publishedAt: true,
      scheduledFor: true,
      viewCount: true,
      author: { select: { name: true } },
      category: { select: { name: true } },
    },
  });

  const counts = {
    published: articles.filter((a) => a.status === "PUBLISHED").length,
    drafts: articles.filter((a) => a.status === "DRAFT").length,
    archived: articles.filter((a) => a.status === "ARCHIVED").length,
  };

  return (
    <main id="main-content">
      <PageHeader
        kicker="Newsroom"
        title="Articles"
        description={`${counts.published} published · ${counts.drafts} drafts · ${counts.archived} archived`}
        actions={
          <Link href="/dashboard/articles/new" className="btn btn-primary gap-1.5">
            <PlusIcon size={16} /> New article
          </Link>
        }
      />

      <PageBody>
        {!canPublish && (
          <p className="alert alert-warn mb-6">
            Verify your email address to publish. You can still write and edit drafts.
          </p>
        )}

        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="pl-4">Title</th>
                {isAdmin && <th>Author</th>}
                <th>Status</th>
                <th>Updated</th>
                <th className="text-right">Views</th>
                <th className="pr-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {articles.map((article) => (
                <tr key={article.id} className="group hover:bg-surface-2/60">
                  <td className="pl-4">
                    <Link href={`/dashboard/articles/${article.id}`} className="font-medium hover:underline">
                      {article.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-ink-3">
                      {article.category?.name ?? "No section"}
                      {article.status === "PUBLISHED" && (
                        <>
                          {" · "}
                          <a
                            href={`/article/${article.slug}`}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-ink hover:underline"
                          >
                            View live
                          </a>
                        </>
                      )}
                    </p>
                  </td>
                  {isAdmin && <td className="text-ink-2">{article.author.name}</td>}
                  <td>
                    <StatusPill status={article.status} />
                  </td>
                  <td className="text-ink-2 whitespace-nowrap">
                    {formatDate(article.updatedAt)}
                    {article.status === "SCHEDULED" && article.scheduledFor && (
                      <span className="block text-xs text-warn">
                        goes live {formatDateTime(article.scheduledFor)}
                      </span>
                    )}
                  </td>
                  <td className="text-right text-ink-2 tabular-nums">{article.viewCount.toLocaleString("en-GB")}</td>
                  <td className="pr-4">
                    <div className="flex items-start justify-end gap-1">
                      {article.status !== "PUBLISHED" ? (
                        <ActionButton
                          action={publishArticle}
                          args={[article.id]}
                          disabled={!canPublish}
                          title={canPublish ? undefined : "Verify your email address to publish"}
                          className="btn btn-sm btn-secondary text-ok disabled:text-ink-3"
                          pendingLabel="Publishing…"
                        >
                          {article.status === "SCHEDULED" ? "Publish now" : "Publish"}
                        </ActionButton>
                      ) : (
                        <ActionButton
                          action={unpublishArticle}
                          args={[article.id]}
                          className="btn btn-sm btn-ghost"
                          pendingLabel="Unpublishing…"
                          confirm="Take this article off the site? It goes back to being a draft and its address will stop working until it is published again."
                        >
                          Unpublish
                        </ActionButton>
                      )}
                      {article.status !== "ARCHIVED" && (
                        <ActionButton
                          action={archiveArticle}
                          args={[article.id]}
                          className="btn btn-sm btn-ghost text-danger"
                          pendingLabel="Archiving…"
                          confirm={`Archive "${article.title}"? It leaves the site and the articles list keeps it for the record.`}
                        >
                          Archive
                        </ActionButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {articles.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 6 : 5} className="py-12 text-center text-ink-3">
                    No articles yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </PageBody>
    </main>
  );
}
