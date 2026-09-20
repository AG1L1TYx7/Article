import { auth } from "@/lib/auth/config";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ArticleForm } from "../ArticleForm";
import { updateArticle } from "../actions";
import { ArticleLinks } from "@/components/articles/ArticleLinks";

export default async function EditArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;
  const article = await db.article.findUnique({
    where: { id },
    include: {
      tags: { include: { tag: true } },
      links: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!article) notFound();

  const canEdit = session.user.role === "ADMIN" || article.authorId === session.user.id;
  if (!canEdit) redirect("/dashboard/articles");

  const categories = await db.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="mb-6 text-2xl font-semibold">Edit article</h1>
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
    </main>
  );
}
