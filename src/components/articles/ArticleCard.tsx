import Link from "next/link";
import { formatDate } from "@/lib/format";

export interface ArticleCardData {
  id: string;
  slug: string;
  title: string;
  dek: string | null;
  isBreaking?: boolean;
  publishedAt: Date | null;
  author: { name: string; handle?: string };
  category?: { name: string; slug?: string } | null;
  coverImage?: { url: string; altText: string | null } | null;
}

export type ArticleCardVariant = "lead" | "featured" | "row" | "compact";

/**
 * One article in a list. Shared by the homepage, author pages, category
 * pages, search and the saved list so they can't drift apart — the
 * fields here are exactly what those queries select, and nothing more.
 *
 * Four sizes of the same thing:
 *   lead      the front page's top story
 *   featured  an image-first card for a grid
 *   row       a list entry, image to the side when there is one
 *   compact   headline and byline only
 */
export function ArticleCard({
  article,
  variant = "row",
  hideCategory,
}: {
  article: ArticleCardData;
  variant?: ArticleCardVariant;
  hideCategory?: boolean;
}) {
  const href = `/article/${article.slug}`;
  const image = article.coverImage;

  const kicker = (
    <div className="flex items-center gap-2">
      {article.isBreaking && <span className="badge-breaking">Breaking</span>}
      {!hideCategory && article.category && (
        <span className="eyebrow">
          {article.category.slug ? (
            <Link href={`/category/${article.category.slug}`} className="hover:underline">
              {article.category.name}
            </Link>
          ) : (
            article.category.name
          )}
        </span>
      )}
    </div>
  );

  const byline = (
    <p className="text-xs text-ink-3">
      {article.author.handle ? (
        <Link href={`/author/${article.author.handle}`} className="font-medium text-ink-2 hover:text-ink">
          {article.author.name}
        </Link>
      ) : (
        <span className="font-medium text-ink-2">{article.author.name}</span>
      )}
      {article.publishedAt && (
        <>
          <span aria-hidden="true"> · </span>
          <time dateTime={article.publishedAt.toISOString()}>{formatDate(article.publishedAt)}</time>
        </>
      )}
    </p>
  );

  // Images link to the article too, but are hidden from assistive tech:
  // the headline is the link that carries the name, and a second link
  // with the same name is only noise.
  const picture = (className: string, sizes: string) =>
    image ? (
      <Link href={href} tabIndex={-1} aria-hidden="true" className={`block overflow-hidden rounded-md bg-surface-2 ${className}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- served from this site's own media route or object storage; next/image would need every host allow-listed */}
        <img
          src={image.url}
          alt={image.altText ?? ""}
          sizes={sizes}
          loading={variant === "lead" ? "eager" : "lazy"}
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-500 hover:scale-[1.02]"
        />
      </Link>
    ) : null;

  if (variant === "lead") {
    return (
      <li className="flex flex-col gap-5">
        {picture("aspect-[16/9] w-full", "(min-width: 1024px) 720px, 100vw")}
        <div className="flex flex-col gap-3">
          {kicker}
          <h2 className="headline text-[34px] leading-[1.08] sm:text-[44px]">
            <Link href={href} className="hover:underline decoration-line-strong underline-offset-4">
              {article.title}
            </Link>
          </h2>
          {article.dek && (
            <p className="font-serif text-lg leading-snug text-ink-2 sm:text-xl">{article.dek}</p>
          )}
          {byline}
        </div>
      </li>
    );
  }

  if (variant === "featured") {
    return (
      <li className="flex flex-col gap-3">
        {picture("aspect-[3/2] w-full", "(min-width: 768px) 400px, 100vw") ?? (
          // Keeps the grid aligned when a story has no cover: a quiet
          // block with the section name, rather than a jump in height.
          <div
            aria-hidden="true"
            className="flex aspect-[3/2] w-full items-center justify-center rounded-md bg-surface-2 font-serif text-2xl text-ink-3 italic"
          >
            {article.category?.name ?? "The Dispatch"}
          </div>
        )}
        {kicker}
        <h2 className="headline text-2xl leading-tight">
          <Link href={href} className="hover:underline decoration-line-strong underline-offset-4">
            {article.title}
          </Link>
        </h2>
        {article.dek && <p className="line-clamp-3 text-sm leading-relaxed text-ink-2">{article.dek}</p>}
        {byline}
      </li>
    );
  }

  if (variant === "compact") {
    return (
      <li className="flex flex-col gap-1.5">
        {kicker}
        <h3 className="headline text-lg leading-snug">
          <Link href={href} className="hover:underline decoration-line-strong underline-offset-4">
            {article.title}
          </Link>
        </h3>
        {byline}
      </li>
    );
  }

  return (
    <li className="flex gap-5">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {kicker}
        <h2 className="headline text-[22px] leading-snug">
          <Link href={href} className="hover:underline decoration-line-strong underline-offset-4">
            {article.title}
          </Link>
        </h2>
        {article.dek && <p className="line-clamp-2 text-[15px] leading-relaxed text-ink-2">{article.dek}</p>}
        {byline}
      </div>
      {picture("aspect-[4/3] w-24 shrink-0 self-start sm:w-40", "160px")}
    </li>
  );
}
