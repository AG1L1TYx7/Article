import Link from "next/link";
import { TagIcon } from "@/components/icons";
import { initials } from "@/lib/format";
import { imageSrcSet, imageVariantUrl } from "@/lib/imageUrl";
import { getI18n } from "@/i18n/server";
import { LOCALE_NAMES, isLocale } from "@/i18n/config";

/**
 * The pieces of a rendered article, shared by the public page and the
 * newsroom preview so a draft looks exactly as it will when it is live.
 * Server components: no hooks, no client state. Interactive parts (share,
 * engagement, comments) are slotted in by the page around these.
 */

export async function ArticleHeader({
  title,
  dek,
  isBreaking,
  category,
  author,
  publishedAt,
  updatedAt,
  minutes,
  locale: storyLocale,
  translations = [],
  aside,
}: {
  title: string;
  dek: string | null;
  isBreaking: boolean;
  category: { name: string; slug: string } | null;
  author: { name: string; handle: string };
  publishedAt: Date | null;
  /** Only pass when the article was meaningfully edited after publishing. */
  updatedAt?: Date | null;
  minutes: number;
  /** The language the story is written in. */
  locale?: string;
  /** Published versions of this story in other languages. */
  translations?: { slug: string; locale: string }[];
  /** Rendered at the right of the byline row — the share links, usually. */
  aside?: React.ReactNode;
}) {
  const { locale, t, formatDate, formatNumber } = await getI18n();
  const storyLang = storyLocale && isLocale(storyLocale) ? storyLocale : undefined;
  const foreign = storyLang && storyLang !== locale;
  const otherVersions = translations.filter((v) => isLocale(v.locale));

  return (
    <header className="mx-auto max-w-3xl px-4 pt-10 sm:px-6 sm:pt-14">
      <div className="flex items-center gap-2">
        {isBreaking && <span className="badge-breaking">{t("common.breaking")}</span>}
        {category && (
          <Link href={`/category/${category.slug}`} className="eyebrow hover:underline">
            {category.name}
          </Link>
        )}
      </div>
      <h1 className="headline mt-4 text-[36px] leading-[1.06] sm:text-[52px]" lang={foreign ? storyLang : undefined}>
        {title}
      </h1>
      {dek && (
        <p className="mt-5 font-serif text-xl leading-snug text-ink-2 sm:text-2xl" lang={foreign ? storyLang : undefined}>
          {dek}
        </p>
      )}

      {/* The reader's interface is in one language and the story in
          another, or the story exists in others: say so, and offer them. */}
      {(foreign || otherVersions.length > 0) && (
        <p className="mt-5 flex flex-wrap items-center gap-2 text-sm text-ink-2">
          {foreign && <span>{t("article.inLanguage", { language: LOCALE_NAMES[storyLang] })}</span>}
          {otherVersions.length > 0 && (
            <>
              <span>{t("article.readIn")}</span>
              {otherVersions.map((v) => (
                <Link
                  key={v.slug}
                  href={`/article/${v.slug}`}
                  hrefLang={v.locale}
                  lang={v.locale}
                  className="pill pill-neutral hover:border-ink"
                >
                  {LOCALE_NAMES[v.locale as keyof typeof LOCALE_NAMES]}
                </Link>
              ))}
            </>
          )}
        </p>
      )}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border-y border-line py-4">
        <div className="flex items-center gap-3">
          <span className="avatar h-10 w-10 text-sm">{initials(author.name)}</span>
          <div className="text-sm">
            <p>
              <span className="text-ink-3">{t("common.by")} </span>
              <Link href={`/author/${author.handle}`} className="font-medium text-ink hover:underline">
                {author.name}
              </Link>
            </p>
            <p className="text-xs text-ink-3">
              {publishedAt ? (
                <time dateTime={publishedAt.toISOString()}>{formatDate(publishedAt)}</time>
              ) : (
                <span>{t("article.notYetPublished")}</span>
              )}
              <span aria-hidden="true"> · </span>
              {t("common.minRead", { minutes: formatNumber(minutes) })}
              {updatedAt && (
                <>
                  <span aria-hidden="true"> · </span>
                  <span className="text-ink-2">
                    {t("article.updated")} <time dateTime={updatedAt.toISOString()}>{formatDate(updatedAt)}</time>
                  </span>
                </>
              )}
            </p>
          </div>
        </div>
        {aside}
      </div>
    </header>
  );
}

export function ArticleCover({ image }: { image: { url: string; altText: string | null } | null }) {
  if (!image) return null;
  return (
    <figure className="mx-auto mt-8 max-w-5xl px-4 sm:px-6">
      {/* eslint-disable-next-line @next/next/no-img-element -- served from this site's own media route or object storage */}
      <img
        src={imageVariantUrl(image.url, 1200)}
        srcSet={imageSrcSet(image.url)}
        sizes="(min-width: 1024px) 960px, 100vw"
        alt={image.altText ?? ""}
        className="aspect-[16/9] w-full rounded-lg bg-surface-2 object-cover"
        loading="eager"
        decoding="async"
      />
      {image.altText && <figcaption className="mt-2 text-xs text-ink-3">{image.altText}</figcaption>}
    </figure>
  );
}

/**
 * The one dangerouslySetInnerHTML in the codebase. Callers pass HTML that
 * has already been through lib/sanitize.ts — the public page via the
 * per-revision cache, the preview directly.
 *
 * `lang` marks the story's own language on the body, so assistive
 * technology and hyphenation follow the text rather than the interface.
 */
export function ArticleBody({ html, lang }: { html: string; lang?: string }) {
  return (
    <div
      className="prose prose-article mt-10 max-w-none"
      lang={lang && isLocale(lang) ? lang : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export async function ArticleTags({ tags }: { tags: { slug: string; name: string }[] }) {
  if (tags.length === 0) return null;
  const { t } = await getI18n();
  return (
    <ul className="mt-10 flex flex-wrap items-center gap-2" aria-label={t("article.tags")}>
      <li className="flex items-center gap-1 text-xs font-medium tracking-wide text-ink-3 uppercase">
        <TagIcon size={12} /> {t("article.tagged")}
      </li>
      {tags.map((tag) => (
        <li key={tag.slug}>
          <Link href={`/tag/${tag.slug}`} className="btn btn-secondary btn-sm rounded-full">
            {tag.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}
