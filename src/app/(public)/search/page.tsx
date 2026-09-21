import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { SearchForm, type SearchFormOptions } from "@/components/search/SearchForm";
import { searchArticles } from "@/lib/search";
import { DATE_RANGES, parseSearchParams, rangeToSince, searchHref } from "@/lib/searchParams";
import { ArrowLeftIcon, ArrowRightIcon } from "@/components/icons";
import { getI18n } from "@/i18n/server";

export const metadata: Metadata = {
  title: "Search",
  // Result pages are infinite in number and thin in content; letting a
  // crawler index them buries the actual articles.
  robots: { index: false, follow: true },
};

const AUTHOR_CHOICES = 50;

/**
 * The people and sections offered in the filter dropdowns.
 *
 * Only those with published work: filtering by a section that has nothing
 * in it looks like the search is broken. The currently selected author is
 * always included even if they fall outside the list, otherwise reloading
 * a filtered URL would silently reset the dropdown to "Anyone" while the
 * filter stayed applied.
 */
async function loadFilterOptions(selectedAuthor: string): Promise<SearchFormOptions> {
  const [categories, authors] = await Promise.all([
    db.category.findMany({
      where: { articles: { some: { status: "PUBLISHED" } } },
      orderBy: { name: "asc" },
      select: { slug: true, name: true },
    }),
    db.user.findMany({
      where: { articles: { some: { status: "PUBLISHED" } } },
      orderBy: { name: "asc" },
      select: { handle: true, name: true },
      take: AUTHOR_CHOICES,
    }),
  ]);

  if (selectedAuthor && !authors.some((a) => a.handle === selectedAuthor)) {
    const current = await db.user.findUnique({
      where: { handle: selectedAuthor },
      select: { handle: true, name: true },
    });
    if (current) authors.unshift(current);
  }

  return { categories, authors };
}

export default async function SearchPage(props: PageProps<"/search">) {
  const query = parseSearchParams(await props.searchParams);
  const { t, n, formatNumber } = await getI18n();

  const [options, results] = await Promise.all([
    loadFilterOptions(query.author),
    searchArticles({
      q: query.q,
      categorySlug: query.category,
      authorHandle: query.author,
      since: rangeToSince(query.range),
      page: query.page,
    }),
  ]);

  const hasQuery = query.q.trim().length > 0;
  const hasFilters = !!(query.category || query.author || query.range);

  // "3 articles in Sport by Ada Lovelace from the past week" — the
  // filters read back in words, so a reader can see what narrowed the list.
  const range = DATE_RANGES.find((r) => r.value === query.range);
  const filterWords = [
    query.category &&
      t("search.inSection", {
        section: options.categories.find((c) => c.slug === query.category)?.name ?? query.category,
      }),
    query.author &&
      t("search.byAuthor", { author: options.authors.find((a) => a.handle === query.author)?.name ?? query.author }),
    query.range && range && t("search.fromRange", { range: t(range.label).toLowerCase() }),
  ]
    .filter(Boolean)
    .join(" ");

  const status = hasQuery
    ? results.total === 0
      ? t("search.noMatch", { query: query.q, filters: filterWords ? ` ${filterWords}` : "" })
      : n(results.total, "search.matching", { query: query.q, filters: filterWords ? ` ${filterWords}` : "" })
    : hasFilters
      ? results.total === 0
        ? t("search.noneWithFilters", { filters: filterWords })
        : n(results.total, "search.browsing", { filters: filterWords })
      : null;

  return (
    <main id="main-content" className="mx-auto max-w-3xl px-4 pt-10 pb-16 sm:px-6">
      <p className="kicker">{t("search.kicker")}</p>
      <h1 className="headline mt-2 text-4xl">{t("search.title")}</h1>

      <div className="mt-6">
        <SearchForm query={query} options={options} />
      </div>

      {status && (
        <p className="mt-8 text-sm text-ink-2" role="status">
          {status}
        </p>
      )}

      {!status && <p className="mt-8 text-sm leading-relaxed text-ink-2">{t("search.hint")}</p>}

      {(hasQuery || hasFilters) && results.total === 0 && (
        <p className="mt-2 text-sm text-ink-3">{t("search.tryFewer")}</p>
      )}

      {results.hits.length > 0 && (
        <ul className="mt-4 [&>li]:border-b [&>li]:border-line [&>li]:py-6">
          {results.hits.map((hit) => (
            <ArticleCard key={hit.id} article={hit} />
          ))}
        </ul>
      )}

      {results.pageCount > 1 && (
        <nav className="mt-8 flex items-center justify-between text-sm" aria-label={t("search.pages")}>
          {query.page > 1 ? (
            <Link href={searchHref({ ...query, page: query.page - 1 })} className="btn btn-secondary btn-sm gap-1.5">
              <ArrowLeftIcon size={14} /> {t("search.newer")}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-ink-3">
            {t("search.pageOf", { page: formatNumber(results.page), total: formatNumber(results.pageCount) })}
          </span>
          {query.page < results.pageCount ? (
            <Link href={searchHref({ ...query, page: query.page + 1 })} className="btn btn-secondary btn-sm gap-1.5">
              {t("search.older")} <ArrowRightIcon size={14} />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
