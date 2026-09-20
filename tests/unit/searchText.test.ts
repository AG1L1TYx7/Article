import { describe, expect, test } from "vitest";
import { extractSearchText } from "@/lib/searchText";

describe("extractSearchText", () => {
  test("strips tags and keeps the words", () => {
    expect(extractSearchText("<p>Council <strong>approves</strong> budget</p>")).toBe(
      "Council approves budget"
    );
  });

  test("does not run words together across block boundaries", () => {
    // The bug this guards: "<p>end</p><p>Start" collapsing to "endStart",
    // which would make neither word findable.
    expect(extractSearchText("<p>end</p><p>Start</p>")).toBe("end Start");
  });

  test("markup never becomes searchable text", () => {
    const out = extractSearchText('<div class="prose"><a href="https://example.com">link</a></div>');
    expect(out).toBe("link");
    expect(out).not.toContain("href");
    expect(out).not.toContain("div");
  });

  test("decodes the entities the sanitizer leaves behind", () => {
    expect(extractSearchText("<p>Fish &amp; chips&nbsp;today</p>")).toBe("Fish & chips today");
  });

  test("collapses whitespace and trims", () => {
    expect(extractSearchText("<p>  spaced   out  </p>")).toBe("spaced out");
  });

  test("handles an empty body", () => {
    expect(extractSearchText("")).toBe("");
  });
});
