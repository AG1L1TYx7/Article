/**
 * Turns raw request facts into the coarse buckets the analytics keep.
 *
 * Pure functions with no database import, so they can be unit-tested and
 * so the privacy argument is easy to check: everything stored comes out
 * of one of these, and none of them returns anything finer than a
 * two-letter country code, a referrer class or bare host, or a device
 * class.
 */

export type Dimension = "country" | "referrer" | "device";

export interface ViewContext {
  /** ISO 3166-1 alpha-2, upper case, or "unknown". */
  country: string;
  /** "direct" | "search" | "social" | "internal" | "app" | a bare referring host. */
  referrer: string;
  /** "mobile" | "tablet" | "desktop" | "bot". */
  device: string;
}

/**
 * Country comes from whatever sits in front of the app, never from a
 * lookup we do ourselves against the IP (which would mean keeping it):
 * Cloudflare sets CF-IPCountry on every request, Vercel sets
 * X-Vercel-IP-Country, cPanel hosts with mod_geoip set GEOIP_COUNTRY_CODE,
 * and GEO_COUNTRY_HEADER names any other. With none of those, "unknown".
 */
const COUNTRY_HEADERS = [
  process.env.GEO_COUNTRY_HEADER,
  "cf-ipcountry",
  "x-vercel-ip-country",
  "x-country-code",
  "geoip_country_code",
  "x-geoip-country",
].filter((h): h is string => !!h);

export function countryFrom(get: (name: string) => string | null | undefined): string {
  for (const header of COUNTRY_HEADERS) {
    const value = get(header)?.trim().toUpperCase();
    // XX and T1 are Cloudflare's "unknown" and "Tor" placeholders.
    if (value && /^[A-Z]{2}$/.test(value) && value !== "XX" && value !== "T1") return value;
  }
  return "unknown";
}

const SEARCH_HOSTS =
  /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|yahoo\.com|yandex\.[a-z]+|baidu\.com|ecosia\.org|search\.brave\.com|startpage\.com)$/i;
const SOCIAL_HOSTS =
  /(^|\.)(facebook\.com|fb\.com|t\.co|twitter\.com|x\.com|instagram\.com|linkedin\.com|reddit\.com|threads\.net|bsky\.app|mastodon\.[a-z]+|tiktok\.com|youtube\.com|pinterest\.[a-z]+|whatsapp\.com|telegram\.org|news\.ycombinator\.com)$/i;

/** The Referer header, reduced to a class or a bare host. Path and query never survive. */
export function classifyReferrer(referer: string | null | undefined, ownHost: string): string {
  if (!referer) return "direct";
  let host: string;
  try {
    host = new URL(referer).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "direct";
  }
  if (!host) return "direct";
  if (host === ownHost.toLowerCase().replace(/^www\./, "").replace(/:\d+$/, "") || host === "localhost") return "internal";
  if (SEARCH_HOSTS.test(host)) return "search";
  if (SOCIAL_HOSTS.test(host)) return "social";
  // Android apps and some mail clients arrive as android-app://… — a
  // host, but not a site anyone can visit.
  if (host.startsWith("android-app")) return "app";
  return host.slice(0, 80);
}

const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|preview|fetch|curl|wget|python-requests|headless|lighthouse|pingdom|uptime/i;

/** A coarse device class from the user agent: enough to plan a layout by. */
export function deviceFrom(userAgent: string | null | undefined): string {
  if (!userAgent) return "desktop";
  if (BOT_UA.test(userAgent)) return "bot";
  if (/iPad|Tablet|Kindle|Silk|PlayBook/i.test(userAgent) || (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent))) return "tablet";
  if (/Mobi|iPhone|Android|Windows Phone|webOS|BlackBerry/i.test(userAgent)) return "mobile";
  return "desktop";
}
