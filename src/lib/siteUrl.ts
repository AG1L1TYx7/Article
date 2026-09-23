/**
 * The site's public origin and name.
 *
 * Synchronous and environment-based, deliberately. The request-derived
 * `getBaseUrl()` in lib/url.ts cannot be used here: `metadataBase`,
 * `sitemap.ts` and `robots.ts` are evaluated where there is no request to
 * read a Host header from, and a sitemap that changed depending on which
 * hostname fetched it would be wrong anyway.
 *
 * Falls back to NEXTAUTH_URL, which every deployment already has to set to
 * the real public origin, so there is one fewer variable to get wrong.
 */
export const SITE_NAME = "Dispatch Report";

export const SITE_DESCRIPTION =
  "Reporting and analysis on politics, world affairs, business, technology, culture and sport.";

export function siteUrl(): URL {
  const raw =
    process.env.SITE_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  try {
    return new URL(raw);
  } catch {
    // A malformed value must not take the whole site down at import time.
    return new URL("http://localhost:3000");
  }
}

/** An absolute URL for `path`, for feeds, sitemaps and share cards. */
export function absoluteUrl(path: string): string {
  return new URL(path, siteUrl()).toString();
}
