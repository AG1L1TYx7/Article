import { describe, expect, test } from "vitest";
import { buildCsp, generateNonce } from "@/lib/csp";

const parse = (csp: string) =>
  Object.fromEntries(
    csp.split("; ").map((directive) => {
      const [name, ...values] = directive.split(" ");
      return [name, values];
    })
  ) as Record<string, string[]>;

const base = { nonce: "abc123", isDev: false, turnstile: false };

describe("buildCsp", () => {
  test("carries the request's nonce, which Next.js reads back out of it", () => {
    // This is the mechanism: Next parses the header while rendering and
    // puts the nonce on its own script tags. A missing nonce here means
    // every script on the page is blocked.
    expect(parse(buildCsp(base))["script-src"]).toContain("'nonce-abc123'");
  });

  test("uses strict-dynamic rather than a list of trusted hosts", () => {
    const scriptSrc = parse(buildCsp(base))["script-src"];
    expect(scriptSrc).toContain("'strict-dynamic'");
    // The fallbacks below it are only consulted by browsers too old to
    // understand strict-dynamic, which ignores them entirely.
    expect(scriptSrc).toContain("'unsafe-inline'");
  });

  test("allows eval only in development", () => {
    // React uses eval in development to rebuild server error stacks.
    expect(parse(buildCsp({ ...base, isDev: true }))["script-src"]).toContain("'unsafe-eval'");
    expect(parse(buildCsp(base))["script-src"]).not.toContain("'unsafe-eval'");
  });

  test("blocks the directives an injected tag would reach for", () => {
    const csp = parse(buildCsp(base));
    // An injected <base> silently repoints every relative URL on the page.
    expect(csp["base-uri"]).toEqual(["'none'"]);
    // A form posting credentials elsewhere is phishing from inside the page.
    expect(csp["form-action"]).toEqual(["'self'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
  });

  test("allows the media origin when uploads are served from elsewhere", () => {
    // With S3 configured, Media.url points at the bucket or CDN. Without
    // this, every article image is blocked.
    const csp = parse(buildCsp({ ...base, mediaOrigin: "https://media.example.com" }));
    expect(csp["img-src"]).toContain("https://media.example.com");
    expect(csp["media-src"]).toContain("https://media.example.com");
  });

  test("does not allow an arbitrary origin when no media origin is set", () => {
    const csp = parse(buildCsp(base));
    expect(csp["img-src"]).toEqual(["'self'", "blob:", "data:"]);
  });

  test("allows Turnstile only when Turnstile is configured", () => {
    const without = parse(buildCsp(base));
    expect(without["frame-src"]).toEqual(["'self'"]);
    expect(without["connect-src"]).toEqual(["'self'"]);

    const withIt = parse(buildCsp({ ...base, turnstile: true }));
    expect(withIt["frame-src"]).toContain("https://challenges.cloudflare.com");
    expect(withIt["connect-src"]).toContain("https://challenges.cloudflare.com");
  });

  test("upgrades insecure requests in production only", () => {
    expect(buildCsp(base)).toContain("upgrade-insecure-requests");
    // On http://localhost that directive would break every request.
    expect(buildCsp({ ...base, isDev: true })).not.toContain("upgrade-insecure-requests");
  });

  test("style-src permits inline styles, and the comment explains why", () => {
    // Next.js and next/font inject style tags a nonce does not always
    // reach. Inline style cannot execute, and the exfiltration tricks it
    // enables are cut off by img-src and connect-src.
    expect(parse(buildCsp(base))["style-src"]).toContain("'unsafe-inline'");
  });
});

describe("generateNonce", () => {
  test("produces a different value every time", () => {
    const seen = new Set(Array.from({ length: 500 }, generateNonce));
    expect(seen.size).toBe(500);
  });

  test("is long enough to be unguessable, and safe inside a header", () => {
    const nonce = generateNonce();
    expect(nonce.length).toBeGreaterThanOrEqual(32);
    // A quote or semicolon here would let a crafted value break out of
    // the directive it sits in.
    expect(nonce).toMatch(/^[a-f0-9]+$/);
  });
});
