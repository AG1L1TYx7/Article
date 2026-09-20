import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { isTurnstileEnabled, verifyTurnstile } from "@/lib/turnstile";

const ORIGINAL_SECRET = process.env.TURNSTILE_SECRET_KEY;

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.TURNSTILE_SECRET_KEY;
  else process.env.TURNSTILE_SECRET_KEY = ORIGINAL_SECRET;
  vi.restoreAllMocks();
});

describe("when Turnstile is not configured", () => {
  beforeEach(() => {
    delete process.env.TURNSTILE_SECRET_KEY;
  });

  test("reports itself disabled", () => {
    expect(isTurnstileEnabled()).toBe(false);
  });

  test("passes without a token, so local dev and e2e work without an account", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await verifyTurnstile(null)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("when Turnstile is configured", () => {
  beforeEach(() => {
    process.env.TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA";
  });

  test("a missing token fails rather than being skipped", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await verifyTurnstile(null)).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("an over-long token is rejected before any network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await verifyTurnstile("x".repeat(2049))).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("accepts a token Cloudflare reports as successful", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    expect(await verifyTurnstile("good-token")).toBe(true);
  });

  test("rejects a token Cloudflare reports as failed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }), {
        status: 200,
      })
    );
    expect(await verifyTurnstile("bad-token")).toBe(false);
  });

  test("fails closed when Cloudflare is unreachable", async () => {
    // Deliberately the opposite of the breached-password check, which
    // fails open: this one is what stands between a script and bulk
    // account creation, so an outage must not become a bypass.
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    expect(await verifyTurnstile("any-token")).toBe(false);
  });

  test("fails closed on a non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    expect(await verifyTurnstile("any-token")).toBe(false);
  });

  test("sends the secret and token, and omits remoteip when unknown", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    await verifyTurnstile("tok", "unknown");

    const [, init] = fetchSpy.mock.calls[0]!;
    const body = (init!.body as URLSearchParams).toString();
    expect(body).toContain("secret=1x0000000000000000000000000000000AA");
    expect(body).toContain("response=tok");
    expect(body).not.toContain("remoteip");
  });

  test("includes remoteip when a real client IP is known", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    await verifyTurnstile("tok", "203.0.113.5");

    const [, init] = fetchSpy.mock.calls[0]!;
    expect((init!.body as URLSearchParams).toString()).toContain("remoteip=203.0.113.5");
  });
});
