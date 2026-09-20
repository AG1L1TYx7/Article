import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { db } from "@/lib/db";
import { sanitizedArticleHtml } from "@/lib/sanitizeCache";
import { countArticleView } from "@/lib/viewCount";
import { ShareLinks } from "./ShareLinks";
import { CommentSection, parseCommentSort } from "@/components/comments/CommentSection";
import { RelatedLinks } from "@/components/articles/RelatedLinks";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { ArticleEngagement } from "@/components/engagement/ArticleEngagement";
import { TagIcon } from "@/components/icons";
import { auth } from "@/lib/auth/config";
import { getBaseUrl } from "@/lib/url";
import { formatDate, initials, readingTime } from "@/lib/format";
import { imageSrcSet, imageVariantUrl } from "@/lib/imageUrl";

/**
 * An article counts as updated when it was edited a meaningful time after
 * it went live. Anything inside this window is the usual post-publish
 * tidy-up — a typo, a missing link — that readers do not need flagged.
 */
const UPDATED_AFTER_MS = 30 * 60 * 1000;

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
      categoryId: true,
      author: { select: { id: true, name: true, handle: true } },
      category: { select: { name: true, slug: true } },
      coverImage: { select: { url: true, altText: true } },
      tags: { select: { tag: { select: { slug: true, name: true } } } },
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

  const search = await props.searchParams;
  const commentSort = parseCommentSort(search.comments);
  const showAllComments = search.all === "1";

  const updatedAfterPublish =
    article.publishedAt && article.updatedAt.getTime() - article.publishedAt.getTime() > UPDATED_AFTER_MS
      ? article.updatedAt
      : null;

  // Still sanitized at render time — defense in depth, per the security
  // blueprint — but memoised per article revision so every visitor to the
  // same article isn't re-parsing the same 20KB. See lib/sanitizeCache.ts.
  // Scheduled for after the response is sent, so the reader never waits
  // on the write. See lib/viewCount.ts.
  countArticleView(article.id);

  const safeHtml = sanitizedArticleHtml(article.id, article.updatedAt, article.bodyHtml);
  const minutes = readingTime(article.bodyHtml);

  // The viewer's own like/save/follow state. Counted once here rather
  // than inside the client component so the first paint is already
  // correct instead of flickering in after hydration.
  const session = await auth();
  const viewerId = session?.user?.id;
  const [likeCount, liked, bookmarked, followingAuthor, moreFromSection] = await Promise.all([
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
    // Three more from the same section, or the latest three when the
    // article has none — so the bottom of a story is never a dead end.
    db.article.findMany({
      where: {
        status: "PUBLISHED",
        id: { not: article.id },
        ...(article.categoryId ? { categoryId: article.categoryId } : {}),
      },
      orderBy: { publishedAt: "desc" },
      take: 3,
      select: {
        id: true,
        slug: true,
        title: true,
        dek: true,
        isBreaking: true,
        publishedAt: true,
        author: { select: { name: true, handle: true } },
        category: { select: { name: true, slug: true } },
        coverImage: { select: { url: true, altText: true } },
      },
    }),
  ]);

  const shareUrl = `${await getBaseUrl()}/article/${article.slug}`;

  return (
    <main id="main-content" className="pb-16">
      <article>
        {/* Headline block */}
        <header className="mx-auto max-w-3xl px-4 pt-10 sm:px-6 sm:pt-14">
          <div className="flex items-center gap-2">
            {article.isBreaking && <span className="badge-breaking">Breaking</span>}
            {article.category && (
              <Link href={`/category/${article.category.slug}`} className="eyebrow hover:underline">
                {article.category.name}
              </Link>
            )}
          </div>
          <h1 className="headline mt-4 text-[36px] leading-[1.06] sm:text-[52px]">{article.title}</h1>
          {article.dek && (
            <p className="mt-5 font-serif text-xl leading-snug text-ink-2 sm:text-2xl">{article.dek}</p>
          )}

          <div className="mt-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border-y border-line py-4">
            <div className="flex items-center gap-3">
              <span className="avatar h-10 w-10 text-sm">{initials(article.author.name)}</span>
              <div className="text-sm">
                <p>
                  <span className="text-ink-3">By </span>
                  <Link href={`/author/${article.author.handle}`} className="font-medium text-ink hover:underline">
                    {article.author.name}
                  </Link>
                </p>
                <p className="text-xs text-ink-3">
                  {article.publishedAt && (
                    <time dateTime={article.publishedAt.toISOString()}>{formatDate(article.publishedAt)}</time>
                  )}
                  <span aria-hidden="true"> · </span>
                  {minutes} min read
                  {updatedAfterPublish && (
                    <>
                      <span aria-hidden="true"> · </span>
                      <span className="text-ink-2">
                        Updated <time dateTime={updatedAfterPublish.toISOString()}>{formatDate(updatedAfterPublish)}</time>
                      </span>
                    </>
                  )}
                </p>
              </div>
            </div>
            <ShareLinks title={article.title} url={shareUrl} />
          </div>
        </header>

        {article.coverImage && (
          <figure className="mx-auto mt-8 max-w-5xl px-4 sm:px-6">
            {/* eslint-disable-next-line @next/next/no-img-element -- served from this site's own media route or object storage */}
            <img
              src={imageVariantUrl(article.coverImage.url, 1200)}
              srcSet={imageSrcSet(article.coverImage.url)}
              sizes="(min-width: 1024px) 960px, 100vw"
              alt={article.coverImage.altText ?? ""}
              className="aspect-[16/9] w-full rounded-lg bg-surface-2 object-cover"
              loading="eager"
              decoding="async"
            />
            {article.coverImage.altText && (
              <figcaption className="mt-2 text-xs text-ink-3">{article.coverImage.altText}</figcaption>
            )}
          </figure>
        )}

        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="mt-8">
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
          </div>

          {/* The one dangerouslySetInnerHTML in the codebase — sanitized on
              save and again just above at render time. See lib/sanitize.ts. */}
          <div
            className="prose prose-article mt-10 max-w-none"
            dangerouslySetInnerHTML={{ __html: safeHtml }}
          />

          {article.tags.length > 0 && (
            <ul className="mt-10 flex flex-wrap items-center gap-2" aria-label="Tags">
              <li className="flex items-center gap-1 text-xs font-medium tracking-wide text-ink-3 uppercase">
                <TagIcon size={12} /> Tagged
              </li>
              {article.tags.map(({ tag }) => (
                <li key={tag.slug}>
                  <Link href={`/tag/${tag.slug}`} className="btn btn-secondary btn-sm rounded-full">
                    {tag.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <RelatedLinks links={article.links} />

          <CommentSection
            articleId={article.id}
            articlePath={`/article/${article.slug}`}
            sort={commentSort}
            showAll={showAllComments}
          />
        </div>
      </article>

      {moreFromSection.length > 0 && (
        <section aria-labelledby="more-heading" className="mx-auto mt-16 max-w-6xl px-4 sm:px-6">
          <h2 id="more-heading" className="section-title">
            {article.category ? `More from ${article.category.name}` : "More stories"}
          </h2>
          <ul className="mt-6 grid gap-8 md:grid-cols-3">
            {moreFromSection.map((item) => (
              <ArticleCard key={item.id} article={item} variant="featured" hideCategory={!!article.category} />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
