import { describe, expect, test } from "vitest";
import { LOCALES } from "@/i18n/config";
import { negotiateLocale, parseAcceptLanguage } from "@/i18n/negotiate";
import { flatten, interpolate, makeI18n } from "@/i18n/t";
import { MESSAGES } from "@/i18n/messages";
import { en } from "@/i18n/messages/en";
import { ne } from "@/i18n/messages/ne";

describe("negotiateLocale", () => {
  test("an explicit cookie wins over the browser", () => {
    expect(negotiateLocale("ne", "en-GB,en;q=0.9")).toBe("ne");
  });

  test("a cookie for a language no longer offered falls through", () => {
    expect(negotiateLocale("fr", "ne-NP")).toBe("ne");
  });

  test("Accept-Language is honoured by weight, matching region tags to the base language", () => {
    expect(negotiateLocale(null, "fr-FR,ne-NP;q=0.8,en;q=0.5")).toBe("ne");
    expect(negotiateLocale(null, "ne;q=0.3,en;q=0.9")).toBe("en");
  });

  test("nothing usable means the default", () => {
    expect(negotiateLocale(undefined, undefined)).toBe("en");
    expect(negotiateLocale(null, "*")).toBe("en");
    expect(negotiateLocale(null, "zz-ZZ")).toBe("en");
  });

  test("parseAcceptLanguage keeps header order for equal weights and drops q=0", () => {
    expect(parseAcceptLanguage("en-GB, en;q=1, fr;q=0, ne;q=0.5")).toEqual(["en-GB", "en", "ne"]);
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
    const neFlat = flatten(ne);
    for (const [key, english] of Object.entries(flatten(en))) {
      expect(placeholders(neFlat[key]!), `placeholders in ${key}`).toEqual(placeholders(english));
    }
  });

  test("no translation is left in English by accident", () => {
    // Brand names, codes and the deletion phrase are the same in both by
    // design; anything else identical is a missed translation.
    const allowed = new Set([
      "common.siteName",
      "account.deletePhrase",
      "account.twoFactorOn",
      "account.twoFactorOff",
    ]);
    const enFlat = flatten(en);
    const same = Object.entries(flatten(ne))
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
  const nepali = makeI18n("ne", MESSAGES.ne);

  test("translates by key with variables", () => {
    expect(english.t("article.moreFrom", { section: "Sport" })).toBe("More from Sport");
    expect(nepali.t("article.moreFrom", { section: "खेलकुद" })).toBe("खेलकुद विभागबाट थप");
  });

  test("picks the plural form and formats the count for the locale", () => {
    expect(english.n(1, "common.articles")).toBe("1 article");
    expect(english.n(2, "common.articles")).toBe("2 articles");
    // Nepali counts in its own digits.
    expect(nepali.n(3, "common.articles")).toBe("३ लेख");
  });

  test("a missing key shows the key rather than nothing", () => {
    const sparse = makeI18n("en", {});
    // Cast: the point is what happens when a dictionary is incomplete.
    expect(sparse.t("home.moreStories" as never)).toBe("home.moreStories");
  });

  test("dates are formatted in UTC for both languages", () => {
    const date = new Date("2026-09-20T23:30:00Z");
    expect(english.formatDate(date)).toBe("20 Sept 2026");
    expect(nepali.formatDate(date)).toContain("२०२६");
  });

  test("relative times read naturally", () => {
    const now = new Date("2026-09-20T12:00:00Z");
    expect(english.formatRelative(new Date("2026-09-20T11:59:30Z"), now)).toBe("just now");
    expect(english.formatRelative(new Date("2026-09-20T11:30:00Z"), now)).toBe("30 min ago");
    expect(english.formatRelative(new Date("2026-09-20T09:00:00Z"), now)).toBe("3 hrs ago");
    expect(english.formatRelative(new Date("2026-09-18T12:00:00Z"), now)).toBe("2 days ago");
    expect(nepali.formatRelative(new Date("2026-09-20T09:00:00Z"), now)).toBe("३ घण्टा अघि");
  });
});
