import { describe, expect, test } from "vitest";
import { isSixDigitCode, maskPhone, normalisePhone } from "@/lib/phoneFormat";

describe("normalisePhone", () => {
  test("accepts international numbers however they are punctuated", () => {
    expect(normalisePhone("+977 98 1234 5678")).toBe("+9779812345678");
    expect(normalisePhone("+44 (0)7700 900831")).toBe("+447700900831");
    expect(normalisePhone("+1-415-555-0100")).toBe("+14155550100");
    expect(normalisePhone("0044 7700 900831")).toBe("+447700900831");
  });

  test("refuses anything that is not unambiguously a phone number", () => {
    expect(normalisePhone("07700 900831")).toBeNull(); // no country code
    expect(normalisePhone("+0 123")).toBeNull(); // country codes never start with 0
    expect(normalisePhone("+12345")).toBeNull(); // too short
    expect(normalisePhone("+1234567890123456")).toBeNull(); // too long
    expect(normalisePhone("call me")).toBeNull();
  });
});

describe("maskPhone", () => {
  test("keeps the country code and last three digits only", () => {
    const masked = maskPhone("+447700900831");
    expect(masked.startsWith("+44 ")).toBe(true);
    expect(masked.endsWith(" 831")).toBe(true);
    expect(masked).not.toContain("7700");
    expect(masked).toMatch(/•/);
  });

  test("handles a short number without exposing more than it should", () => {
    const masked = maskPhone("+3312345678");
    expect(masked.endsWith(" 678")).toBe(true);
    expect(masked).not.toContain("12345");
  });
});

describe("isSixDigitCode", () => {
  test("exactly six digits, whitespace tolerated", () => {
    expect(isSixDigitCode("482917")).toBe(true);
    expect(isSixDigitCode(" 482917 ")).toBe(true);
    expect(isSixDigitCode("48291")).toBe(false);
    expect(isSixDigitCode("48291a")).toBe(false);
  });
});
