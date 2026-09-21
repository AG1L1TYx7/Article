import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { SearchForm, type SearchFormOptions } from "@/components/search/SearchForm";
import { searchArticles } from "@/lib/search";
import { DATE_RANGES, parseSearchParams, rangeToSince, searchHref } from "@/lib/searchParams";
import { ArrowLeftIcon, ArrowRightIcon } from "@/components/icons";

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
  const filterWords = [
    query.category && `in ${options.categories.find((c) => c.slug === query.category)?.name ?? query.category}`,
    query.author && `by ${options.authors.find((a) => a.handle === query.author)?.name ?? query.author}`,
    query.range && `from the ${DATE_RANGES.find((r) => r.value === query.range)?.label.toLowerCase()}`,
  ]
    .filter(Boolean)
    .join(" ");

  const count = `${results.total} ${results.total === 1 ? "article" : "articles"}`;
  const status = hasQuery
    ? results.total === 0
      ? `No articles match “${query.q}”${filterWords ? ` ${filterWords}` : ""}.`
      : `${count} matching “${query.q}”${filterWords ? ` ${filterWords}` : ""}.`
    : hasFilters
      ? results.total === 0
        ? `No articles ${filterWords}.`
        : `${count} ${filterWords}, newest first.`
      : null;

  return (
    <main id="main-content" className="mx-auto max-w-3xl px-4 pt-10 pb-16 sm:px-6">
      <p className="kicker">Archive</p>
      <h1 className="headline mt-2 text-4xl">Search</h1>

      <div className="mt-6">
        <SearchForm query={query} options={options} />
      </div>

      {status && (
        <p className="mt-8 text-sm text-ink-2" role="status">
          {status}
        </p>
      )}

      {!status && (
        <p className="mt-8 text-sm leading-relaxed text-ink-2">
          Enter a word or phrase to search published articles, or pick a section, author or
          date range to browse. Put a phrase in quotes to match it exactly, or put a minus
          sign before a word to exclude it.
        </p>
      )}

      {(hasQuery || hasFilters) && results.total === 0 && (
        <p className="mt-2 text-sm text-ink-3">
          Try fewer words, check the spelling, or widen the date range.
        </p>
      )}

      {results.hits.length > 0 && (
        <ul className="mt-4 [&>li]:border-b [&>li]:border-line [&>li]:py-6">
          {results.hits.map((hit) => (
            <ArticleCard key={hit.id} article={hit} />
          ))}
        </ul>
      )}

      {results.pageCount > 1 && (
        <nav className="mt-8 flex items-center justify-between text-sm" aria-label="Search results pages">
          {query.page > 1 ? (
            <Link href={searchHref({ ...query, page: query.page - 1 })} className="btn btn-secondary btn-sm gap-1.5">
              <ArrowLeftIcon size={14} /> Newer matches
            </Link>
          ) : (
            <span />
          )}
          <span className="text-ink-3">
            Page {results.page} of {results.pageCount}
          </span>
          {query.page < results.pageCount ? (
            <Link href={searchHref({ ...query, page: query.page + 1 })} className="btn btn-secondary btn-sm gap-1.5">
              Older matches <ArrowRightIcon size={14} />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
