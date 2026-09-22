import Link from "next/link";
import { db } from "@/lib/db";
import { withDatabaseFallback } from "@/lib/buildSafe";
import { SITE_NAME } from "@/lib/siteUrl";
import { getI18n } from "@/i18n/server";
import { HeaderAccountLinks } from "./HeaderAccountLinks";
import { SearchIcon } from "./icons";

/**
 * The masthead: a wordmark row with the date and account links, and a
 * section bar beneath it that stays pinned while reading.
 *
 * Sections come from the database rather than a hardcoded list, so adding
 * a category in the dashboard puts it in the nav without a code change.
 * Only categories that actually have something published are shown — an
 * empty section in the masthead looks broken to a reader.
 *
 * Deliberately does not read the session: see HeaderAccountLinks for why
 * that would cost static rendering on every page.
 */
export async function SiteHeader() {
  const { t, formatLongDate } = await getI18n();

  // Wrapped because this header is in every public page's layout: an
  // unreachable database would otherwise 500 every page rather than just
  // dropping the section list, and would fail `next build`, which
  // evaluates this module. See lib/buildSafe.ts.
  const categories = await withDatabaseFallback(
    () =>
      db.category.findMany({
        where: { articles: { some: { status: "PUBLISHED" } } },
        orderBy: { name: "asc" },
        select: { slug: true, name: true },
        take: 8,
      }),
    [],
    "site header sections"
  );

  return (
    <header className="bg-paper">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Wordmark row */}
        <div className="grid h-16 grid-cols-[1fr_auto_1fr] items-center gap-4 sm:h-20">
          <p className="hidden text-xs text-ink-3 sm:block">{formatLongDate(new Date())}</p>
          <Link
            href="/"
            className="headline justify-self-center whitespace-nowrap text-[26px] leading-none font-semibold tracking-[-0.02em] sm:text-[34px]"
          >
            {SITE_NAME}
          </Link>
          <div className="justify-self-end">
            <HeaderAccountLinks />
          </div>
        </div>
      </div>

      {/* Section bar — the only <nav> on public pages. */}
      <div className="sticky top-0 z-40 border-y border-line bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/80">
        <div className="mx-auto flex h-11 max-w-6xl items-center gap-2 px-4 sm:px-6">
          <nav
            aria-label={t("header.sections")}
            className="-mx-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <Link href="/" className="nav-link shrink-0 font-medium text-ink">
              {t("common.latest")}
            </Link>
            {categories.map((c) => (
              <Link key={c.slug} href={`/category/${c.slug}`} className="nav-link shrink-0">
                {c.name}
              </Link>
            ))}
          </nav>

          {/* A GET form, so a search is a shareable URL and works before
              (or without) hydration — see components/search/SearchForm.tsx. */}
          <form action="/search" method="get" className="relative shrink-0">
            <label htmlFor="site-search" className="sr-only">
              {t("common.searchArticles")}
            </label>
            <SearchIcon
              size={15}
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3"
            />
            <input
              id="site-search"
              name="q"
              type="search"
              placeholder={t("common.search")}
              maxLength={200}
              autoComplete="off"
              className="input h-8 w-24 rounded-full py-1 pr-3 pl-8 text-[13px] transition-[width] focus:w-40 sm:w-44 sm:focus:w-60"
            />
          </form>
        </div>
      </div>
    </header>
  );
}
