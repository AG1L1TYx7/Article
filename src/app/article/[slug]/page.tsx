import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { db } from "@/lib/db";
import { sanitizedArticleHtml } from "@/lib/sanitizeCache";
import { ShareLinks } from "./ShareLinks";
import { CommentSection } from "@/components/comments/CommentSection";
import { RelatedLinks } from "@/components/articles/RelatedLinks";
import { ArticleEngagement } from "@/components/engagement/ArticleEngagement";
import { auth } from "@/lib/auth/config";
import { getBaseUrl } from "@/lib/url";

// Wrapped in React's cache() because generateMetadata and the page
// component both need the article: without it every article view runs the
// same query twice. Next.js dedupes fetch() automatically but knows
// nothing about Prisma calls.
const getArticle = cache(async (slug: string) =>
  db.article.findFirst({
    where: { slug, status: "PUBLISHED" },
    // bodyJson is deliberately absent: it's the editor's source of
    // truth and is never needed to render a published article, but it's
    // the single largest column on the row.
    select: {
      id: true,
      slug: true,
      title: true,
      dek: true,
      bodyHtml: true,
      excerpt: true,
      isBreaking: true,
      publishedAt: true,
      updatedAt: true,
      seoTitle: true,
      seoDescription: true,
      author: { select: { id: true, name: true, handle: true } },
      category: { select: { name: true, slug: true } },
      links: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          url: true,
          label: true,
          title: true,
          description: true,
          siteName: true,
        },
      },
    },
  })
);

export async function generateMetadata(props: PageProps<"/article/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const article = await getArticle(slug);
  if (!article) return {};

  const title = article.seoTitle || article.title;
  const description = article.seoDescription || article.excerpt || article.dek || undefined;

  return {
    title,
    description,
    // Tells a search engine which URL is the real one. Without it, the
    // same article reached with a tracking parameter appended looks like
    // a separate, duplicate page.
    alternates: { canonical: `/article/${article.slug}` },
    openGraph: {
      title,
      description,
      type: "article",
      url: `/article/${article.slug}`,
      publishedTime: article.publishedAt?.toISOString(),
      modifiedTime: article.updatedAt.toISOString(),
      section: article.category?.name,
      authors: [article.author.name],
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function ArticlePage(props: PageProps<"/article/[slug]">) {
  const { slug } = await props.params;
  const article = await getArticle(slug);
  if (!article) notFound();

  // Still sanitized at render time — defense in depth, per the security
  // blueprint — but memoised per article revision so every visitor to the
  // same article isn't re-parsing the same 20KB. See lib/sanitizeCache.ts.
  const safeHtml = sanitizedArticleHtml(article.id, article.updatedAt, article.bodyHtml);

  // The viewer's own like/save/follow state. Counted once here rather
  // than inside the client component so the first paint is already
  // correct instead of flickering in after hydration.
  const session = await auth();
  const viewerId = session?.user?.id;
  const [likeCount, liked, bookmarked, followingAuthor] = await Promise.all([
    db.reaction.count({ where: { articleId: article.id } }),
    viewerId
      ? db.reaction.findFirst({ where: { userId: viewerId, articleId: article.id }, select: { id: true } })
      : null,
    viewerId
      ? db.bookmark.findFirst({ where: { userId: viewerId, articleId: article.id }, select: { id: true } })
      : null,
    viewerId
      ? db.follow.findFirst({ where: { followerId: viewerId, authorId: article.author.id }, select: { id: true } })
      : null,
  ]);

  return (
    <article className="mx-auto max-w-2xl px-6 py-16">
      {article.isBreaking && (
        <span className="mb-2 inline-block rounded bg-red-700 px-2 py-0.5 text-xs font-semibold text-white">
          BREAKING
        </span>
      )}
      {article.category && (
        <p className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
          <Link href={`/category/${article.category.slug}`} className="hover:underline">
            {article.category.name}
          </Link>
        </p>
      )}
      <h1 className="mt-1 text-3xl font-semibold">{article.title}</h1>
      {article.dek && <p className="mt-2 text-lg text-neutral-600">{article.dek}</p>}
      <p className="mt-3 text-sm text-neutral-500">
        <Link href={`/author/${article.author.handle}`} className="hover:underline">
          {article.author.name}
        </Link>{" "}
        · {article.publishedAt?.toLocaleDateString()}
      </p>

      <ShareLinks title={article.title} url={`${await getBaseUrl()}/article/${article.slug}`} />

      <ArticleEngagement
        articleId={article.id}
        authorId={article.author.id}
        authorName={article.author.name}
        signedIn={!!viewerId}
        liked={!!liked}
        likeCount={likeCount}
        bookmarked={!!bookmarked}
        followingAuthor={!!followingAuthor}
        isOwnArticle={viewerId === article.author.id}
      />

      {/* The one dangerouslySetInnerHTML in the codebase — sanitized on
          save and again just above at render time. See lib/sanitize.ts. */}
      <div className="prose prose-neutral mt-8 max-w-none" dangerouslySetInnerHTML={{ __html: safeHtml }} />

      <RelatedLinks links={article.links} />

      <CommentSection articleId={article.id} />
    </article>
  );
}
