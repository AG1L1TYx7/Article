import { describe, expect, test } from "vitest";
import { assessComment } from "@/lib/spam";

describe("assessComment", () => {
  test("lets an ordinary comment through", () => {
    expect(assessComment("Good piece — the third section was especially clear.").needsReview).toBe(false);
  });

  test("allows a couple of links, since citing sources is normal", () => {
    const body = "See https://example.com/a and https://example.com/b for context.";
    expect(assessComment(body).needsReview).toBe(false);
  });

  test("holds a link-stuffed comment for review", () => {
    const body = "https://a.example https://b.example https://c.example https://d.example";
    const result = assessComment(body);
    expect(result.needsReview).toBe(true);
    expect(result.reason).toContain("links");
  });

  test("holds obvious spam phrases", () => {
    const result = assessComment("BUY NOW while stocks last");
    expect(result.needsReview).toBe(true);
  });

  test("holds sustained shouting", () => {
    const result = assessComment("THIS ARTICLE IS COMPLETELY WRONG ABOUT EVERYTHING");
    expect(result.needsReview).toBe(true);
    expect(result.reason).toBe("all caps");
  });

  test("does not flag a short emphatic reply", () => {
    // "THIS!" and friends are normal comment-section speech, not spam.
    expect(assessComment("THIS!").needsReview).toBe(false);
    expect(assessComment("YES").needsReview).toBe(false);
  });

  test("does not flag an acronym-heavy but mixed-case comment", () => {
    expect(assessComment("The NHS and BBC both reported this yesterday.").needsReview).toBe(false);
  });
});
