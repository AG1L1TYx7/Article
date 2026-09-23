import { db } from "@/lib/db";

/**
 * The personalised feed: everything published by the writers a reader
 * follows and in the sections they follow, newest first.
 *
 * Deliberately not a recommendation engine. The reader chose every source
 * in this list themselves, so there is nothing to explain and nothing to
 * opt out of — which is also what keeps it out of GDPR's profiling rules.
 * The only ranking is time.
 */

export const FEED_CARD_SELECT = {
  id: true,
  slug: true,
  title: true,
  dek: true,
  isBreaking: true,
  publishedAt: true,
  locale: true,
  anonymous: true,
  author: { select: { name: true, handle: true } },
  category: { select: { name: true, slug: true } },
  coverImage: { select: { url: true, altText: true } },
} as const;

export interface FollowedSources {
  authors: { id: string; name: string; handle: string }[];
  categories: { id: string; name: string; slug: string }[];
}

export async function followedSources(userId: string): Promise<FollowedSources> {
  const follows = await db.follow.findMany({
    where: { followerId: userId },
    select: {
      author: { select: { id: true, name: true, handle: true, status: true } },
      category: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return {
    // A suspended writer's page is gone, so their stories leave the feed too.
    authors: follows.flatMap((f) => (f.author && f.author.status === "ACTIVE" ? [f.author] : [])),
    categories: follows.flatMap((f) => (f.category ? [f.category] : [])),
  };
}

export async function followingFeed(
  sources: FollowedSources,
  { take, excludeIds = [] }: { take: number; excludeIds?: string[] }
) {
  if (sources.authors.length === 0 && sources.categories.length === 0) return [];
  return db.article.findMany({
    where: {
      status: "PUBLISHED",
      id: excludeIds.length ? { notIn: excludeIds } : undefined,
      OR: [
        { authorId: { in: sources.authors.map((a) => a.id) }, anonymous: false },
        { categoryId: { in: sources.categories.map((c) => c.id) } },
      ],
    },
    orderBy: { publishedAt: "desc" },
    take,
    select: FEED_CARD_SELECT,
  });
}
