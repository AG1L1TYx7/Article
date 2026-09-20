import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth/config";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ArticleForm } from "../ArticleForm";
import { updateArticle } from "../actions";
import { ArticleLinks } from "@/components/articles/ArticleLinks";
import { PageBody, PageHeader } from "../../../PageHeader";
import { StatusPill } from "../StatusPill";
import { ExternalIcon } from "@/components/icons";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Edit article", robots: { index: false, follow: false } };

export default async function EditArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;
  const article = await db.article.findUnique({
    where: { id },
    include: {
      tags: { include: { tag: true } },
      links: { orderBy: { createdAt: "asc" } },
      coverImage: { select: { id: true, url: true, altText: true } },
    },
  });
  if (!article) notFound();

  const canEdit = session.user.role === "ADMIN" || article.authorId === session.user.id;
  if (!canEdit) redirect("/dashboard/articles");

  const categories = await db.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });

  return (
    <main id="main-content">
      <PageHeader
        kicker="Articles"
        title="Edit article"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill status={article.status} />
            <span>
              {article.status === "PUBLISHED" && article.publishedAt
                ? `Published ${formatDate(article.publishedAt)} · `
                : ""}
              last saved {formatDate(article.updatedAt)}
            </span>
          </span>
        }
        actions={
          <>
            {article.status === "PUBLISHED" && (
              <a
                href={`/article/${article.slug}`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary gap-1.5"
              >
                <ExternalIcon size={14} /> View live
              </a>
            )}
            <Link href="/dashboard/articles" className="btn btn-ghost">
              Back to list
            </Link>
          </>
        }
      />
      <PageBody>
        <ArticleForm
          categories={categories}
          initial={{
            title: article.title,
            dek: article.dek ?? "",
            slug: article.slug,
            excerpt: article.excerpt ?? "",
            categoryId: article.categoryId ?? "",
            tagSlugs: article.tags.map((t) => t.tag.slug).join(", "),
            isBreaking: article.isBreaking,
            bodyJson: article.bodyJson as object,
            bodyHtml: article.bodyHtml,
            coverImage: article.coverImage,
          }}
          // A plain arrow function closing over article.id can't cross the
          // server/client boundary — only an actual Server Action, or one
          // curried with .bind(), can be passed as a prop to a Client
          // Component. (Caught by an e2e test: the edit page 500'd with
          // "Functions cannot be passed directly to Client Components".)
          action={updateArticle.bind(null, article.id)}
        />

        <ArticleLinks
          articleId={article.id}
          links={article.links.map((link) => ({
            id: link.id,
            url: link.url,
            label: link.label,
            title: link.title,
            description: link.description,
            siteName: link.siteName,
            fetchedAt: link.fetchedAt?.toISOString() ?? null,
          }))}
        />
      </PageBody>
    </main>
  );
}
