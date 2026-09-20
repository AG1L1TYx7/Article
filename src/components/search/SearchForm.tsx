import { DATE_RANGES, type SearchQuery } from "@/lib/searchParams";

export interface SearchFormOptions {
  categories: { slug: string; name: string }[];
  authors: { handle: string; name: string }[];
}

/**
 * A plain GET form, deliberately.
 *
 * Submitting navigates to /search?q=…, which means results are
 * bookmarkable and shareable, the back button works, and searching does
 * not depend on JavaScript having loaded — the same reasons a newsroom
 * site wants search to be a URL rather than app state.
 */
export function SearchForm({
  query,
  options,
}: {
  query: SearchQuery;
  options: SearchFormOptions;
}) {
  return (
    <form action="/search" method="get" className="flex flex-col gap-3">
      <div className="flex gap-2">
        <label htmlFor="q" className="sr-only">
          Search articles
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={query.q}
          placeholder="Search articles…"
          maxLength={200}
          autoComplete="off"
          className="flex-1 rounded border border-neutral-300 px-3 py-2"
        />
        <button
          type="submit"
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          Search
        </button>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <label className="flex items-center gap-1">
          <span className="text-neutral-600">Section</span>
          <select
            name="category"
            defaultValue={query.category}
            className="rounded border border-neutral-300 px-2 py-1"
          >
            <option value="">All sections</option>
            {options.categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1">
          <span className="text-neutral-600">Author</span>
          <select
            name="author"
            defaultValue={query.author}
            className="rounded border border-neutral-300 px-2 py-1"
          >
            <option value="">Anyone</option>
            {options.authors.map((a) => (
              <option key={a.handle} value={a.handle}>
                {a.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1">
          <span className="text-neutral-600">Published</span>
          <select
            name="range"
            defaultValue={query.range}
            className="rounded border border-neutral-300 px-2 py-1"
          >
            {DATE_RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </form>
  );
}
