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
export function RelatedLinks({ links }: { links: RelatedLink[] }) {
  if (links.length === 0) return null;

  return (
    <section className="mt-12">
      <h2 className="text-lg font-semibold">Related links</h2>
      <ul className="mt-4 flex flex-col gap-3">
        {links.map((link) => (
          <li key={link.id}>
            <a
              href={link.url}
              rel="nofollow noopener noreferrer"
              target="_blank"
              className="block rounded-md border border-neutral-200 px-4 py-3 hover:border-neutral-400"
            >
              <p className="text-sm font-medium text-neutral-900">
                {link.label || link.title || link.url}
              </p>
              {link.description && (
                <p className="mt-1 line-clamp-2 text-sm text-neutral-600">{link.description}</p>
              )}
              <p className="mt-1 truncate text-xs text-neutral-500">
                {link.siteName ?? new URL(link.url).hostname}
              </p>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
