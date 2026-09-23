import { describe, expect, test } from "vitest";
import { addArticleReferenceSchema, articleInputSchema } from "@/lib/validation/article";

describe("addArticleReferenceSchema", () => {
  const base = { articleId: "a1", title: "Housing needs assessment 2026" };

  test("a title is all that is required", () => {
    const parsed = addArticleReferenceSchema.safeParse(base);
    expect(parsed.success).toBe(true);
  });

  test("an empty or whitespace title is refused", () => {
    expect(addArticleReferenceSchema.safeParse({ ...base, title: "   " }).success).toBe(false);
  });

  test("a link must be http or https — it is rendered into an anchor for every reader", () => {
    expect(addArticleReferenceSchema.safeParse({ ...base, url: "https://example.gov/report.pdf" }).success).toBe(true);
    expect(addArticleReferenceSchema.safeParse({ ...base, url: "javascript:alert(1)" }).success).toBe(false);
    expect(addArticleReferenceSchema.safeParse({ ...base, url: "file:///etc/passwd" }).success).toBe(false);
  });

  test("the optional fields are trimmed and bounded", () => {
    const parsed = addArticleReferenceSchema.safeParse({ ...base, author: "  Council of Ministers ", publishedOn: "12 May 2026" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.author).toBe("Council of Ministers");
    expect(addArticleReferenceSchema.safeParse({ ...base, note: "x".repeat(501) }).success).toBe(false);
  });
});

describe("articleInputSchema.anonymous", () => {
  const body = { title: "T", slug: "t-story", bodyJson: {}, bodyHtml: "<p>x</p>" };

  test("is optional and boolean", () => {
    expect(articleInputSchema.safeParse(body).success).toBe(true);
    expect(articleInputSchema.safeParse({ ...body, anonymous: true }).success).toBe(true);
    expect(articleInputSchema.safeParse({ ...body, anonymous: "yes" }).success).toBe(false);
  });
});
