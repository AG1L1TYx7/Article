import { describe, expect, test } from "vitest";
import { safeRedirectPath } from "@/lib/safeRedirect";

/**
 * These payloads are the reason this function exists. The login page used
 * `from.startsWith("/")`, which every one of the protocol-relative cases
 * below walks straight through.
 */
describe("safeRedirectPath refuses to leave this origin", () => {
  test("the bug that was actually shipped: protocol-relative URLs", () => {
    // "//evil.com" starts with "/" and resolves to https://evil.com.
    expect(safeRedirectPath("//evil.com")).toBe("/");
    expect(safeRedirectPath("//evil.com/login")).toBe("/");
    expect(safeRedirectPath("///evil.com")).toBe("/");
  });

  test("backslashes, which browsers normalise to slashes", () => {
    expect(safeRedirectPath("/\\evil.com")).toBe("/");
    expect(safeRedirectPath("\\\\evil.com")).toBe("/");
    expect(safeRedirectPath("/\\/evil.com")).toBe("/");
  });

  test("absolute URLs", () => {
    for (const value of [
      "https://evil.com",
      "http://evil.com/path",
      "//evil.com:8080",
      "https://this-origin.invalid.evil.com",
    ]) {
      expect(safeRedirectPath(value), value).toBe("/");
    }
  });

  test("other schemes", () => {
    // javascript: in a redirect is an XSS, not merely a redirect.
    for (const value of ["javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd"]) {
      expect(safeRedirectPath(value), value).toBe("/");
    }
  });

  test("whitespace and control characters used to smuggle a scheme past a filter", () => {
    for (const value of ["\t//evil.com", " //evil.com", "\n//evil.com", "java\tscript:alert(1)"]) {
      expect(safeRedirectPath(value), JSON.stringify(value)).toBe("/");
    }
  });

  test("a user-info section that makes the real host look like a path", () => {
    // Reads as "this-origin.invalid" to a hurried eye; the host is evil.com.
    expect(safeRedirectPath("https://this-origin.invalid@evil.com")).toBe("/");
  });
});

describe("safeRedirectPath allows genuine destinations", () => {
  test("ordinary paths survive intact", () => {
    expect(safeRedirectPath("/dashboard")).toBe("/dashboard");
    expect(safeRedirectPath("/dashboard/articles")).toBe("/dashboard/articles");
    expect(safeRedirectPath("/")).toBe("/");
  });

  test("query strings and fragments are preserved", () => {
    expect(safeRedirectPath("/search?q=budget")).toBe("/search?q=budget");
    expect(safeRedirectPath("/article/x#comment-1")).toBe("/article/x#comment-1");
  });

  test("falls back when there is nothing to redirect to", () => {
    expect(safeRedirectPath(null)).toBe("/");
    expect(safeRedirectPath(undefined)).toBe("/");
    expect(safeRedirectPath("")).toBe("/");
  });

  test("the caller chooses the fallback", () => {
    expect(safeRedirectPath("//evil.com", "/dashboard")).toBe("/dashboard");
    expect(safeRedirectPath(null, "/dashboard")).toBe("/dashboard");
  });
});
