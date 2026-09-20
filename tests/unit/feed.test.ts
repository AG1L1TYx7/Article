import { describe, expect, test } from "vitest";
import { buildRssFeed, escapeXml, type FeedItem } from "@/lib/feed";

const item = (overrides: Partial<FeedItem> = {}): FeedItem => ({
  slug: "council-approves-budget",
  title: "Council approves budget",
  summary: "After a four-hour session.",
  publishedAt: new Date("2026-06-15T09:30:00Z"),
  authorName: "Ada Reporter",
  categoryName: "Politics",
  ...overrides,
});

describe("escapeXml", () => {
  test("escapes the five XML significant characters", () => {
    expect(escapeXml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;"
    );
  });

  test("escapes ampersands first, so nothing is double-escaped", () => {
    // Doing & last would turn "<" into "&amp;lt;" and every reader would
    // display the literal text "&lt;".
    expect(escapeXml("<")).toBe("&lt;");
    expect(escapeXml("&lt;")).toBe("&amp;lt;");
  });

  test("strips control characters XML cannot represent at all", () => {
    // These arrive via pasted copy and make the document unparseable no
    // matter how they are escaped.
    expect(escapeXml("head\u0000line\u0007")).toBe("headline");
  });

  test("leaves ordinary text and accents alone", () => {
    expect(escapeXml("Café — a history")).toBe("Café — a history");
  });
});

describe("buildRssFeed", () => {
  test("produces a feed with one item per article", () => {
    const xml = buildRssFeed([item(), item({ slug: "second", title: "Second story" })]);
    expect(xml.match(/<item>/g)).toHaveLength(2);
    expect(xml).toContain("<title>Council approves budget</title>");
    expect(xml).toContain("<title>Second story</title>");
  });

  test("starts with an XML declaration and declares RSS 2.0", () => {
    const xml = buildRssFeed([item()]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<rss version="2.0"');
  });

  test("links are absolute, since a feed is read away from the site", () => {
    const xml = buildRssFeed([item()]);
    expect(xml).toMatch(/<link>https?:\/\/[^<]+\/article\/council-approves-budget<\/link>/);
  });

  test("dates are RFC 822, which is what the RSS spec requires", () => {
    const xml = buildRssFeed([item()]);
    expect(xml).toContain("<pubDate>Mon, 15 Jun 2026 09:30:00 GMT</pubDate>");
  });

  test("a headline containing an ampersand does not corrupt the feed", () => {
    // The failure this guards is total: readers reject a malformed
    // document outright, so one bad headline takes the whole feed down.
    const xml = buildRssFeed([item({ title: "Fish & chips <b>win</b>" })]);
    expect(xml).toContain("<title>Fish &amp; chips &lt;b&gt;win&lt;/b&gt;</title>");
    expect(xml).not.toContain("<b>win</b>");
  });

  test("omits optional elements rather than emitting empty ones", () => {
    const xml = buildRssFeed([item({ summary: null, categoryName: null, publishedAt: null })]);
    expect(xml).not.toContain("<description></description>");
    expect(xml).not.toContain("<category></category>");
    expect(xml).not.toContain("<pubDate>");
  });

  test("an empty feed is still a valid document", () => {
    // A brand new site has no articles, and a broken feed on day one is a
    // subscriber lost permanently.
    const xml = buildRssFeed([], new Date("2026-06-15T09:30:00Z"));
    expect(xml).toContain("<channel>");
    expect(xml).toContain("</rss>");
    expect(xml).not.toContain("<item>");
    expect(xml).toContain("<lastBuildDate>Mon, 15 Jun 2026 09:30:00 GMT</lastBuildDate>");
  });

  test("every item carries a stable guid", () => {
    const xml = buildRssFeed([item()]);
    expect(xml).toMatch(/<guid isPermaLink="true">https?:\/\/[^<]+<\/guid>/);
  });
});
