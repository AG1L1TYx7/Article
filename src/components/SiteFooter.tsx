import Link from "next/link";
import { db } from "@/lib/db";
import { withDatabaseFallback } from "@/lib/buildSafe";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/siteUrl";
import { Wordmark } from "./Wordmark";
import { getI18n } from "@/i18n/server";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ThemeToggle } from "./ThemeToggle";
import { getTheme } from "@/theme/server";
import { RssIcon } from "./icons";
import { PushToggle } from "./push/PushToggle";

/**
 * Site footer. Lists are plain <ul>s rather than a <nav>: the section bar
 * in the masthead is the page's one navigation landmark, and a second one
 * would make screen-reader "jump to navigation" ambiguous.
 */
export async function SiteFooter() {
  const { t } = await getI18n();

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
          <Wordmark height={26} />
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-2">{SITE_DESCRIPTION}</p>
          <a
            href="/feed.xml"
            className="mt-5 inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink"
          >
            <RssIcon size={16} /> {t("footer.rss")}
          </a>
          {/* Renders nothing unless push is configured and the browser
              supports it — see components/push/PushToggle.tsx. */}
          <div className="mt-4">
            <PushToggle variant="button" />
          </div>
        </div>

        <div>
          <p className="kicker">{t("header.sections")}</p>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            <li>
              <Link href="/" className="text-ink-2 hover:text-ink">
                {t("common.latest")}
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
          <p className="kicker">{t("footer.reader")}</p>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            <li>
              <Link href="/search" className="text-ink-2 hover:text-ink">
                {t("footer.searchArchive")}
              </Link>
            </li>
            <li>
              <Link href="/following" className="text-ink-2 hover:text-ink">
                {t("footer.following")}
              </Link>
            </li>
            <li>
              <Link href="/saved" className="text-ink-2 hover:text-ink">
                {t("footer.readingList")}
              </Link>
            </li>
            <li>
              <Link href="/notifications" className="text-ink-2 hover:text-ink">
                {t("footer.activity")}
              </Link>
            </li>
            <li>
              <Link href="/account" className="text-ink-2 hover:text-ink">
                {t("footer.account")}
              </Link>
            </li>
            <li>
              <Link href="/register" className="text-ink-2 hover:text-ink">
                {t("footer.createAccount")}
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
          <div className="flex flex-wrap items-center gap-3">
            <ThemeToggle initial={await getTheme()} />
            <LanguageSwitcher />
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            <li>
              <Link href="/privacy" className="hover:text-ink">
                {t("footer.privacy")}
              </Link>
            </li>
            <li>
              <Link href="/terms" className="hover:text-ink">
                {t("footer.terms")}
              </Link>
            </li>
            <li>
              {/* CCPA/CPRA: a "privacy choices" link in the footer, even
                  though nothing is sold — the section says so. */}
              <Link href="/privacy#california" className="hover:text-ink">
                {t("footer.privacyChoices")}
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
