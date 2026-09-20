import Link from "next/link";
import { db } from "@/lib/db";
import { withDatabaseFallback } from "@/lib/buildSafe";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/siteUrl";
import { RssIcon } from "./icons";

/**
 * Site footer. Lists are plain <ul>s rather than a <nav>: the section bar
 * in the masthead is the page's one navigation landmark, and a second one
 * would make screen-reader "jump to navigation" ambiguous.
 */
export async function SiteFooter() {
  const categories = await withDatabaseFallback(
    () =>
      db.category.findMany({
        where: { articles: { some: { status: "PUBLISHED" } } },
        orderBy: { name: "asc" },
        select: { slug: true, name: true },
        take: 12,
      }),
    [],
    "site footer sections"
  );

  return (
    <footer className="mt-20 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <p className="headline text-2xl font-semibold">{SITE_NAME}</p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-2">{SITE_DESCRIPTION}</p>
          <a
            href="/feed.xml"
            className="mt-5 inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink"
          >
            <RssIcon size={16} /> RSS feed
          </a>
        </div>

        <div>
          <p className="kicker">Sections</p>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            <li>
              <Link href="/" className="text-ink-2 hover:text-ink">
                Latest
              </Link>
            </li>
            {categories.map((c) => (
              <li key={c.slug}>
                <Link href={`/category/${c.slug}`} className="text-ink-2 hover:text-ink">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="kicker">Reader</p>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            <li>
              <Link href="/search" className="text-ink-2 hover:text-ink">
                Search the archive
              </Link>
            </li>
            <li>
              <Link href="/saved" className="text-ink-2 hover:text-ink">
                Your reading list
              </Link>
            </li>
            <li>
              <Link href="/notifications" className="text-ink-2 hover:text-ink">
                Your activity
              </Link>
            </li>
            <li>
              <Link href="/account" className="text-ink-2 hover:text-ink">
                Your account
              </Link>
            </li>
            <li>
              <Link href="/register" className="text-ink-2 hover:text-ink">
                Create an account
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-4 text-xs text-ink-3 sm:px-6">
          <p>
            © {new Date().getUTCFullYear()} {SITE_NAME}
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            <li>
              <Link href="/privacy" className="hover:text-ink">
                Privacy
              </Link>
            </li>
            <li>
              <Link href="/terms" className="hover:text-ink">
                Terms
              </Link>
            </li>
            <li>
              {/* CCPA/CPRA: a "privacy choices" link in the footer, even
                  though nothing is sold — the section says so. */}
              <Link href="/privacy#california" className="hover:text-ink">
                Your privacy choices
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
