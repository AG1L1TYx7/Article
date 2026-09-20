import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { SearchForm, type SearchFormOptions } from "@/components/search/SearchForm";
import { searchArticles } from "@/lib/search";
import { parseSearchParams, rangeToSince, searchHref } from "@/lib/searchParams";

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

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Search</h1>

      <div className="mt-6">
        <SearchForm query={query} options={options} />
      </div>

      {hasQuery && (
        <p className="mt-8 text-sm text-neutral-600" role="status">
          {results.total === 0
            ? `No articles match “${query.q}”.`
            : `${results.total} ${results.total === 1 ? "article" : "articles"} matching “${query.q}”.`}
        </p>
      )}

      {!hasQuery && (
        <p className="mt-8 text-neutral-600">
          Enter a word or phrase to search published articles. Put a phrase in
          quotes to match it exactly, or put a minus sign before a word to
          exclude it.
        </p>
      )}

      {results.hits.length > 0 && (
        <ul className="mt-8 flex flex-col gap-8">
          {results.hits.map((hit) => (
            <ArticleCard key={hit.id} article={hit} />
          ))}
        </ul>
      )}

      {results.pageCount > 1 && (
        <nav className="mt-10 flex items-center justify-between text-sm" aria-label="Search results pages">
          {query.page > 1 ? (
            <Link href={searchHref({ ...query, page: query.page - 1 })} className="hover:underline">
              ← Newer matches
            </Link>
          ) : (
            <span />
          )}
          <span className="text-neutral-500">
            Page {results.page} of {results.pageCount}
          </span>
          {query.page < results.pageCount ? (
            <Link href={searchHref({ ...query, page: query.page + 1 })} className="hover:underline">
              Older matches →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
