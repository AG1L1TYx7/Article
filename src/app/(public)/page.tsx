import Link from "next/link";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth/config";
import { followedSources, followingFeed } from "@/lib/followingFeed";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { withDatabaseFallback } from "@/lib/buildSafe";
import { daysAgo } from "@/lib/timeWindow";
import { ArrowRightIcon } from "@/components/icons";

const CARD_SELECT = {
  id: true,
  slug: true,
  title: true,
  dek: true,
  isBreaking: true,
  publishedAt: true,
  author: { select: { name: true, handle: true } },
  category: { select: { name: true, slug: true } },
  coverImage: { select: { url: true, altText: true } },
} as const;

export default async function Home() {
  // Rendered on every request (the root layout forces dynamic rendering
  // for the whole site), so what a reader sees is always the database as
  // it is now. The fallback is for a database outage — and for `next
  // build`, which evaluates this module before any database exists. See
  // lib/buildSafe.ts.
  const articles = await withDatabaseFallback(
    () =>
      db.article.findMany({
        where: { status: "PUBLISHED" },
        orderBy: { publishedAt: "desc" },
        take: 24,
        // Explicit select, not include: the default pulls every scalar
        // column, which on this table means bodyHtml and bodyJson —
        // roughly 19KB and 21KB of article text each, fetched and
        // decompressed for 24 articles just to render titles and deks.
        select: CARD_SELECT,
      }),
    [],
    "homepage article list"
  );

  // A breaking story leads the page only while it is actually breaking;
  // after a day the flag is still shown on the card but the story takes
  // its ordinary place in the list.
  const dayAgo = daysAgo(1);
  const breakingIndex = articles.findIndex(
    (a) => a.isBreaking && a.publishedAt && a.publishedAt > dayAgo
  );
  const ordered =
    breakingIndex > 0
      ? [articles[breakingIndex]!, ...articles.filter((_, i) => i !== breakingIndex)]
      : articles;

  const [lead, ...rest] = ordered;
  const secondary = rest.slice(0, 3);

  // The personalised strip. Only for someone signed in who follows
  // something; anonymous readers get exactly the page they always did.
  // Stories already in the top block are left out so a follower of the
  // lead's author is not shown the lead twice.
  const session = await auth();
  const forYou = session?.user
    ? await (async () => {
        const sources = await followedSources(session.user.id);
        if (sources.authors.length === 0 && sources.categories.length === 0) return null;
        const topIds = [lead, ...secondary].filter(Boolean).map((a) => a!.id);
        const items = await followingFeed(sources, { take: 6, excludeIds: topIds });
        return { sources, items };
      })()
    : null;
  // The image-led row takes the next three stories that have a cover, so
  // the grid is three pictures rather than two pictures and a gap.
  const remaining = rest.slice(3);
  const featured = remaining.filter((a) => a.coverImage).slice(0, 3);
  const latest = remaining.filter((a) => !featured.includes(a));

  if (!lead) {
    return (
      <main id="main-content" className="mx-auto max-w-6xl px-4 py-24 text-center sm:px-6">
        <p className="eyebrow">Latest</p>
        <h1 className="headline mt-3 text-4xl">Nothing published yet.</h1>
        <p className="mt-3 text-ink-2">The first story will appear here the moment it goes live.</p>
      </main>
    );
  }

  return (
    <main id="main-content" className="mx-auto max-w-6xl px-4 pt-8 pb-16 sm:px-6 sm:pt-10">
      <h1 className="sr-only">Latest</h1>

      {/* Top of the page: the lead story and the three after it. */}
      <section aria-label="Top stories" className="grid gap-10 lg:grid-cols-[1.55fr_1fr] lg:gap-14">
        <ul>
          <ArticleCard article={lead} variant="lead" />
        </ul>
        {secondary.length > 0 && (
          <ul className="flex flex-col border-t border-line lg:border-t-0 lg:border-l lg:pl-14 [&>li]:border-b [&>li]:border-line [&>li]:py-5 [&>li:last-child]:border-b-0 lg:[&>li:first-child]:pt-0">
            {secondary.map((article) => (
              <ArticleCard key={article.id} article={article} variant="compact" />
            ))}
          </ul>
        )}
      </section>

      {forYou && (
        <section aria-labelledby="for-you-heading" className="mt-14 border-t border-line pt-10">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="for-you-heading" className="section-title">
              From writers and sections you follow
            </h2>
            <Link href="/following" className="text-link inline-flex items-center gap-1 text-sm">
              Everything you follow <ArrowRightIcon size={14} />
            </Link>
          </div>
          {forYou.items.length > 0 ? (
            <ul className="mt-2 grid gap-x-12 md:grid-cols-2 lg:grid-cols-3 [&>li]:border-b [&>li]:border-line [&>li]:py-5">
              {forYou.items.map((article) => (
                <ArticleCard key={article.id} article={article} variant="compact" />
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-ink-2">Nothing new from them beyond the stories above.</p>
          )}
        </section>
      )}

      {featured.length > 0 && (
        <section aria-label="Featured" className="mt-14 border-t border-line pt-10">
          <ul className="grid gap-10 md:grid-cols-3">
            {featured.map((article) => (
              <ArticleCard key={article.id} article={article} variant="featured" />
            ))}
          </ul>
        </section>
      )}

      {latest.length > 0 && (
        <section aria-labelledby="latest-heading" className="mt-16">
          <h2 id="latest-heading" className="section-title">
            More stories
          </h2>
          <ul className="mt-2 grid gap-x-12 md:grid-cols-2 [&>li]:border-b [&>li]:border-line [&>li]:py-6">
            {latest.map((article) => (
              <ArticleCard key={article.id} article={article} variant="row" />
            ))}
          </ul>
        </section>
      )}

      <div className="mt-12 flex justify-center">
        <Link href="/search" className="btn btn-secondary gap-2">
          Search the archive <ArrowRightIcon size={16} />
        </Link>
      </div>
    </main>
  );
}
