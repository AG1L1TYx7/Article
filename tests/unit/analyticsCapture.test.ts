import { describe, expect, test } from "vitest";
import { classifyReferrer, countryFrom, deviceFrom } from "@/lib/analyticsClassify";

/**
 * The classifiers behind the analytics dimensions. They turn raw request
 * headers into coarse buckets; the whole privacy argument for the
 * analytics rests on nothing finer than a bucket ever being stored.
 */
describe("countryFrom", () => {
  const withHeaders = (h: Record<string, string>) => (name: string) => h[name.toLowerCase()] ?? null;

  test("reads Cloudflare's header", () => {
    expect(countryFrom(withHeaders({ "cf-ipcountry": "fr" }))).toBe("FR");
  });

  test("reads Vercel's and a generic geoip header", () => {
    expect(countryFrom(withHeaders({ "x-vercel-ip-country": "DE" }))).toBe("DE");
    expect(countryFrom(withHeaders({ geoip_country_code: "NP" }))).toBe("NP");
  });

  test("Cloudflare's placeholders for unknown and Tor are not countries", () => {
    expect(countryFrom(withHeaders({ "cf-ipcountry": "XX" }))).toBe("unknown");
    expect(countryFrom(withHeaders({ "cf-ipcountry": "T1" }))).toBe("unknown");
  });

  test("nothing in front of the app means unknown, never a guess", () => {
    expect(countryFrom(() => null)).toBe("unknown");
    expect(countryFrom(withHeaders({ "cf-ipcountry": "France" }))).toBe("unknown");
  });
});

describe("classifyReferrer", () => {
  test("no referrer is direct", () => {
    expect(classifyReferrer(null, "news.example")).toBe("direct");
    expect(classifyReferrer("", "news.example")).toBe("direct");
    expect(classifyReferrer("not a url", "news.example")).toBe("direct");
  });

  test("search engines collapse into one bucket", () => {
    expect(classifyReferrer("https://www.google.co.uk/", "news.example")).toBe("search");
    expect(classifyReferrer("https://duckduckgo.com/?q=x", "news.example")).toBe("search");
    expect(classifyReferrer("https://www.bing.com/search?q=x", "news.example")).toBe("search");
  });

  test("social platforms collapse into one bucket", () => {
    expect(classifyReferrer("https://t.co/abc", "news.example")).toBe("social");
    expect(classifyReferrer("https://www.facebook.com/", "news.example")).toBe("social");
    expect(classifyReferrer("https://news.ycombinator.com/item?id=1", "news.example")).toBe("social");
  });

  test("the site itself is internal, with or without www", () => {
    expect(classifyReferrer("https://www.news.example/", "news.example")).toBe("internal");
    expect(classifyReferrer("https://news.example/article/x", "www.news.example")).toBe("internal");
  });

  test("anything else is the bare host, so a newsletter or a blog shows by name", () => {
    expect(classifyReferrer("https://www.someblog.org/post?utm=1", "news.example")).toBe("someblog.org");
  });

  test("the path and query never survive — they can carry personal data", () => {
    expect(classifyReferrer("https://mail.example.com/u/0/#inbox/abc123", "news.example")).toBe("mail.example.com");
  });
});

describe("deviceFrom", () => {
  test("phones", () => {
    expect(deviceFrom("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Mobile/15E148 Safari")).toBe("mobile");
    expect(deviceFrom("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit Chrome/120 Mobile Safari")).toBe("mobile");
  });

  test("tablets", () => {
    expect(deviceFrom("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit Safari")).toBe("tablet");
    expect(deviceFrom("Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit Chrome/120 Safari")).toBe("tablet");
  });

  test("desktops, and nothing at all", () => {
    expect(deviceFrom("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit Chrome/120 Safari")).toBe("desktop");
    expect(deviceFrom(null)).toBe("desktop");
  });

  test("crawlers are set aside so they can be discounted", () => {
    expect(deviceFrom("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe("bot");
    expect(deviceFrom("facebookexternalhit/1.1")).toBe("bot");
    expect(deviceFrom("curl/8.0")).toBe("bot");
  });
});
