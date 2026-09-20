import { describe, expect, test } from "vitest";
import { parseLinkMetadata } from "@/lib/linkPreview/parse";

const page = (head: string) => `<!doctype html><html><head>${head}</head><body>ignored</body></html>`;

describe("parseLinkMetadata", () => {
  test("prefers Open Graph over the title tag", () => {
    const meta = parseLinkMetadata(
      page(`
        <title>Council approves budget | The Example Times</title>
        <meta property="og:title" content="Council approves budget">
        <meta property="og:description" content="After a four-hour session.">
        <meta property="og:site_name" content="The Example Times">
      `)
    );
    expect(meta).toEqual({
      title: "Council approves budget",
      description: "After a four-hour session.",
      siteName: "The Example Times",
    });
  });

  test("falls back to the title tag when there is no og:title", () => {
    expect(parseLinkMetadata(page("<title>Just a title</title>")).title).toBe("Just a title");
  });

  test("reads meta tags written with the attributes in either order", () => {
    // Both orders are common in the wild.
    const reversed = parseLinkMetadata(
      page(`<meta content="Reversed order" property="og:title">`)
    );
    expect(reversed.title).toBe("Reversed order");
  });

  test("accepts the plain description meta tag", () => {
    expect(parseLinkMetadata(page(`<meta name="description" content="A summary.">`)).description).toBe(
      "A summary."
    );
  });

  test("decodes the entities that show up in headlines", () => {
    expect(parseLinkMetadata(page("<title>Fish &amp; chips &#8212; a history</title>")).title).toBe(
      "Fish & chips — a history"
    );
  });

  test("decodes ampersands last, so escaped entities stay escaped", () => {
    // "&amp;lt;" is the *text* "&lt;", not a less-than sign.
    expect(parseLinkMetadata(page("<title>&amp;lt;script&amp;gt;</title>")).title).toBe(
      "&lt;script&gt;"
    );
  });

  test("strips markup that appears inside a value", () => {
    const meta = parseLinkMetadata(page("<title>Hello <b>there</b></title>"));
    expect(meta.title).toBe("Hello there");
    expect(meta.title).not.toContain("<");
  });

  test("never returns a script tag, however it was smuggled in", () => {
    const meta = parseLinkMetadata(
      page(`<title><script>alert(1)</script>Headline</title>`)
    );
    expect(meta.title).toBe("alert(1)Headline");
    expect(meta.title).not.toContain("<script");
  });

  test("drops control characters from numeric entities", () => {
    expect(parseLinkMetadata(page("<title>a&#0;b&#7;c</title>")).title).toBe("abc");
  });

  test("collapses whitespace and trims", () => {
    expect(parseLinkMetadata(page("<title>\n  Spread   out\n</title>")).title).toBe("Spread out");
  });

  test("truncates a very long title rather than storing it whole", () => {
    const meta = parseLinkMetadata(page(`<title>${"x".repeat(500)}</title>`));
    expect(meta.title).toHaveLength(200);
    expect(meta.title?.endsWith("…")).toBe(true);
  });

  test("returns nulls for a page with no metadata at all", () => {
    expect(parseLinkMetadata("<html><body>nothing here</body></html>")).toEqual({
      title: null,
      description: null,
      siteName: null,
    });
  });

  test("ignores metadata in the body", () => {
    // Only the head is read, so body content can't supply a title.
    const html = `<html><head><title>Real</title></head><body><meta property="og:title" content="Fake"></body></html>`;
    expect(parseLinkMetadata(html).title).toBe("Real");
  });

  test("survives malformed markup without throwing", () => {
    expect(() => parseLinkMetadata("<html><head><title>unclosed")).not.toThrow();
    expect(() => parseLinkMetadata("<<<>>>")).not.toThrow();
    expect(() => parseLinkMetadata("")).not.toThrow();
  });

  test("treats an empty content attribute as absent", () => {
    expect(parseLinkMetadata(page(`<meta property="og:description" content="">`)).description).toBe(
      null
    );
  });
});
