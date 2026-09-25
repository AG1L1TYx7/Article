import Link from "next/link";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth/config";
import { followedSources, followingFeed } from "@/lib/followingFeed";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { IssueCard } from "./issues/IssueCard";
import { listPublishedIssues } from "@/lib/issues";
import { PushToggle } from "@/components/push/PushToggle";
import { withDatabaseFallback } from "@/lib/buildSafe";
import { daysAgo } from "@/lib/timeWindow";
import { ArrowRightIcon } from "@/components/icons";
import { getI18n } from "@/i18n/server";

const CARD_SELECT = {
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

/**
 * The five most-read stories of the past week, by the per-day view
 * counts analytics already keeps. Falls back to all-time views when the
 * week has no rows yet (a fresh install), so the rail is never empty
 * while there is anything to show.
 */
async function mostRead(excludeIds: string[]) {
  const since = daysAgo(7);
  since.setUTCHours(0, 0, 0, 0);
  const week = await db.articleViewDaily.groupBy({
    by: ["articleId"],
    where: { day: { gte: since }, article: { status: "PUBLISHED" } },
    _sum: { views: true },
    orderBy: { _sum: { views: "desc" } },
    take: 8,
  });
  const ids = week.map((w) => w.articleId).filter((id) => !excludeIds.includes(id)).slice(0, 5);
  const rows =
    ids.length > 0
      ? await db.article.findMany({
          where: { id: { in: ids }, status: "PUBLISHED" },
          select: { id: true, slug: true, title: true, category: { select: { name: true } } },
        })
      : await db.article.findMany({
          where: { status: "PUBLISHED", id: { notIn: excludeIds } },
          orderBy: { viewCount: "desc" },
          take: 5,
          select: { id: true, slug: true, title: true, category: { select: { name: true } } },
        });
  // groupBy order is lost by findMany; restore it.
  const rank = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99));
}

