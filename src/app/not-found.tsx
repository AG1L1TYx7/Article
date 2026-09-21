import Link from "next/link";
import { SITE_NAME } from "@/lib/siteUrl";
import { getI18n } from "@/i18n/server";

export default async function NotFound() {
  const { t } = await getI18n();
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex h-16 items-center justify-center">
        <Link href="/" className="headline text-2xl font-semibold tracking-[-0.02em]">
          {SITE_NAME}
        </Link>
      </header>
      <main id="main-content" className="mx-auto flex max-w-lg flex-1 flex-col items-center px-6 pt-16 text-center">
        <p className="eyebrow">404</p>
        <h1 className="headline mt-3 text-4xl">{t("errors.notFoundTitle")}</h1>
        <p className="mt-4 text-ink-2">{t("errors.notFoundBody")}</p>
        <div className="mt-8 flex gap-3">
          <Link href="/" className="btn btn-primary">
            {t("common.frontPage")}
          </Link>
          <Link href="/search" className="btn btn-secondary">
            {t("common.search")}
          </Link>
        </div>
      </main>
    </div>
  );
}
