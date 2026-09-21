import { INTL_LOCALE, type Locale } from "./config";
import { en } from "./messages/en";

/**
 * The translator. Pure and framework-free: the same function runs in
 * server components, client components and unit tests.
 *
 * Messages are a nested object of strings (messages/en.ts is the source
 * of truth and the type every other language must satisfy). Keys are
 * dotted paths, checked at compile time — a typo in `t("nav.latst")` is
 * a type error, not a blank label in production.
 *
 * Interpolation is `{name}`. Plurals are two sibling keys, `.one` and
 * `.other`, chosen with Intl.PluralRules for the locale; `{count}` in
 * them is formatted with the locale's digits.
 */

/** English's shape with every literal widened to string, so translations can differ in value. */
type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type Messages = Widen<typeof en>;

type Leaves<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<Messages>;

/** Keys that come in `.one` / `.other` pairs. */
export type PluralKey = MessageKey extends infer K
  ? K extends `${infer Base}.one`
    ? Base
    : never
  : never;

export type Vars = Record<string, string | number>;

export type FlatMessages = Record<string, string>;

export function flatten(tree: object, prefix = "", out: FlatMessages = {}): FlatMessages {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else if (value && typeof value === "object") flatten(value, path, out);
  }
  return out;
}

export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  );
}

export interface I18n {
  locale: Locale;
  /** A message by key, with `{placeholders}` filled in. */
  t: (key: MessageKey, vars?: Vars) => string;
  /** A count with its noun: `n(3, "comments")` → "3 comments" / "1 comment". */
  n: (count: number, key: PluralKey, vars?: Vars) => string;
  formatNumber: (value: number) => string;
  formatDate: (value: Date | string | null | undefined) => string;
  formatDateTime: (value: Date | string | null | undefined) => string;
  formatLongDate: (value: Date | string) => string;
  /** "3 min ago" style, falling back to the date once it is old enough. */
  formatRelative: (value: Date | string, now?: Date) => string;
}

const formatterCache = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat | Intl.PluralRules>();

function cached<T extends Intl.DateTimeFormat | Intl.NumberFormat | Intl.PluralRules>(key: string, make: () => T): T {
  let f = formatterCache.get(key) as T | undefined;
  if (!f) {
    f = make();
    formatterCache.set(key, f);
  }
  return f;
}

const toDate = (value: Date | string) => (typeof value === "string" ? new Date(value) : value);

/**
 * Builds the translator for one locale over one (flattened) dictionary.
 *
 * Every formatter pins the UTC time zone, for the same reason lib/format.ts
 * does: the server and the reader's browser must print the same string,
 * or React reports a hydration mismatch on every date.
 */
export function makeI18n(locale: Locale, messages: FlatMessages): I18n {
  const tag = INTL_LOCALE[locale];
  const number = cached(`${tag}:number`, () => new Intl.NumberFormat(tag)) as Intl.NumberFormat;
  const plurals = cached(`${tag}:plural`, () => new Intl.PluralRules(tag)) as Intl.PluralRules;
  const date = cached(
    `${tag}:date`,
    () => new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
  ) as Intl.DateTimeFormat;
  const dateTime = cached(
    `${tag}:datetime`,
    () =>
      new Intl.DateTimeFormat(tag, {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
      })
  ) as Intl.DateTimeFormat;
  const longDate = cached(
    `${tag}:long`,
    () => new Intl.DateTimeFormat(tag, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
  ) as Intl.DateTimeFormat;

  const t: I18n["t"] = (key, vars) => {
    const template = messages[key];
    // A missing key is a bug in a translation file; the key itself is
    // shown so it is findable, rather than an empty string that hides it.
    if (template === undefined) return key;
    return interpolate(template, vars);
  };

  const n: I18n["n"] = (count, key, vars) => {
    const form = plurals.select(count);
    const template = messages[`${key}.${form}`] ?? messages[`${key}.other`] ?? `${key}.other`;
    return interpolate(template, { count: number.format(count), ...vars });
  };

  const formatDate: I18n["formatDate"] = (value) => (value ? date.format(toDate(value)) : "");
  const formatDateTime: I18n["formatDateTime"] = (value) => (value ? dateTime.format(toDate(value)) : "");
  const formatLongDate: I18n["formatLongDate"] = (value) => longDate.format(toDate(value));

  const formatRelative: I18n["formatRelative"] = (value, now = new Date()) => {
    const seconds = Math.round((now.getTime() - toDate(value).getTime()) / 1000);
    if (seconds < 60) return t("time.justNow");
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return n(minutes, "time.minutesAgo");
    const hours = Math.round(minutes / 60);
    if (hours < 24) return n(hours, "time.hoursAgo");
    const days = Math.round(hours / 24);
    if (days < 7) return n(days, "time.daysAgo");
    return formatDate(value);
  };

  return {
    locale,
    t,
    n,
    formatNumber: (value) => number.format(value),
    formatDate,
    formatDateTime,
    formatLongDate,
    formatRelative,
  };
}
