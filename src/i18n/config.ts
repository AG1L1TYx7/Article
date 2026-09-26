/**
 * The languages the interface speaks.
 *
 * Adding one is three steps — see docs/i18n.md: add it here, add a
 * messages file with every key of messages/en.ts (the type checker
 * refuses anything less), and translate. Nothing else in the codebase
 * lists locales.
 *
 * The UI language and an article's language are separate things. The UI
 * follows the reader (cookie, then Accept-Language); each article carries
 * its own `locale` and links to its translations. A Nepali reader on an
 * English-only site sees Nepali chrome around English stories, which is
 * the honest state of affairs rather than an empty front page.
 *
 * Spanish (messages/es.ts) was carried here briefly and is shelved rather
 * than lost: it stays in history on main, and restoring it is this list
 * plus the four maps below plus an import in messages/index.ts.
 */
export const LOCALES = ["en", "ne"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** How each language names itself, for the switcher. Never translated. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  ne: "नेपाली",
};

/** The BCP 47 tag handed to Intl for dates and numbers. */
export const INTL_LOCALE: Record<Locale, string> = {
  en: "en-GB",
  ne: "ne-NP",
};

/** Text direction, for <html dir>. Both current languages read left to right. */
export const LOCALE_DIR: Record<Locale, "ltr" | "rtl"> = {
  en: "ltr",
  ne: "ltr",
};

/** The Open Graph locale code, which uses an underscore. */
export const OG_LOCALE: Record<Locale, string> = {
  en: "en_GB",
  ne: "ne_NP",
};

export const LOCALE_COOKIE = "locale";
export const LOCALE_HEADER = "x-locale";
/** A year: a language choice is not something to ask about twice. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
