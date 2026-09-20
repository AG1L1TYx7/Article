/**
 * Pulling a title, description and site name out of fetched HTML.
 *
 * Regex rather than a DOM parser, deliberately: the input is a remote
 * page of unknown quality and possible hostility, this only ever reads a
 * handful of `<meta>` tags out of the first part of the document, and
 * every value is escaped as text when rendered. Adding a full parser
 * would be more code running over attacker-supplied input, not less.
 *
 * Nothing here is trusted. Values are stripped of markup, length-capped
 * and rendered as text — never as HTML.
 */

export interface LinkMetadata {
  title: string | null;
  description: string | null;
  siteName: string | null;
}

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 400;
const MAX_SITE_NAME = 100;

/** The entities that actually turn up in titles, plus numeric ones. */
function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => safeCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => safeCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    // Ampersand last, so "&amp;lt;" decodes to the text "&lt;" rather than
    // to a "<" that was never in the original.
    .replace(/&amp;/gi, "&");
}

function safeCodePoint(code: number): string {
  // Control characters and anything outside the Unicode range are dropped
  // rather than emitted.
  if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return "";
  if (code >= 0x7f && code <= 0x9f) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function clean(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  const text = decodeEntities(value)
    // Any stray markup in an attribute is removed, not rendered.
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * Reads one `<meta>` value, matching on either attribute order.
 *
 * `<meta property="og:title" content="…">` and
 * `<meta content="…" property="og:title">` are both common in the wild.
 */
function metaContent(html: string, names: string[]): string | null {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(
        `<meta[^>]+(?:property|name)\\s*=\\s*["']${escaped}["'][^>]*?content\\s*=\\s*["']([^"']*)["']`,
        "i"
      ),
      new RegExp(
        `<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*?(?:property|name)\\s*=\\s*["']${escaped}["']`,
        "i"
      ),
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(html);
      if (match?.[1]) return match[1];
    }
  }
  return null;
}

export function parseLinkMetadata(html: string): LinkMetadata {
  // Only the head is of interest, and stopping there avoids scanning a
  // megabyte of body markup with several regexes.
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd === -1 ? html.slice(0, 64 * 1024) : html.slice(0, headEnd);

  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];

  return {
    // og:title is what the publisher wants shown; <title> often carries a
    // site name bolted on the end.
    title: clean(metaContent(head, ["og:title", "twitter:title"]) ?? titleTag, MAX_TITLE),
    description: clean(
      metaContent(head, ["og:description", "twitter:description", "description"]),
      MAX_DESCRIPTION
    ),
    siteName: clean(metaContent(head, ["og:site_name", "application-name"]), MAX_SITE_NAME),
  };
}
