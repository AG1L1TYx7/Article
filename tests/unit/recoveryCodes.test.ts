import { describe, expect, test } from "vitest";
import {
  consumeRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  hashRecoveryCodes,
  looksLikeRecoveryCode,
  normaliseRecoveryCode,
  parseStoredCodes,
} from "@/lib/auth/recoveryCodes";

const SECRET = "unit-test-secret";

describe("generateRecoveryCodes", () => {
  test("makes ten distinct, dashed, unambiguous codes", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}$/);
      // No 0/O/1/I/L: the alphabet leaves them out on purpose.
      expect(code).not.toMatch(/[01oil]/);
    }
  });
});

describe("hashing", () => {
  test("is keyed: the same code hashes differently under another secret", () => {
    expect(hashRecoveryCode("abcd-efgh", SECRET)).not.toBe(hashRecoveryCode("abcd-efgh", "other"));
  });

  test("ignores case, the dash and spaces", () => {
    expect(hashRecoveryCode("ABCD-EFGH", SECRET)).toBe(hashRecoveryCode("abcd efgh", SECRET));
    expect(normaliseRecoveryCode(" ABCD-EFGH ")).toBe("abcdefgh");
  });

  test("looksLikeRecoveryCode accepts the shape and nothing else", () => {
    expect(looksLikeRecoveryCode("abcd-efgh")).toBe(true);
    expect(looksLikeRecoveryCode("ABCDEFGH")).toBe(true);
    expect(looksLikeRecoveryCode("123456")).toBe(false);
    expect(looksLikeRecoveryCode("abcdefg")).toBe(false);
    expect(looksLikeRecoveryCode("abcd-efgh-x")).toBe(false);
  });
});

describe("consumeRecoveryCode", () => {
  test("a valid code is accepted once and removed", () => {
    const codes = generateRecoveryCodes();
    const stored = hashRecoveryCodes(codes, SECRET);

    const first = consumeRecoveryCode(stored, codes[3]!, SECRET);
    expect(first.matched).toBe(true);
    expect(first.remaining).toHaveLength(9);

    const again = consumeRecoveryCode(first.remaining, codes[3]!, SECRET);
    expect(again.matched).toBe(false);
    expect(again.remaining).toHaveLength(9);
  });

  test("a wrong code changes nothing", () => {
    const stored = hashRecoveryCodes(generateRecoveryCodes(), SECRET);
    const result = consumeRecoveryCode(stored, "zzzz-zzzz", SECRET);
    expect(result.matched).toBe(false);
    expect(result.remaining).toEqual(stored);
  });

  test("an empty list never matches", () => {
    expect(consumeRecoveryCode([], "abcd-efgh", SECRET).matched).toBe(false);
  });
});

describe("parseStoredCodes", () => {
  test("tolerates null, junk and non-string entries", () => {
    expect(parseStoredCodes(null)).toEqual([]);
    expect(parseStoredCodes("not json")).toEqual([]);
    expect(parseStoredCodes(JSON.stringify(["a", 1, null, "b"]))).toEqual(["a", "b"]);
  });
});
