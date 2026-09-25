import { db } from "@/lib/db";
import { withDatabaseFallback } from "@/lib/buildSafe";
import { buildRssFeed } from "@/lib/feed";
import { absoluteUrl } from "@/lib/siteUrl";

// Built fresh on every request, like every other route on this site, so
// a story is in the feed the second it is published. The query behind it
// is one indexed SELECT of fifty rows; a feed reader polling every few
// minutes is not a load worth caching for.
export const dynamic = "force-dynamic";

const FEED_LENGTH = 50;

export async function GET() {
  const articles = await withDatabaseFallback(
    () =>
      db.article.findMany({
        // Published only. A feed is a public artifact, and a draft
        // appearing in one is unrecoverable — subscribers have already
        // downloaded it.
        where: { status: "PUBLISHED", publishedAt: { not: null } },
        orderBy: { publishedAt: "desc" },
        take: FEED_LENGTH,
        select: {
          slug: true,
          title: true,
          dek: true,
          excerpt: true,
          publishedAt: true,
          anonymous: true,
          author: { select: { name: true } },
          category: { select: { name: true } },
          media: { where: { type: "AUDIO" }, take: 1, select: { url: true, sizeBytes: true, contentType: true } },
        },
      }),
    [],
    "rss feed"
  );

  const xml = buildRssFeed(
    articles.map((article) => ({
      slug: article.slug,
      title: article.title,
      summary: article.dek ?? article.excerpt,
      publishedAt: article.publishedAt,
      authorName: article.anonymous ? "Anonymous" : article.author.name,
      categoryName: article.category?.name ?? null,
      enclosure: article.media[0]
        ? {
            url: article.media[0].url.startsWith("http") ? article.media[0].url : absoluteUrl(article.media[0].url),
            length: article.media[0].sizeBytes ?? 0,
            type: article.media[0].contentType,
          }
        : null,
    }))
  );

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=900, s-maxage=900",
    },
  });
}
