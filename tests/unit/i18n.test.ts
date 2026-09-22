import { describe, expect, test } from "vitest";
import { LOCALES } from "@/i18n/config";
import { negotiateLocale, parseAcceptLanguage } from "@/i18n/negotiate";
import { flatten, interpolate, makeI18n } from "@/i18n/t";
import { MESSAGES } from "@/i18n/messages";
import { en } from "@/i18n/messages/en";
import { es } from "@/i18n/messages/es";

describe("negotiateLocale", () => {
  test("an explicit cookie wins over the browser", () => {
    expect(negotiateLocale("es", "en-GB,en;q=0.9")).toBe("es");
  });

  test("a cookie for a language no longer offered falls through", () => {
    expect(negotiateLocale("fr", "es-ES")).toBe("es");
  });

  test("Accept-Language is honoured by weight, matching region tags to the base language", () => {
    expect(negotiateLocale(null, "fr-FR,es-MX;q=0.8,en;q=0.5")).toBe("es");
    expect(negotiateLocale(null, "es;q=0.3,en;q=0.9")).toBe("en");
  });

  test("nothing usable means the default", () => {
    expect(negotiateLocale(undefined, undefined)).toBe("en");
    expect(negotiateLocale(null, "*")).toBe("en");
    expect(negotiateLocale(null, "zz-ZZ")).toBe("en");
  });

  test("parseAcceptLanguage keeps header order for equal weights and drops q=0", () => {
    expect(parseAcceptLanguage("en-GB, en;q=1, fr;q=0, es;q=0.5")).toEqual(["en-GB", "en", "es"]);
    expect(parseAcceptLanguage("")).toEqual([]);
  });
});

describe("dictionaries", () => {
  const enKeys = Object.keys(flatten(en)).sort();

  test.each(LOCALES)("%s has exactly the keys English has", (locale) => {
    expect(Object.keys(MESSAGES[locale]).sort()).toEqual(enKeys);
  });

  test("every translation keeps the placeholders of its English source", () => {
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    const esFlat = flatten(es);
    for (const [key, english] of Object.entries(flatten(en))) {
      expect(placeholders(esFlat[key]!), `placeholders in ${key}`).toEqual(placeholders(english));
    }
  });

  test("no translation is left in English by accident", () => {
    // Brand names, codes and the deletion phrase are the same in both by
    // design; anything else identical is a missed translation.
    const allowed = new Set([
      "common.siteName",
      "account.deletePhrase",
    ]);
    const enFlat = flatten(en);
    const same = Object.entries(flatten(es))
      .filter(([key, value]) => enFlat[key] === value && !allowed.has(key))
      .map(([key]) => key);
    expect(same).toEqual([]);
  });
});

describe("interpolate", () => {
  test("fills placeholders and leaves unknown ones visible", () => {
    expect(interpolate("Hello {name}, {missing}", { name: "Ada" })).toBe("Hello Ada, {missing}");
  });
});

describe("makeI18n", () => {
  const english = makeI18n("en", MESSAGES.en);
  const spanish = makeI18n("es", MESSAGES.es);

  test("translates by key with variables", () => {
    expect(english.t("article.moreFrom", { section: "Sport" })).toBe("More from Sport");
    expect(spanish.t("article.moreFrom", { section: "Deportes" })).toBe("Más de Deportes");
  });

  test("picks the plural form and formats the count for the locale", () => {
    expect(english.n(1, "common.articles")).toBe("1 article");
    expect(english.n(2, "common.articles")).toBe("2 articles");
    expect(spanish.n(1, "common.articles")).toBe("1 artículo");
    expect(spanish.n(3, "common.articles")).toBe("3 artículos");
    // Spanish groups thousands with a point.
    expect(spanish.formatNumber(1284930)).toBe("1.284.930");
  });

  test("a missing key shows the key rather than nothing", () => {
    const sparse = makeI18n("en", {});
    // Cast: the point is what happens when a dictionary is incomplete.
    expect(sparse.t("home.moreStories" as never)).toBe("home.moreStories");
  });

  test("dates are formatted in UTC for both languages", () => {
    const date = new Date("2026-09-20T23:30:00Z");
    expect(english.formatDate(date)).toBe("20 Sept 2026");
    expect(spanish.formatDate(date)).toMatch(/20 sept 2026/);
  });

  test("relative times read naturally", () => {
    const now = new Date("2026-09-20T12:00:00Z");
    expect(english.formatRelative(new Date("2026-09-20T11:59:30Z"), now)).toBe("just now");
    expect(english.formatRelative(new Date("2026-09-20T11:30:00Z"), now)).toBe("30 min ago");
    expect(english.formatRelative(new Date("2026-09-20T09:00:00Z"), now)).toBe("3 hrs ago");
    expect(english.formatRelative(new Date("2026-09-18T12:00:00Z"), now)).toBe("2 days ago");
    expect(spanish.formatRelative(new Date("2026-09-20T09:00:00Z"), now)).toBe("hace 3 h");
    expect(spanish.formatRelative(new Date("2026-09-19T12:00:00Z"), now)).toBe("hace 1 día");
  });
});
