import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { withDatabaseFallback } from "@/lib/buildSafe";
import { absoluteUrl } from "@/lib/siteUrl";

// A sitemap file may hold at most 50,000 URLs. Well under it, and bounded
// so this query can never become the slowest thing on the site.
const MAX_ARTICLES = 10_000;

// Generated on every request, like every other route on this site, so a
// newly published article is in the sitemap the moment a crawler asks.
// Three small indexed queries per fetch; crawlers fetch this a few times
// a day, not a few times a second.
export const dynamic = "force-dynamic";

/**
 * Tells search engines what exists and when it last changed.
 *
 * Only published work. Drafts, scheduled and archived articles are not
 * public, and listing a URL here that returns 404 is actively harmful —
 * it is a direct signal to a crawler that the site is unreliable.
 *
 * Deliberately absent: /search (infinite thin pages, already noindex),
 * /dashboard, /saved and /notifications (all require a session).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [articles, categories, authors, tags] = await Promise.all([
    withDatabaseFallback(
      () =>
        db.article.findMany({
          where: { status: "PUBLISHED", publishedAt: { not: null } },
          orderBy: { publishedAt: "desc" },
          take: MAX_ARTICLES,
          select: { slug: true, updatedAt: true, publishedAt: true },
        }),
      [],
      "sitemap articles"
    ),
    withDatabaseFallback(
      () =>
        db.category.findMany({
          where: { articles: { some: { status: "PUBLISHED" } } },
          select: { slug: true },
        }),
      [],
      "sitemap categories"
    ),
    withDatabaseFallback(
      () =>
        db.user.findMany({
          // Matches who actually has a public author page: staff with
          // published work. A reader's page is a 404.
          where: {
            role: { in: ["MODERATOR", "ADMIN"] },
            articles: { some: { status: "PUBLISHED" } },
          },
          select: { handle: true },
        }),
      [],
      "sitemap authors"
    ),
    withDatabaseFallback(
      () =>
        db.tag.findMany({
          where: { articles: { some: { article: { status: "PUBLISHED" } } } },
          select: { slug: true },
        }),
      [],
      "sitemap tags"
    ),
  ]);

  const newest = articles[0]?.publishedAt ?? new Date();

  return [
    {
      url: absoluteUrl("/"),
      lastModified: newest,
      changeFrequency: "hourly",
      priority: 1,
    },
    ...categories.map((category) => ({
      url: absoluteUrl(`/category/${category.slug}`),
      lastModified: newest,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    ...authors.map((author) => ({
      url: absoluteUrl(`/author/${author.handle}`),
      lastModified: newest,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
    ...tags.map((tag) => ({
      url: absoluteUrl(`/tag/${tag.slug}`),
      lastModified: newest,
      changeFrequency: "weekly" as const,
      priority: 0.4,
    })),
    ...articles.map((article) => ({
      url: absoluteUrl(`/article/${article.slug}`),
      // updatedAt, not publishedAt: a crawler wants to know when the
      // content last changed, so a corrected story gets recrawled.
      lastModified: article.updatedAt,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
