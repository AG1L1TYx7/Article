import { SITE_DESCRIPTION, SITE_NAME, absoluteUrl } from "@/lib/siteUrl";

/**
 * Builds the RSS feed.
 *
 * Separate from the route so the XML generation — and especially the
 * escaping — can be tested without standing up a request.
 */

export interface FeedItem {
  slug: string;
  title: string;
  summary: string | null;
  publishedAt: Date | null;
  authorName: string;
  categoryName: string | null;
  /** The story's audio, offered as a podcast-style enclosure. */
  enclosure?: { url: string; length: number; type: string } | null;
}

/**
 * Escapes text for XML character data.
 *
 * Not optional politeness: a headline containing `&` or `<` produces a
 * malformed document, and every feed reader rejects the whole feed rather
 * than skipping the item — one apostrophe in one headline would silently
 * take the entire feed offline for every subscriber.
 *
 * Ampersand is replaced first. Doing it last would re-escape the
 * ampersands introduced by the other replacements, turning `<` into
 * `&amp;lt;`.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Characters XML 1.0 does not allow at all, at any escaping. They
    // reach here from pasted copy often enough to be worth stripping
    // rather than emitting an unparseable document.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/** RFC 822, which is what the RSS 2.0 spec requires for pubDate. */
function rfc822(date: Date): string {
  return date.toUTCString();
}

export function buildRssFeed(items: FeedItem[], now = new Date()): string {
  const latest = items[0]?.publishedAt ?? now;

  const entries = items
    .map((item) => {
      const url = absoluteUrl(`/article/${item.slug}`);
      return [
        "    <item>",
        `      <title>${escapeXml(item.title)}</title>`,
        `      <link>${escapeXml(url)}</link>`,
        // A stable identifier for "have I already shown this?". The URL
        // works because slugs are unique and an article keeps its own.
        `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
        item.publishedAt ? `      <pubDate>${rfc822(item.publishedAt)}</pubDate>` : null,
        `      <dc:creator>${escapeXml(item.authorName)}</dc:creator>`,
        item.categoryName ? `      <category>${escapeXml(item.categoryName)}</category>` : null,
        item.summary ? `      <description>${escapeXml(item.summary)}</description>` : null,
        item.enclosure
          ? `      <enclosure url="${escapeXml(item.enclosure.url)}" length="${item.enclosure.length}" type="${escapeXml(item.enclosure.type)}" />`
          : null,
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  // Summaries rather than full article bodies, on purpose. Publishing the
  // whole article as HTML inside the feed means escaping author-supplied
  // markup into a document rendered by dozens of feed readers of varying
  // quality, for no benefit to the publication.
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(SITE_NAME)}</title>
    <link>${escapeXml(absoluteUrl("/"))}</link>
    <description>${escapeXml(SITE_DESCRIPTION)}</description>
    <language>en</language>
    <lastBuildDate>${rfc822(latest instanceof Date ? latest : now)}</lastBuildDate>
    <atom:link href="${escapeXml(absoluteUrl("/feed.xml"))}" rel="self" type="application/rss+xml" />
${entries}
  </channel>
</rss>
`;
}
