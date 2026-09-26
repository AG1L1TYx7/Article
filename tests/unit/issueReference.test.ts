import { describe, expect, it } from "vitest";
import { issueSlug, newReference } from "@/lib/issueRef";

/**
 * The public reference and the URL slug of a report.
 *
 * Both are read aloud, written down and quoted to officials, so the tests
 * are about legibility as much as correctness — and about the one thing a
 * reference must not do, which is reveal how many reports there have been.
 */
describe("issue reference", () => {
  it("is grouped and prefixed so it can be read down a phone", () => {
    expect(newReference()).toMatch(/^NP-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it("never uses a character that is misread aloud or in handwriting", () => {
    // No O/0, I/1, S/5, B/8, Z/2 — the pairs somebody reading a reference
    // to a ward office will get wrong.
    const banned = /[OI01SZB528]/;
    for (let i = 0; i < 500; i++) {
      expect(newReference().slice(3), "banned character in reference").not.toMatch(banned);
    }
  });

  it("is not sequential, so it cannot be counted or enumerated", () => {
    // A running number would publish how many reports the platform has
    // received, and would tell the subject of report 41 roughly when it
    // was filed.
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(newReference());
    expect(seen.size).toBe(2000);
  });
});

describe("issue slug", () => {
  const reference = "NP-XWK4-9TGW";

  it("reads as the title, with a short tail to keep it unique", () => {
    expect(issueSlug("Ward office demanding money", reference)).toBe(
      "ward-office-demanding-money-xwk4"
    );
  });

  it("never ends in a stray dash", () => {
    // The reference carries its own separator; appending it naively left
    // URLs looking as though they had been cut off.
    for (const title of ["Ward office", "A", "Money -- demanded", "Trailing dash -"]) {
      expect(issueSlug(title, reference), title).not.toMatch(/-$/);
    }
  });

  it("falls back to the reference for a title with no Latin letters", () => {
    // Most reports will be written in Nepali, and a slug of nothing but a
    // hyphen is not a URL.
    const slug = issueSlug("वडा कार्यालयले पैसा माग्यो", reference);
    expect(slug).toBe("npxwk49tgw");
    expect(slug).toMatch(/^[a-z0-9]+$/);
  });

  it("only ever produces characters that are safe in a URL", () => {
    for (const title of [
      "Ward office demanding money",
      "Bribe? Yes! 100% — and more…",
      "<script>alert(1)</script>",
      "वडा कार्यालय",
      "Ünïcödé títlé",
      "   ",
    ]) {
      expect(issueSlug(title, reference), title).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("does not let a title smuggle markup into a URL", () => {
    expect(issueSlug("<script>alert(1)</script>", reference)).toBe("script-alert-1-script-xwk4");
  });

  it("keeps the slug short enough to be usable", () => {
    const long = "a very ".repeat(40) + "long title";
    expect(issueSlug(long, reference).length).toBeLessThanOrEqual(70);
  });
});
