import { describe, expect, test } from "vitest";
import { toBooleanQuery } from "@/lib/searchQuery";

/**
 * This module replaces a guarantee Postgres gave for free.
 *
 * `websearch_to_tsquery` accepted anything a person could type and never
 * raised an error. MySQL boolean mode instead assigns meaning to
 * `+ - > < ( ) ~ * " @`, and a stray one is a syntax error — so every
 * case below that produces valid output is a 500 that does not happen.
 */
describe("toBooleanQuery keeps ordinary searches working", () => {
  test("plain words pass through", () => {
    expect(toBooleanQuery("council budget")).toBe("council budget");
  });

  test("a quoted phrase stays a phrase", () => {
    expect(toBooleanQuery('"council budget"')).toBe('"council budget"');
  });

  test("a phrase and loose words together", () => {
    expect(toBooleanQuery('"town hall" budget')).toBe('"town hall" budget');
  });

  test("a leading minus still excludes", () => {
    // One of the three operators readers are actually told about.
    expect(toBooleanQuery("budget -sport")).toBe("budget -sport");
  });

  test("a single-word quote is just that word", () => {
    // Quoting one word gains nothing, and an empty "" is a syntax error.
    expect(toBooleanQuery('"budget"')).toBe("budget");
  });

  test("extra whitespace collapses", () => {
    expect(toBooleanQuery("  council    budget  ")).toBe("council budget");
  });
});

describe("toBooleanQuery never emits something MySQL will reject", () => {
  test("the punctuation soup that used to be safe on Postgres", () => {
    // This exact input is in the e2e suite because it is what a reader
    // eventually types. On Postgres it was harmless; here it has to be
    // made harmless.
    const out = toBooleanQuery("a & | b ! ( )");
    expect(out).not.toMatch(/[+><()~*"@]/);
  });

  test("operator characters are stripped from words", () => {
    for (const input of ["bud+get", "bud*get", "(budget)", "budget~", "@budget", "bud>get"]) {
      const out = toBooleanQuery(input);
      expect(out, input).not.toMatch(/[+><()~*@]/);
    }
  });

  test("an unbalanced quote does not leak a dangling quote", () => {
    // MySQL errors on an odd number of quotes.
    const out = toBooleanQuery('"unclosed phrase');
    expect((out.match(/"/g) ?? []).length % 2).toBe(0);
  });

  test("input that is only punctuation comes back empty", () => {
    // The caller returns no results rather than running a broken query.
    for (const input of ["!!!", "&&&", "()", '"""', "~~~", "+++"]) {
      expect(toBooleanQuery(input), input).toBe("");
    }
  });

  test("an empty or whitespace query is empty", () => {
    expect(toBooleanQuery("")).toBe("");
    expect(toBooleanQuery("   ")).toBe("");
  });
});

describe("toBooleanQuery matches what MySQL will actually index", () => {
  test("words below the minimum token size are dropped", () => {
    // innodb_ft_min_token_size is 2 in this deployment. A one-letter word
    // is not indexed, so including it would promise a match that cannot
    // happen.
    expect(toBooleanQuery("a budget")).toBe("budget");
  });

  test("two-letter words survive, which is why the setting was lowered", () => {
    // The default of 3 would make these unsearchable — a real problem on
    // a news site.
    expect(toBooleanQuery("AI policy")).toBe("AI policy");
    expect(toBooleanQuery("EU summit")).toBe("EU summit");
    expect(toBooleanQuery("US election")).toBe("US election");
  });

  test("a query of nothing but exclusions is treated as empty", () => {
    // In MySQL boolean mode, "-spam" alone matches every row, which is
    // the opposite of what someone typing it expects.
    expect(toBooleanQuery("-spam")).toBe("");
    expect(toBooleanQuery("-spam -junk")).toBe("");
  });
});
