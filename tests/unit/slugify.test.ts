import { describe, expect, test } from "vitest";
import { slugify } from "@/lib/slugify";

describe("slugify", () => {
  test("lowercases and hyphenates", () => {
    expect(slugify("Breaking News Today")).toBe("breaking-news-today");
  });

  test("strips accents", () => {
    expect(slugify("Café résumé")).toBe("cafe-resume");
  });

  test("strips punctuation and collapses whitespace/symbols to single hyphens", () => {
    expect(slugify("Wait, what?! Really...")).toBe("wait-what-really");
  });

  test("trims leading/trailing hyphens", () => {
    expect(slugify("  --hello--  ")).toBe("hello");
  });

  test("caps length at 160 characters", () => {
    const long = "a".repeat(300);
    expect(slugify(long).length).toBeLessThanOrEqual(160);
  });
});
