import { describe, expect, test } from "vitest";
import {
  breakingNewsPayload,
  commentApprovedPayload,
  commentReplyPayload,
  serialisePayload,
  truncate,
} from "@/lib/pushPayload";

describe("truncate", () => {
  test("leaves short text alone, collapsing stray whitespace", () => {
    expect(truncate("  Hello   world ", 80)).toBe("Hello world");
  });

  test("cuts at a word boundary and marks the cut", () => {
    const out = truncate("The quick brown fox jumps over the lazy dog again and again", 30);
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/\s…$/);
    // Not sliced mid-word.
    expect("The quick brown fox jumps over the lazy dog again and again".startsWith(out.slice(0, -1))).toBe(true);
  });

  test("falls back to a hard cut when there is no usable space", () => {
    expect(truncate("a".repeat(100), 20)).toBe("a".repeat(19) + "…");
  });
});

describe("payloads", () => {
  test("breaking news names the story and points at it", () => {
    const p = breakingNewsPayload({ slug: "big-story", title: "Parliament dissolved", dek: "Election in six weeks." });
    expect(p.title).toBe("Breaking: Parliament dissolved");
    expect(p.body).toBe("Election in six weeks.");
    expect(p.url).toBe("/article/big-story");
    expect(p.tag).toBe("breaking-big-story");
  });

  test("breaking news without a dek still has a body", () => {
    expect(breakingNewsPayload({ slug: "s", title: "T", dek: null }).body).not.toBe("");
  });

  test("a reply carries who replied and deep-links to the comment", () => {
    const p = commentReplyPayload({
      actorName: "Ada",
      articleSlug: "story",
      articleTitle: "Story",
      commentId: "c1",
      body: "I disagree.",
    });
    expect(p.title).toBe("Ada replied to your comment");
    expect(p.body).toBe("I disagree.");
    expect(p.url).toBe("/article/story#comment-c1");
  });

  test("an approval deep-links to the comment", () => {
    const p = commentApprovedPayload({ articleSlug: "story", articleTitle: "Story", commentId: "c1" });
    expect(p.url).toBe("/article/story#comment-c1");
    expect(p.title).toMatch(/public/);
  });

  test("the serialised payload stays far inside the 4KB push limit", () => {
    const p = breakingNewsPayload({ slug: "x".repeat(200), title: "y".repeat(500), dek: "z".repeat(2000) });
    expect(Buffer.byteLength(serialisePayload(p))).toBeLessThan(1024);
  });
});
