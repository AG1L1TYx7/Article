import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { classifyReferrer, countryFrom, deviceFrom } from "@/lib/analyticsCapture";
import { ReadingBeacon } from "@/components/articles/ReadingBeacon";
import { ReadingProgress } from "@/components/articles/ReadingProgress";
import { db } from "@/lib/db";
import { sanitizedArticleHtml } from "@/lib/sanitizeCache";
import { countArticleView } from "@/lib/viewCount";
import { ShareLinks } from "./ShareLinks";
import { CommentSection, parseCommentSort } from "@/components/comments/CommentSection";
import { RelatedLinks } from "@/components/articles/RelatedLinks";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { ArticleBody, ArticleCover, ArticleHeader, ArticleTags } from "@/components/articles/ArticleView";
import { ArticleEngagement } from "@/components/engagement/ArticleEngagement";
import { MediaCredits } from "@/components/articles/MediaCredits";
import { AudioPlayers } from "@/components/articles/AudioPlayers";
import { MEDIA_RIGHTS_SELECT, type ArticleMedia } from "@/lib/articleMedia";
import { allowsDownload, isoDuration, LICENSES } from "@/lib/mediaRights";
import { absoluteUrl } from "@/lib/siteUrl";
import { auth } from "@/lib/auth/config";
import { getBaseUrl } from "@/lib/url";
import { readingTime } from "@/lib/format";
import { getI18n } from "@/i18n/server";
import { OG_LOCALE, isLocale } from "@/i18n/config";
import { SITE_NAME } from "@/lib/siteUrl";

/**
 * An article counts as updated when it was edited a meaningful time after
 * it went live. Anything inside this window is the usual post-publish
 * tidy-up — a typo, a missing link — that readers do not need flagged.
 */
const UPDATED_AFTER_MS = 30 * 60 * 1000;

const TRANSLATION_SELECT = { slug: true, locale: true, status: true } as const;

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
      locale: true,
      publishedAt: true,
      updatedAt: true,
      seoTitle: true,
      seoDescription: true,
      categoryId: true,
      author: { select: { id: true, name: true, handle: true } },
      category: { select: { name: true, slug: true } },
      coverImage: { select: { url: true, altText: true, credit: true, sourceName: true, license: true } },
      // Every file the story uses, with its credit and licence — see
      // lib/articleMedia.ts. Linked when the article is saved.
      media: { select: MEDIA_RIGHTS_SELECT },
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
      // The same story in other languages: the original this one
      // translates (and its other translations), or this one's own
      // translations. Only published ones are ever offered.
      translationOf: {
        select: { ...TRANSLATION_SELECT, translations: { select: TRANSLATION_SELECT } },
      },
      translations: { select: TRANSLATION_SELECT },
    },
  })
);

type Article = NonNullable<Awaited<ReturnType<typeof getArticle>>>;

const toAbsolute = (url: string) => (url.startsWith("http") ? url : absoluteUrl(url));

/**
 * schema.org for the story and each of its files, with the licence and
 * credit on every one. This is how a search engine's image and video
 * results show "Licensable" and who to credit, and how a rights holder
 * finds the terms we claim without reading the page.
 */
function structuredData(article: Article, media: ArticleMedia[]) {
  const mediaObject = (m: ArticleMedia) => ({
    "@type": m.type === "IMAGE" ? "ImageObject" : m.type === "VIDEO" ? "VideoObject" : "AudioObject",
    contentUrl: toAbsolute(m.url),
    ...(m.type !== "IMAGE" ? { name: m.title ?? m.caption ?? article.title, uploadDate: article.publishedAt?.toISOString() } : {}),
    ...(m.caption ? { caption: m.caption, description: m.caption } : {}),
    ...(m.credit ? { creditText: m.credit, creator: { "@type": "Person", name: m.credit } } : {}),
    ...(m.sourceName ? { copyrightHolder: { "@type": "Organization", name: m.sourceName, ...(m.sourceUrl ? { url: m.sourceUrl } : {}) } } : {}),
    ...(m.license && LICENSES[m.license].url ? { license: LICENSES[m.license].url } : {}),
    ...(m.license === "OWN_WORK" ? { copyrightNotice: `© ${new Date().getUTCFullYear()} ${SITE_NAME}` } : {}),
    ...(m.durationSecs ? { duration: isoDuration(m.durationSecs) } : {}),
    ...(m.transcript ? { transcript: m.transcript } : {}),
    ...(m.width && m.height ? { width: m.width, height: m.height } : {}),
    encodingFormat: m.contentType,
  });
  const cover = media.find((m) => m.type === "IMAGE");
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: article.title,
    ...(article.dek ? { description: article.dek } : {}),
    datePublished: article.publishedAt?.toISOString(),
    dateModified: article.updatedAt.toISOString(),
    inLanguage: article.locale,
    mainEntityOfPage: absoluteUrl(`/article/${article.slug}`),
    author: { "@type": "Person", name: article.author.name, url: absoluteUrl(`/author/${article.author.handle}`) },
    publisher: { "@type": "Organization", name: SITE_NAME, url: absoluteUrl("/") },
    ...(cover ? { image: mediaObject(cover) } : {}),
    ...(media.some((m) => m.type === "VIDEO") ? { video: media.filter((m) => m.type === "VIDEO").map(mediaObject) } : {}),
    ...(media.some((m) => m.type === "AUDIO") ? { audio: media.filter((m) => m.type === "AUDIO").map(mediaObject) } : {}),
    associatedMedia: media.map(mediaObject),
  };
}

