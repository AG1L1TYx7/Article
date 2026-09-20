import Link from "next/link";
import { TagIcon } from "@/components/icons";
import { formatDate, initials } from "@/lib/format";
import { imageSrcSet, imageVariantUrl } from "@/lib/imageUrl";

/**
 * The pieces of a rendered article, shared by the public page and the
 * newsroom preview so a draft looks exactly as it will when it is live.
 * Server-safe: no hooks, no client state. Interactive parts (share,
 * engagement, comments) are slotted in by the page around these.
 */

export function ArticleHeader({
  title,
  dek,
  isBreaking,
  category,
  author,
  publishedAt,
  updatedAt,
  minutes,
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
  /** Rendered at the right of the byline row — the share links, usually. */
  aside?: React.ReactNode;
}) {
  return (
    <header className="mx-auto max-w-3xl px-4 pt-10 sm:px-6 sm:pt-14">
      <div className="flex items-center gap-2">
        {isBreaking && <span className="badge-breaking">Breaking</span>}
        {category && (
          <Link href={`/category/${category.slug}`} className="eyebrow hover:underline">
            {category.name}
          </Link>
        )}
      </div>
      <h1 className="headline mt-4 text-[36px] leading-[1.06] sm:text-[52px]">{title}</h1>
      {dek && <p className="mt-5 font-serif text-xl leading-snug text-ink-2 sm:text-2xl">{dek}</p>}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border-y border-line py-4">
        <div className="flex items-center gap-3">
          <span className="avatar h-10 w-10 text-sm">{initials(author.name)}</span>
          <div className="text-sm">
            <p>
              <span className="text-ink-3">By </span>
              <Link href={`/author/${author.handle}`} className="font-medium text-ink hover:underline">
                {author.name}
              </Link>
            </p>
            <p className="text-xs text-ink-3">
              {publishedAt ? (
                <time dateTime={publishedAt.toISOString()}>{formatDate(publishedAt)}</time>
              ) : (
                <span>Not yet published</span>
              )}
              <span aria-hidden="true"> · </span>
              {minutes} min read
              {updatedAt && (
                <>
                  <span aria-hidden="true"> · </span>
                  <span className="text-ink-2">
                    Updated <time dateTime={updatedAt.toISOString()}>{formatDate(updatedAt)}</time>
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
 */
export function ArticleBody({ html }: { html: string }) {
  return <div className="prose prose-article mt-10 max-w-none" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function ArticleTags({ tags }: { tags: { slug: string; name: string }[] }) {
  if (tags.length === 0) return null;
  return (
    <ul className="mt-10 flex flex-wrap items-center gap-2" aria-label="Tags">
      <li className="flex items-center gap-1 text-xs font-medium tracking-wide text-ink-3 uppercase">
        <TagIcon size={12} /> Tagged
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
