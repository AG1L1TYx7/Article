import { DATE_RANGES, type SearchQuery } from "@/lib/searchParams";
import { SearchIcon } from "@/components/icons";
import { SubmitOnChange } from "./SubmitOnChange";
import { getI18n } from "@/i18n/server";

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
export async function SearchForm({
  query,
  options,
}: {
  query: SearchQuery;
  options: SearchFormOptions;
}) {
  const { t } = await getI18n();

  return (
    <form action="/search" method="get" className="flex flex-col gap-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <label htmlFor="q" className="sr-only">
            {t("common.searchArticles")}
          </label>
          <SearchIcon
            size={18}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3"
          />
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={query.q}
            placeholder={t("search.placeholder")}
            maxLength={200}
            autoComplete="off"
            className="input h-11 pl-10 text-base"
          />
        </div>
        <button type="submit" className="btn btn-primary h-11 px-5">
          {t("common.search")}
        </button>
      </div>

      {/* Changing a dropdown applies it at once when JavaScript is on;
          the Search button covers the case when it is not. */}
      <SubmitOnChange>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-ink-3">{t("common.section")}</span>
            <select name="category" defaultValue={query.category} className="input w-auto py-1.5">
              <option value="">{t("search.allSections")}</option>
              {options.categories.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2">
            <span className="text-ink-3">{t("common.author")}</span>
            <select name="author" defaultValue={query.author} className="input w-auto py-1.5">
              <option value="">{t("search.anyone")}</option>
              {options.authors.map((a) => (
                <option key={a.handle} value={a.handle}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2">
            <span className="text-ink-3">{t("search.published")}</span>
            <select name="range" defaultValue={query.range} className="input w-auto py-1.5">
              {DATE_RANGES.map((r) => (
                <option key={r.value} value={r.value}>
                  {t(r.label)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </SubmitOnChange>
    </form>
  );
}