/** Every published version of the story other than this one, one per language. */
function otherVersions(article: Article): { slug: string; locale: string }[] {
  const candidates = [
    article.translationOf,
    ...(article.translationOf?.translations ?? []),
    ...article.translations,
  ];
  const seen = new Set<string>([article.locale]);
  const out: { slug: string; locale: string }[] = [];
  for (const c of candidates) {
    if (!c || c.status !== "PUBLISHED" || c.slug === article.slug) continue;
    if (!isLocale(c.locale) || seen.has(c.locale)) continue;
    seen.add(c.locale);
    out.push({ slug: c.slug, locale: c.locale });
  }
  return out;
}

export async function generateMetadata(props: PageProps<"/article/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const article = await getArticle(slug);
  if (!article) return {};

  const title = article.seoTitle || article.title;
  const description = article.seoDescription || article.excerpt || article.dek || undefined;
  const versions = otherVersions(article);

  return {
    title,
    description,
    alternates: {
      // Tells a search engine which URL is the real one. Without it, the
      // same article reached with a tracking parameter appended looks
      // like a separate, duplicate page.
      canonical: `/article/${article.slug}`,
      // hreflang: each language version points at every other, and at
      // itself, so a search engine shows a reader the right one.
      ...(versions.length > 0
        ? {
            languages: Object.fromEntries([
              [article.locale, `/article/${article.slug}`],
              ...versions.map((v) => [v.locale, `/article/${v.slug}`]),
            ]),
          }
        : {}),
    },
    openGraph: {
      title,
      description,
      type: "article",
      url: `/article/${article.slug}`,
      locale: isLocale(article.locale) ? OG_LOCALE[article.locale] : undefined,
      alternateLocale: versions.map((v) => OG_LOCALE[v.locale as keyof typeof OG_LOCALE]),
      publishedTime: article.publishedAt?.toISOString(),
      modifiedTime: article.updatedAt.toISOString(),
      section: article.category?.name,
      authors: [article.author.name],
      // Share cards can carry the story's audio and video directly.
      audio: article.media.filter((m) => m.type === "AUDIO").map((m) => ({ url: toAbsolute(m.url), type: m.contentType })),
      videos: article.media
        .filter((m) => m.type === "VIDEO")
        .map((m) => ({ url: toAbsolute(m.url), type: m.contentType, width: m.width ?? undefined, height: m.height ?? undefined })),
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function ArticlePage(props: PageProps<"/article/[slug]">) {
  const { slug } = await props.params;
  const article = await getArticle(slug);
  if (!article) notFound();

  const { t } = await getI18n();
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
        locale: true,
        author: { select: { name: true, handle: true } },
        category: { select: { name: true, slug: true } },
        coverImage: { select: { url: true, altText: true } },
      },
    }),
  ]);

  const shareUrl = `${await getBaseUrl()}/article/${article.slug}`;
  const media = article.media as ArticleMedia[];
  const audioItems = media
    .filter((m) => m.type === "AUDIO")
    .map((m) => ({
      id: m.id,
      title: m.title,
      downloadUrl: allowsDownload(m.license) ? `${m.url}?download=1` : null,
      durationSecs: m.durationSecs,
    }));

  return (
    <main id="main-content" className="pb-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData(article, media)) }} />
      <ReadingProgress />
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
          locale={article.locale}
          translations={otherVersions(article)}
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

          <ArticleBody html={safeHtml} lang={article.locale} />
          {audioItems.length > 0 && <AudioPlayers items={audioItems} scope=".prose-article" />}

          <ArticleTags tags={article.tags.map((t) => t.tag)} />

          <RelatedLinks links={article.links} />

          <MediaCredits media={media} />

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
            {article.category ? t("article.moreFrom", { section: article.category.name }) : t("article.moreStories")}
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
