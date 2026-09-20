import { describe, expect, test } from "vitest";
import { isBlockedAddress } from "@/lib/linkPreview/ssrf";

/**
 * These are the tests that matter most in the link-preview feature. The
 * fetcher is only as safe as this function, and a gap here is invisible
 * in normal use — everything keeps working, it just also reaches the
 * cloud metadata endpoint.
 */
describe("isBlockedAddress — IPv4", () => {
  test("allows ordinary public addresses", () => {
    for (const ip of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "151.101.1.140"]) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  test("blocks loopback", () => {
    for (const ip of ["127.0.0.1", "127.1.2.3", "127.255.255.254"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  test("blocks the cloud metadata address", () => {
    // The single most valuable SSRF target on any cloud host.
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
  });

  test("blocks every private range", () => {
    for (const ip of [
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.1",
      "192.168.255.255",
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  test("allows addresses just outside the private ranges", () => {
    // Guards against an off-by-one in the mask arithmetic.
    for (const ip of ["9.255.255.255", "11.0.0.0", "172.15.255.255", "172.32.0.0", "192.167.255.255", "192.169.0.0"]) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  test("blocks the ranges people forget", () => {
    for (const ip of [
      "0.0.0.0", // still reaches localhost on some stacks
      "0.1.2.3",
      "100.64.0.1", // carrier-grade NAT
      "100.127.255.255",
      "192.0.0.1", // IETF protocol assignments
      "192.0.2.5", // TEST-NET-1
      "192.88.99.1", // 6to4 relay anycast
      "198.18.0.1", // benchmarking
      "198.51.100.5", // TEST-NET-2
      "203.0.113.5", // TEST-NET-3
      "224.0.0.1", // multicast
      "239.255.255.255",
      "240.0.0.1", // reserved
      "255.255.255.255", // broadcast
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  test("rejects octal and other non-decimal spellings of an octet", () => {
    // 0177.0.0.1 is 127.0.0.1 to some resolvers. This code refuses to
    // guess: anything that isn't a plain decimal dotted quad is blocked.
    for (const ip of ["0177.0.0.1", "0x7f.0.0.1", "127.0.1", "1.2.3.4.5"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });
});

describe("isBlockedAddress — IPv6", () => {
  test("allows ordinary public addresses", () => {
    for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888"]) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  test("blocks loopback and unspecified", () => {
    for (const ip of ["::1", "::", "0:0:0:0:0:0:0:1"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  test("blocks unique-local, link-local and multicast", () => {
    for (const ip of ["fc00::1", "fd12:3456::1", "fe80::1", "febf::1", "ff02::1"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  test("blocks documentation and discard ranges", () => {
    expect(isBlockedAddress("2001:db8::1")).toBe(true);
    expect(isBlockedAddress("100::1")).toBe(true);
  });

  test("sees through IPv4-mapped addresses", () => {
    // ::ffff:127.0.0.1 is loopback wearing an IPv6 coat — the single most
    // common way an IPv4 denylist gets bypassed.
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedAddress("::ffff:10.0.0.1")).toBe(true);
    // The same wrapper around a public address is fine.
    expect(isBlockedAddress("::ffff:8.8.8.8")).toBe(false);
  });

  test("sees through 6to4 and NAT64 wrappers", () => {
    expect(isBlockedAddress("2002:7f00:0001::")).toBe(true); // 6to4 of 127.0.0.1
    expect(isBlockedAddress("2002:a9fe:a9fe::")).toBe(true); // 6to4 of 169.254.169.254
    expect(isBlockedAddress("64:ff9b::127.0.0.1")).toBe(true); // NAT64 of loopback
    expect(isBlockedAddress("64:ff9b::8.8.8.8")).toBe(false); // NAT64 of a public host
  });

  test("ignores a zone identifier when judging the address", () => {
    expect(isBlockedAddress("fe80::1%eth0")).toBe(true);
  });
});

describe("isBlockedAddress — fails closed", () => {
  test("anything that is not an IP address at all is blocked", () => {
    for (const value of ["", "localhost", "example.com", "not-an-ip", "::gggg", "999.1.1.1"]) {
      expect(isBlockedAddress(value), value).toBe(true);
    }
  });
});
