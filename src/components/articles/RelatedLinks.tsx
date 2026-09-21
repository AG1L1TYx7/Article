import { ExternalIcon } from "@/components/icons";
import { getI18n } from "@/i18n/server";

export interface RelatedLink {
  id: string;
  url: string;
  label: string | null;
  title: string | null;
  description: string | null;
  siteName: string | null;
}

/**
 * Links an author attached to an article, with whatever the linked page
 * said about itself.
 *
 * Every field here is a cached copy of a remote page's own markup, so it
 * is rendered as text — React escapes it — and never as HTML. The link
 * itself carries rel="nofollow noopener noreferrer": nofollow because an
 * author shouldn't be able to pass this site's ranking to an arbitrary
 * page, noreferrer so a reader's path through this site isn't handed to
 * whoever is on the other end.
 */
export async function RelatedLinks({ links }: { links: RelatedLink[] }) {
  if (links.length === 0) return null;
  const { t } = await getI18n();

  return (
    <section className="mt-12" aria-labelledby="related-links-heading">
      <h2 id="related-links-heading" className="section-title">
        {t("article.relatedLinks")}
      </h2>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2">
        {links.map((link) => (
          <li key={link.id}>
            <a
              href={link.url}
              rel="nofollow noopener noreferrer"
              target="_blank"
              className="card card-hover flex h-full flex-col gap-1 px-4 py-3"
            >
              <p className="flex items-start justify-between gap-3 text-sm font-medium text-ink">
                <span className="line-clamp-2">{link.label || link.title || link.url}</span>
                <ExternalIcon size={14} className="mt-0.5 shrink-0 text-ink-3" />
              </p>
              {link.description && (
                <p className="line-clamp-2 text-sm text-ink-2">{link.description}</p>
              )}
              <p className="mt-auto truncate pt-1 text-xs text-ink-3">
                {link.siteName ?? new URL(link.url).hostname}
              </p>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
