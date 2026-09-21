"use client";

import { createContext, useContext, useMemo } from "react";
import { DEFAULT_LOCALE, type Locale } from "./config";
import { makeI18n, type FlatMessages, type I18n } from "./t";

/**
 * The translator for client components.
 *
 * The root layout hands the current locale and its dictionary to this
 * provider once per page; `useI18n()` then costs nothing per component.
 * The dictionary for one language is a few kilobytes — far cheaper than
 * a request per string, and it means a client component renders the
 * same text on the server and on the client, so no hydration mismatch.
 */
const I18nContext = createContext<{ locale: Locale; messages: FlatMessages }>({
  locale: DEFAULT_LOCALE,
  messages: {},
});

export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: FlatMessages;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ locale, messages }), [locale, messages]);
  return <I18nContext value={value}>{children}</I18nContext>;
}

export function useI18n(): I18n {
  const { locale, messages } = useContext(I18nContext);
  return useMemo(() => makeI18n(locale, messages), [locale, messages]);
}
