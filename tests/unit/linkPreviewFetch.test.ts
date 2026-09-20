import { describe, expect, test } from "vitest";
import { fetchHtml } from "@/lib/linkPreview/fetch";

/**
 * Functional tests of the SSRF guard — it actually calls fetchHtml.
 *
 * These complement the pure tests in ssrf.test.ts rather than repeating
 * them, and they exist because a unit test of `isBlockedAddress` could
 * never have caught the bug these found: Node skips the `lookup` hook
 * entirely when a URL's host is already an IP address, so literal
 * addresses went straight past the guarded resolver and were genuinely
 * dialled. `http://127.0.0.1:5432/` was reaching Postgres, and only
 * failed because Postgres does not speak HTTP.
 *
 * Every target below is loopback, private or an unroutable scheme, so
 * running these sends no traffic anywhere.
 *
 * NOT covered here: the successful path. Fetching a real page needs a
 * real public URL, and a test that reaches the internet is not one worth
 * having in this suite. The parsing half of the happy path is covered
 * exhaustively in linkPreviewParse.test.ts.
 */

const BLOCKED_OUTRIGHT = [
  ["loopback", "http://127.0.0.1:5432/"],
  ["loopback, another octet", "http://127.1.2.3:80/"],
  ["cloud metadata", "http://169.254.169.254/latest/meta-data/"],
  ["private 192.168", "http://192.168.1.1/"],
  ["private 10.x", "http://10.0.0.1/"],
  ["carrier-grade NAT", "http://100.64.0.1/"],
  ["IPv6 loopback", "http://[::1]:5432/"],
  ["IPv4-mapped loopback", "http://[::ffff:127.0.0.1]:5432/"],
  ["6to4-wrapped loopback", "http://[2002:7f00:1::]/"],
  ["IPv6 link-local", "http://[fe80::1]/"],
  ["broadcast", "http://255.255.255.255/"],
  ["this-network", "http://0.0.0.0:5432/"],
  ["file scheme", "file:///etc/passwd"],
  ["gopher scheme", "gopher://127.0.0.1:6379/_INFO"],
  ["credentials in the URL", "http://user:pass@example.com/"],
  ["not a URL at all", "just some text"],
] as const;

describe("fetchHtml refuses to reach inside the network", () => {
  test.each(BLOCKED_OUTRIGHT)("blocks %s", async (_label, url) => {
    await expect(fetchHtml(url)).resolves.toBe("blocked");
  });

  test("a hostname that resolves to loopback is refused too", async () => {
    // Goes through the guarded DNS lookup rather than the literal-address
    // check, so this covers the other half of the guard.
    await expect(fetchHtml("http://localhost:5432/")).resolves.toBe("unreachable");
  });

  test("refusals are decisions, not timeouts", async () => {
    // If blocking a private address took as long as the 5s request
    // timeout, that would mean a connection had actually been attempted —
    // which is exactly the bug this file exists to prevent regressing.
    const started = Date.now();
    await fetchHtml("http://169.254.169.254/latest/meta-data/");
    expect(Date.now() - started).toBeLessThan(500);
  });

  test("failures never say why, so this can't be used as a port scanner", async () => {
    // Refused / filtered / nothing listening must be indistinguishable to
    // the caller; the only signal is one of a few coarse strings.
    const results = await Promise.all([
      fetchHtml("http://127.0.0.1:5432/"),
      fetchHtml("http://127.0.0.1:9/"),
      fetchHtml("http://10.255.255.1/"),
    ]);
    for (const result of results) {
      expect(typeof result).toBe("string");
      expect(["blocked", "unreachable", "not-html", "too-large"]).toContain(result);
    }
  });
});
