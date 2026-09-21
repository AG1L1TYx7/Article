import { cache } from "react";
import { headers } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_HEADER, isLocale, type Locale } from "./config";
import { MESSAGES } from "./messages";
import { makeI18n, type I18n } from "./t";

/**
 * The request's language, on the server.
 *
 * src/proxy.ts decides it (cookie, then Accept-Language) and passes it
 * down as a request header, so every server component, layout and
 * generateMetadata reads the same answer without re-negotiating. Routes
 * the proxy does not cover (/api, /media) fall back to the default.
 *
 * cache() makes this one headers() read per request however many
 * components ask.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  const h = await headers();
  const value = h.get(LOCALE_HEADER);
  return isLocale(value) ? value : DEFAULT_LOCALE;
});

/** The translator for this request. */
export const getI18n = cache(async (): Promise<I18n> => {
  const locale = await getLocale();
  return makeI18n(locale, MESSAGES[locale]);
});
