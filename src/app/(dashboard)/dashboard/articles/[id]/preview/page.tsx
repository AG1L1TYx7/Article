import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { sanitizeArticleHtml } from "@/lib/sanitize";
import { readingTime } from "@/lib/format";
import { ArticleBody, ArticleCover, ArticleHeader, ArticleTags } from "@/components/articles/ArticleView";
import { RelatedLinks } from "@/components/articles/RelatedLinks";
import { MediaCredits } from "@/components/articles/MediaCredits";
import { ReferencesList } from "@/components/articles/ReferencesList";
import { AudioPlayers } from "@/components/articles/AudioPlayers";
import { mediaReferencedBy } from "@/lib/articleMedia";
import { allowsDownload } from "@/lib/mediaRights";
import { StatusPill } from "../../StatusPill";

export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false } };

/**
 * A draft, rendered exactly as the public article page renders a
 * published one — same components, same styles — for the author to read
 * before it goes live. Staff only, and only the author or an admin; a
 * draft is not public just because someone has its id.
 */
export default async function ArticlePreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;
  const article = await db.article.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      title: true,
      dek: true,
      bodyHtml: true,
      status: true,
      isBreaking: true,
      anonymous: true,
      publishedAt: true,
      scheduledFor: true,
      authorId: true,
      author: { select: { name: true, handle: true } },
      category: { select: { name: true, slug: true } },
      coverImageId: true,
      references: {
        orderBy: { position: "asc" },
        select: { id: true, position: true, title: true, author: true, publication: true, url: true, publishedOn: true, note: true },
      },
      coverImage: { select: { url: true, altText: true, credit: true, sourceName: true, license: true } },
      tags: { select: { tag: { select: { slug: true, name: true } } } },
      links: {
        orderBy: { createdAt: "asc" },
        select: { id: true, url: true, label: true, title: true, description: true, siteName: true },
      },
    },
  });
  if (!article) notFound();
  if (session.user.role !== "ADMIN" && article.authorId !== session.user.id) redirect("/dashboard/articles");

  // Resolved from the body rather than the saved relation, so a file
  // added a moment ago and not yet saved still shows its credit here.
  const media = await mediaReferencedBy(article.bodyHtml, article.coverImageId);
  const audioItems = media
    .filter((m) => m.type === "AUDIO")
    .map((m) => ({ id: m.id, title: m.title, downloadUrl: allowsDownload(m.license) ? `${m.url}?download=1` : null, durationSecs: m.durationSecs }));

  return (
    <main id="main-content" className="pb-16">
      <div className="sticky top-0 z-30 border-b border-warn/30 bg-warn-soft">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-2 text-sm text-warn sm:px-6">
          <StatusPill status={article.status} />
          <span>
            Preview — this is how the article will read. Only you and other staff can see this page.
          </span>
          <span className="ml-auto flex gap-2">
            <Link href={`/dashboard/articles/${article.id}`} className="btn btn-sm btn-secondary">
              Back to editing
            </Link>
            {article.status === "PUBLISHED" && (
              <a href={`/article/${article.slug}`} className="btn btn-sm btn-primary">
                View live
              </a>
            )}
          </span>
        </div>
      </div>

      <article>
        <ArticleHeader
          title={article.title || "Untitled"}
          dek={article.dek}
          isBreaking={article.isBreaking}
          category={article.category}
          author={article.author}
          anonymous={article.anonymous}
          publishedAt={article.publishedAt ?? article.scheduledFor}
          minutes={readingTime(article.bodyHtml)}
        />
        <ArticleCover image={article.coverImage} />
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          {/* Sanitised here, directly: the per-revision cache is for the
              public page, and a preview must always show the latest save. */}
          <ArticleBody html={sanitizeArticleHtml(article.bodyHtml)} />
          {audioItems.length > 0 && <AudioPlayers items={audioItems} scope=".prose-article" />}
          <ArticleTags tags={article.tags.map((t) => t.tag)} />
          <ReferencesList references={article.references} />

          <RelatedLinks links={article.links} />

          <MediaCredits media={media} />
        </div>
      </article>
    </main>
  );
}
