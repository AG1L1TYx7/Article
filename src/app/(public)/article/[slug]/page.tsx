import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { classifyReferrer, countryFrom, deviceFrom } from "@/lib/analyticsCapture";
import { ReadingBeacon } from "@/components/articles/ReadingBeacon";
import { db } from "@/lib/db";
import { sanitizedArticleHtml } from "@/lib/sanitizeCache";
import { countArticleView } from "@/lib/viewCount";
import { ShareLinks } from "./ShareLinks";
import { CommentSection, parseCommentSort } from "@/components/comments/CommentSection";
import { RelatedLinks } from "@/components/articles/RelatedLinks";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { ArticleBody, ArticleCover, ArticleHeader, ArticleTags } from "@/components/articles/ArticleView";
import { ArticleEngagement } from "@/components/engagement/ArticleEngagement";
import { auth } from "@/lib/auth/config";
import { getBaseUrl } from "@/lib/url";
import { readingTime } from "@/lib/format";

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
  // on the write. See lib/viewCount.ts. The context is derived from the
  // request headers and reduced to coarse classes before it is counted —
  // country code, referrer class, device class — never the IP or the UA
  // itself. See lib/analyticsCapture.ts.
  const h = await headers();
  countArticleView(article.id, {
    country: countryFrom((name) => h.get(name)),
    referrer: classifyReferrer(h.get("referer"), h.get("x-forwarded-host") ?? h.get("host") ?? ""),
    device: deviceFrom(h.get("user-agent")),
  });

  const safeHtml = sanitizedArticleHtml(article.id, article.updatedAt, article.bodyHtml);

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
      <ReadingBeacon articleId={article.id} />
      <article>
        <ArticleHeader
          title={article.title}
          dek={article.dek}
          isBreaking={article.isBreaking}
          category={article.category}
          author={article.author}
          publishedAt={article.publishedAt}
          updatedAt={updatedAfterPublish}
          minutes={readingTime(article.bodyHtml)}
          aside={<ShareLinks title={article.title} url={shareUrl} />}
        />

        <ArticleCover image={article.coverImage} />

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

          <ArticleBody html={safeHtml} />

          <ArticleTags tags={article.tags.map((t) => t.tag)} />

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
