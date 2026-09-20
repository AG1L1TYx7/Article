import Link from "next/link";
import { db } from "@/lib/db";
import { HeaderAccountLinks } from "./HeaderAccountLinks";

/**
 * Sections come from the database rather than a hardcoded list, so adding
 * a category in the dashboard puts it in the nav without a code change.
 * Only categories that actually have something published are shown — an
 * empty section in the masthead looks broken to a reader.
 *
 * Deliberately does not read the session: see HeaderAccountLinks for why
 * that would cost static rendering on every page.
 */
export async function SiteHeader() {
  const categories = await db.category.findMany({
    where: { articles: { some: { status: "PUBLISHED" } } },
    orderBy: { name: "asc" },
    select: { slug: true, name: true },
    take: 8,
  });

  return (
    <header className="border-b border-neutral-200">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-4">
        <Link href="/" className="text-lg font-semibold">
          The Dispatch
        </Link>

        <nav className="flex flex-wrap gap-3 text-sm text-neutral-600">
          {categories.map((c) => (
            <Link key={c.slug} href={`/category/${c.slug}`} className="hover:underline">
              {c.name}
            </Link>
          ))}
        </nav>

        {/* A GET form, so a search is a shareable URL and works before
            (or without) hydration — see components/search/SearchForm.tsx. */}
        <form action="/search" method="get" className="ml-auto flex items-center gap-2">
          <label htmlFor="site-search" className="sr-only">
            Search articles
          </label>
          <input
            id="site-search"
            name="q"
            type="search"
            placeholder="Search"
            maxLength={200}
            autoComplete="off"
            className="w-28 rounded border border-neutral-300 px-2 py-1 text-sm sm:w-40"
          />
        </form>

        <HeaderAccountLinks />
      </div>
    </header>
  );
}