export default async function Home() {
  const { t, formatDate } = await getI18n();

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
  const secondary = rest.slice(0, 4);
  const topIds = [lead, ...secondary].filter(Boolean).map((a) => a!.id);

  // The personalised strip. Only for someone signed in who follows
  // something; anonymous readers get exactly the page they always did.
  const session = await auth();
  const [forYou, popular] = await Promise.all([
    session?.user
      ? (async () => {
          const sources = await followedSources(session.user.id);
          if (sources.authors.length === 0 && sources.categories.length === 0) return null;
          const items = await followingFeed(sources, { take: 6, excludeIds: topIds });
          return { sources, items };
        })()
      : null,
    withDatabaseFallback(() => mostRead(topIds), [], "homepage most read"),
  ]);

  // After the top block: a stream of the latest, then an image-led row of
  // the next three stories that have a cover, so the page changes pace.
  const remaining = rest.slice(4);
  const featured = remaining.filter((a) => a.coverImage).slice(0, 3);

  // Same fallback as the articles above: the front page must still render
  // during a database outage, and `next build` evaluates this module
  // before any database exists.
  const issues = await withDatabaseFallback(
    () => listPublishedIssues({ take: 4 }),
    [],
    "home issues"
  );
  const latest = remaining.filter((a) => !featured.includes(a)).slice(0, 8);

  if (!lead) {
    return (
      <main id="main-content" className="mx-auto max-w-6xl px-4 py-24 text-center sm:px-6">
        <p className="eyebrow">{t("common.latest")}</p>
        <h1 className="headline mt-3 text-4xl">{t("home.nothingYet")}</h1>
        <p className="mt-3 text-ink-2">{t("home.firstStory")}</p>
      </main>
    );
  }

  return (
    <main id="main-content" className="mx-auto max-w-6xl px-4 pt-8 pb-16 sm:px-6 sm:pt-10">
      <h1 className="sr-only">{t("common.latest")}</h1>

      {/* Top of the page: the lead story and the four after it. */}
      <section aria-label={t("home.topStories")} className="grid gap-10 lg:grid-cols-[1.6fr_1fr] lg:gap-12">
        <ul>
          <ArticleCard article={lead} variant="lead" />
        </ul>
        {secondary.length > 0 && (
          <ul className="flex flex-col border-t border-line lg:border-t-0 lg:border-l lg:pl-8 [&>li]:border-b [&>li]:border-line [&>li]:py-5 [&>li:last-child]:border-b-0 lg:[&>li:first-child]:pt-0">
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
              {t("home.forYou")}
            </h2>
            <Link href="/following" className="text-link inline-flex items-center gap-1 text-sm">
              {t("home.everythingYouFollow")} <ArrowRightIcon size={14} />
            </Link>
          </div>
          {forYou.items.length > 0 ? (
            <ul className="mt-2 grid gap-x-12 md:grid-cols-2 lg:grid-cols-3 [&>li]:border-b [&>li]:border-line [&>li]:py-5">
              {forYou.items.map((article) => (
                <ArticleCard key={article.id} article={article} variant="compact" />
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-ink-2">{t("home.nothingNewFromFollows")}</p>
          )}
        </section>
      )}

      {/* Reports from the districts.
          On the front page rather than only at /issues, because a platform
          where the public can raise something and a platform where they
          can raise something *and be seen* are different platforms. Buried
          behind a nav link, this is a suggestion box. */}
      {issues.length > 0 && (
        <section aria-labelledby="issues-heading" className="mt-14 border-t border-line pt-10">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="issues-heading" className="section-title">
              {t("home.fromTheDistricts")}
            </h2>
            <Link href="/issues" className="text-link inline-flex items-center gap-1 text-sm">
              {t("home.allReports")} <ArrowRightIcon size={14} />
            </Link>
          </div>
          <p className="mt-1 text-sm text-ink-2">{t("home.fromTheDistrictsBlurb")}</p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {issues.map((issue) => (
              <IssueCard key={issue.id} issue={issue} formatDate={formatDate} />
            ))}
          </div>
        </section>
      )}

      {/* The stream, with the numbered Most Read rail beside it. */}
      <div className="mt-14 grid gap-12 lg:grid-cols-[1fr_320px]">
        <section aria-labelledby="latest-heading">
          <h2 id="latest-heading" className="section-title">
            {t("home.latest")}
          </h2>
          <ul className="mt-2 [&>li]:border-b [&>li]:border-line [&>li]:py-6">
            {latest.map((article) => (
              <ArticleCard key={article.id} article={article} variant="row" />
            ))}
          </ul>
        </section>

        <aside className="lg:pt-0">
          {popular.length > 0 && (
            <section aria-labelledby="most-read-heading">
              <h2 id="most-read-heading" className="section-title">
                {t("home.mostRead")}
              </h2>
              <ol className="mt-2 [&>li]:border-b [&>li]:border-line [&>li]:py-4 [&>li:last-child]:border-b-0">
                {popular.map((article, i) => (
                  <li key={article.id} className="grid grid-cols-[36px_1fr] gap-3">
                    <span className="figure text-[30px] leading-none text-ink-3" aria-hidden="true">
                      {i + 1}
                    </span>
                    <div>
                      <Link
                        href={`/article/${article.slug}`}
                        className="headline text-[17px] leading-snug hover:underline decoration-line-strong underline-offset-4"
                      >
                        {article.title}
                      </Link>
                      {article.category && <p className="mt-1 text-xs text-ink-3">{article.category.name}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* Renders nothing unless push is configured and supported. */}
          <div className="mt-8 rounded-[10px] bg-ink p-5 text-paper [&:has([data-push-toggle])]:block [&:not(:has([data-push-toggle]))]:hidden">
            <p className="kicker" style={{ color: "color-mix(in srgb, var(--paper) 60%, transparent)" }}>
              {t("push.off")}
            </p>
            <p className="font-serif mt-2 text-[17px] leading-snug">{t("push.offNote")}</p>
            <div className="mt-4">
              <PushToggle variant="button" />
            </div>
          </div>
        </aside>
      </div>

      {featured.length > 0 && (
        <section aria-label={t("home.featured")} className="mt-14 border-t border-line pt-10">
          <ul className="grid gap-10 md:grid-cols-3">
            {featured.map((article) => (
              <ArticleCard key={article.id} article={article} variant="featured" />
            ))}
          </ul>
        </section>
      )}

      <div className="mt-12 flex justify-center">
        <Link href="/search" className="btn btn-secondary gap-2">
          {t("home.searchArchive")} <ArrowRightIcon size={16} />
        </Link>
      </div>
    </main>
  );
}
