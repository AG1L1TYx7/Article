import { describe, expect, test } from "vitest";
import {
  isDateRange,
  parseSearchParams,
  rangeToSince,
  searchHref,
} from "@/lib/searchParams";

describe("parseSearchParams", () => {
  test("reads a plain query", () => {
    expect(parseSearchParams({ q: "budget vote" })).toEqual({
      q: "budget vote",
      category: "",
      author: "",
      range: "",
      page: 1,
    });
  });

  test("takes the first value when a parameter is repeated", () => {
    // ?q=a&q=b is trivially producible by hand; it must not become "a,b".
    expect(parseSearchParams({ q: ["first", "second"] }).q).toBe("first");
  });

  test("falls back to no date filter for an unknown range", () => {
    expect(parseSearchParams({ range: "since-the-dawn-of-time" }).range).toBe("");
  });

  test("rejects nonsense page numbers instead of passing them to SQL", () => {
    expect(parseSearchParams({ page: "0" }).page).toBe(1);
    expect(parseSearchParams({ page: "-5" }).page).toBe(1);
    expect(parseSearchParams({ page: "not a number" }).page).toBe(1);
    // Capped, so a hand-edited URL can't request a million-row offset.
    expect(parseSearchParams({ page: "999999" }).page).toBe(500);
  });

  test("bounds filter values", () => {
    expect(parseSearchParams({ author: "x".repeat(200) }).author).toHaveLength(60);
  });

  test("handles a completely empty query string", () => {
    expect(parseSearchParams({})).toEqual({ q: "", category: "", author: "", range: "", page: 1 });
  });
});

describe("rangeToSince", () => {
  const now = new Date("2026-06-15T12:00:00Z");

  test("no range means no lower bound", () => {
    expect(rangeToSince("", now)).toBeUndefined();
  });

  test("past week is seven days back", () => {
    expect(rangeToSince("week", now)?.toISOString()).toBe("2026-06-08T12:00:00.000Z");
  });

  test("past 24 hours is a day back", () => {
    expect(rangeToSince("24h", now)?.toISOString()).toBe("2026-06-14T12:00:00.000Z");
  });
});

describe("isDateRange", () => {
  test("accepts the offered ranges only", () => {
    expect(isDateRange("month")).toBe(true);
    expect(isDateRange("fortnight")).toBe(false);
  });
});

describe("searchHref", () => {
  test("omits empty filters", () => {
    expect(searchHref({ q: "vote", category: "", author: "", range: "", page: 1 })).toBe(
      "/search?q=vote"
    );
  });

  test("keeps filters across pagination", () => {
    expect(
      searchHref({ q: "vote", category: "politics", author: "ada", range: "week", page: 3 })
    ).toBe("/search?q=vote&category=politics&author=ada&range=week&page=3");
  });

  test("page 1 is implicit", () => {
    expect(searchHref({ q: "vote", page: 1 })).toBe("/search?q=vote");
  });

  test("escapes characters that would otherwise break the URL", () => {
    expect(searchHref({ q: 'a "quoted" phrase & more' })).toBe(
      "/search?q=a+%22quoted%22+phrase+%26+more"
    );
  });
});
