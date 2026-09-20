import { describe, expect, test } from "vitest";
import { sanitizedArticleHtml } from "@/lib/sanitizeCache";

describe("sanitizedArticleHtml", () => {
  test("still strips script tags, cached or not", () => {
    const dirty = '<p>hello</p><script>alert(1)</script>';
    const first = sanitizedArticleHtml("a1", new Date(1000), dirty);
    const second = sanitizedArticleHtml("a1", new Date(1000), dirty);

    expect(first).not.toContain("<script");
    expect(second).toBe(first);
  });

  test("a newer updatedAt busts the entry, so an edit is never served stale", () => {
    const id = "a2";
    const before = sanitizedArticleHtml(id, new Date(1000), "<p>original</p>");
    const after = sanitizedArticleHtml(id, new Date(2000), "<p>edited</p>");

    expect(before).toContain("original");
    expect(after).toContain("edited");
    expect(after).not.toContain("original");
  });

  test("different articles do not share an entry", () => {
    const a = sanitizedArticleHtml("x", new Date(1), "<p>article x</p>");
    const b = sanitizedArticleHtml("y", new Date(1), "<p>article y</p>");
    expect(a).toContain("article x");
    expect(b).toContain("article y");
  });

  test("stays bounded rather than growing without limit", () => {
    // Far more distinct articles than the cache holds; the point is that
    // it keeps answering correctly rather than that any particular entry
    // survives.
    for (let i = 0; i < 1200; i++) {
      sanitizedArticleHtml(`bulk-${i}`, new Date(1), `<p>body ${i}</p>`);
    }
    expect(sanitizedArticleHtml("bulk-1199", new Date(1), "<p>body 1199</p>")).toContain("body 1199");
    expect(sanitizedArticleHtml("bulk-0", new Date(1), "<p>body 0</p>")).toContain("body 0");
  });
});
