import { describe, expect, test } from "vitest";
import { sanitizeArticleHtml } from "@/lib/sanitize";

describe("sanitizeArticleHtml", () => {
  test("strips <script> tags entirely", () => {
    const out = sanitizeArticleHtml('<p>hello</p><script>alert("xss")</script>');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert");
    expect(out).toContain("<p>hello</p>");
  });

  test("strips inline event handlers from otherwise-allowed tags", () => {
    const out = sanitizeArticleHtml('<p onclick="alert(1)">click me</p>');
    expect(out).not.toContain("onclick");
    expect(out).toContain("click me");
  });

  test("strips javascript: URIs from links", () => {
    const out = sanitizeArticleHtml('<a href="javascript:alert(1)">link</a>');
    expect(out).not.toContain("javascript:");
  });

  test("strips style attributes", () => {
    const out = sanitizeArticleHtml('<p style="background:url(javascript:alert(1))">text</p>');
    expect(out).not.toContain("style=");
  });

  test("strips disallowed tags like <iframe> and <object>", () => {
    const out = sanitizeArticleHtml('<iframe src="https://evil.example"></iframe><object data="x"></object>');
    expect(out).not.toContain("<iframe");
    expect(out).not.toContain("<object");
  });

  test("keeps ordinary formatting and a safe image untouched", () => {
    const out = sanitizeArticleHtml(
      '<h2>Title</h2><p><strong>bold</strong> and <em>italic</em></p><img src="/media/abc.webp" alt="a photo">'
    );
    expect(out).toContain("<h2>Title</h2>");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain('src="/media/abc.webp"');
  });

  test("keeps a normal https link with rel/target", () => {
    const out = sanitizeArticleHtml('<a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('rel="noopener noreferrer"');
  });
});
