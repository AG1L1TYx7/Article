import { describe, expect, test } from "vitest";
import { COMMENT_EDIT_WINDOW_MS, isCommentEditable } from "@/lib/commentPolicy";

describe("isCommentEditable", () => {
  const posted = new Date("2026-06-15T12:00:00Z");
  const at = (offsetMs: number) => posted.getTime() + offsetMs;

  test("a comment posted just now is editable", () => {
    expect(isCommentEditable(posted, at(0))).toBe(true);
  });

  test("still editable just inside the window", () => {
    expect(isCommentEditable(posted, at(COMMENT_EDIT_WINDOW_MS - 1))).toBe(true);
  });

  test("not editable once the window has passed", () => {
    expect(isCommentEditable(posted, at(COMMENT_EDIT_WINDOW_MS))).toBe(false);
    expect(isCommentEditable(posted, at(COMMENT_EDIT_WINDOW_MS + 60_000))).toBe(false);
  });

  test("the window is fifteen minutes", () => {
    // Pinned deliberately: widening this weakens the protection against
    // editing a comment into abuse after it has collected approval.
    expect(COMMENT_EDIT_WINDOW_MS).toBe(15 * 60 * 1000);
  });
});
