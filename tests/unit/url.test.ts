import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The origin that password-reset and verification links are built from.
 *
 * A reset link is a bearer token for an account, so the origin it points
 * at decides who receives that token. The one thing these tests exist to
 * prevent is that origin coming from the request.
 */

const ORIGINAL = { SITE_URL: process.env.SITE_URL, NEXTAUTH_URL: process.env.NEXTAUTH_URL };

/** A request whose Host headers are whatever an attacker sent. */
function mockHeaders(values: Record<string, string>) {
  vi.doMock("next/headers", () => ({
    headers: async () => ({ get: (name: string) => values[name.toLowerCase()] ?? null }),
  }));
}

beforeEach(() => {
  vi.resetModules();
  delete process.env.SITE_URL;
  delete process.env.NEXTAUTH_URL;
});

afterEach(() => {
  vi.doUnmock("next/headers");
  if (ORIGINAL.SITE_URL === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = ORIGINAL.SITE_URL;
  if (ORIGINAL.NEXTAUTH_URL === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = ORIGINAL.NEXTAUTH_URL;
});

describe("getBaseUrl", () => {
  it("ignores a spoofed Host when the origin is configured", async () => {
    // The attack: POST /forgot-password for somebody else's address with
    // Host: attacker.example. They get a genuine email, from the real
    // sender, carrying a real token — pointing at the attacker.
    process.env.NEXTAUTH_URL = "https://pratipaxey.example";
    mockHeaders({ host: "attacker.example", "x-forwarded-host": "attacker.example" });

    const { getBaseUrl } = await import("@/lib/url");
    expect(await getBaseUrl()).toBe("https://pratipaxey.example");
  });

  it("ignores a spoofed X-Forwarded-Host too", async () => {
    process.env.SITE_URL = "https://pratipaxey.example";
    mockHeaders({ host: "pratipaxey.example", "x-forwarded-host": "attacker.example" });

    const { getBaseUrl } = await import("@/lib/url");
    expect(await getBaseUrl()).toBe("https://pratipaxey.example");
  });

  it("prefers SITE_URL over NEXTAUTH_URL", async () => {
    process.env.SITE_URL = "https://public.example";
    process.env.NEXTAUTH_URL = "https://internal.example";
    mockHeaders({});

    const { getBaseUrl } = await import("@/lib/url");
    expect(await getBaseUrl()).toBe("https://public.example");
  });

  it("returns an origin, never a path a configured URL happened to carry", async () => {
    process.env.NEXTAUTH_URL = "https://pratipaxey.example/some/path";
    mockHeaders({});

    const { getBaseUrl } = await import("@/lib/url");
    // Links are built as `${base}/reset-password?…`, so a trailing path
    // would produce a URL that 404s.
    expect(await getBaseUrl()).toBe("https://pratipaxey.example");
  });

  it("falls back to the request host only when nothing is configured", async () => {
    // Local development, where neither variable is set.
    mockHeaders({ host: "localhost:3000" });

    const { getBaseUrl } = await import("@/lib/url");
    expect(await getBaseUrl()).toBe("http://localhost:3000");
  });
});
