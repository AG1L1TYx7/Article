import { DEFAULT_LOCALE, isLocale, type Locale } from "./config";

/**
 * Decides which language to speak to a request. Pure, so it is unit
 * tested without a request.
 *
 * Order of precedence:
 *   1. The locale cookie — an explicit choice from the switcher.
 *   2. Accept-Language — what the browser is set to, honouring q-weights
 *      and matching "es-ES" to "es".
 *   3. The default.
 *
 * A cookie holding a language that is no longer offered falls through
 * rather than erroring, so removing a locale never breaks a returning
 * reader.
 */
export function negotiateLocale(cookie: string | null | undefined, acceptLanguage: string | null | undefined): Locale {
  if (isLocale(cookie)) return cookie;

  for (const tag of parseAcceptLanguage(acceptLanguage)) {
    const base = tag.toLowerCase().split("-")[0];
    if (isLocale(base)) return base;
  }

  return DEFAULT_LOCALE;
}

/** Language tags from an Accept-Language header, best first. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="));
      const weight = q ? Number.parseFloat(q.slice(2)) : 1;
      return { tag: (tag ?? "").trim(), weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((entry) => entry.tag && entry.tag !== "*" && entry.weight > 0)
    // Stable: equal weights keep the header's own order.
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
    .map((entry) => entry.tag);
}
