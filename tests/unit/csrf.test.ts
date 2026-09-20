import { describe, expect, test } from "vitest";
import { isCrossOriginRequest } from "@/lib/csrf";

function req(headers: Record<string, string>): Request {
  return new Request("https://example.com/api/media/upload", {
    method: "POST",
    headers,
  });
}

describe("isCrossOriginRequest", () => {
  test("same origin is allowed", () => {
    expect(
      isCrossOriginRequest(req({ origin: "https://example.com", host: "example.com" }))
    ).toBe(false);
  });

  test("a different origin is rejected", () => {
    // The actual CSRF shape: a form on attacker.com posting to this API.
    expect(
      isCrossOriginRequest(req({ origin: "https://attacker.com", host: "example.com" }))
    ).toBe(true);
  });

  test("a different port counts as a different origin", () => {
    expect(
      isCrossOriginRequest(req({ origin: "https://example.com:8080", host: "example.com" }))
    ).toBe(true);
  });

  test("http vs https on the same host still differ at the origin, but this check is host-only by design", () => {
    // Deliberately not stricter than that: X-Forwarded-Proto varies
    // legitimately behind a reverse proxy, and the Host match is what
    // actually matters for this attack.
    expect(
      isCrossOriginRequest(req({ origin: "http://example.com", host: "example.com" }))
    ).toBe(false);
  });

  test("no Origin header at all is allowed through", () => {
    // Non-browser clients and same-origin GETs typically don't send one;
    // its presence is what browsers add specifically for state-changing
    // cross-site-capable requests.
    expect(isCrossOriginRequest(req({ host: "example.com" }))).toBe(false);
  });

  test("respects X-Forwarded-Host behind a reverse proxy", () => {
    expect(
      isCrossOriginRequest(
        req({
          origin: "https://real-domain.com",
          host: "127.0.0.1:3000",
          "x-forwarded-host": "real-domain.com",
        })
      )
    ).toBe(false);
  });

  test("an unparseable Origin is rejected rather than ignored", () => {
    expect(isCrossOriginRequest(req({ origin: "not a url", host: "example.com" }))).toBe(true);
  });

  test("a request claiming no Host at all is rejected", () => {
    // Can't happen over real HTTP/1.1+, but a header this function relies
    // on being absent must fail closed, not open.
    expect(isCrossOriginRequest(req({ origin: "https://example.com" }))).toBe(true);
  });
});
