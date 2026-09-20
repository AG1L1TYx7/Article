import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { signUploadKey, verifyUploadKey } from "@/lib/uploadToken";
import { isQuarantineKey, QUARANTINE_PREFIX } from "@/lib/storage";

/**
 * These two guard the same door. Finalising an upload takes a storage key
 * from the client and tells the server to fetch and process that object,
 * so the key must be one this server issued, to this account, recently —
 * otherwise finalize is a "fetch anything in the bucket" endpoint.
 */

const KEY = `${QUARANTINE_PREFIX}3f2504e0-4f89-11d3-9a0c-0305e82c3301.mp4`;
const USER = "user_abc123";

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret-for-upload-tokens";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("upload tokens", () => {
  test("a token verifies for the key and account it was issued to", () => {
    expect(verifyUploadKey(signUploadKey(KEY, USER), KEY, USER)).toBe(true);
  });

  test("a token for one key does not work for another", () => {
    // The whole point: a moderator cannot aim finalize at a different
    // object by swapping the key.
    const other = `${QUARANTINE_PREFIX}00000000-0000-0000-0000-000000000000.mp4`;
    expect(verifyUploadKey(signUploadKey(KEY, USER), other, USER)).toBe(false);
  });

  test("a token issued to one account does not work for another", () => {
    expect(verifyUploadKey(signUploadKey(KEY, USER), KEY, "someone_else")).toBe(false);
  });

  test("a token expires", () => {
    const token = signUploadKey(KEY, USER);
    expect(verifyUploadKey(token, KEY, USER)).toBe(true);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31 * 60 * 1000);
    expect(verifyUploadKey(token, KEY, USER)).toBe(false);
  });

  test("an expiry cannot be pushed back by editing the token", () => {
    // The expiry is inside the signed payload, so rewriting the visible
    // copy invalidates the signature rather than extending the lifetime.
    const token = signUploadKey(KEY, USER);
    const signature = token.slice(token.indexOf(".") + 1);
    const forged = `${Date.now() + 10 * 60 * 60 * 1000}.${signature}`;
    expect(verifyUploadKey(forged, KEY, USER)).toBe(false);
  });

  test("garbage is rejected rather than throwing", () => {
    for (const token of ["", "nonsense", ".", "abc.def", "123456789"]) {
      expect(() => verifyUploadKey(token, KEY, USER)).not.toThrow();
      expect(verifyUploadKey(token, KEY, USER), token).toBe(false);
    }
  });

  test("a signature of the wrong length is rejected, not crashed on", () => {
    // timingSafeEqual throws on a length mismatch, which would turn a
    // forged token into a 500 instead of a refusal.
    const token = signUploadKey(KEY, USER);
    const truncated = `${token.slice(0, token.indexOf(".") + 1)}short`;
    expect(verifyUploadKey(truncated, KEY, USER)).toBe(false);
  });
});

describe("isQuarantineKey", () => {
  test("accepts a key this server issues", () => {
    expect(isQuarantineKey(KEY)).toBe(true);
    expect(isQuarantineKey(`${QUARANTINE_PREFIX}3f2504e0-4f89-11d3-9a0c-0305e82c3301.webp`)).toBe(true);
  });

  test("rejects anything outside the quarantine prefix", () => {
    // A servable key must never be finalisable: that would let a
    // moderator re-process, and potentially overwrite, live media.
    expect(isQuarantineKey("3f2504e0-4f89-11d3-9a0c-0305e82c3301.mp4")).toBe(false);
    expect(isQuarantineKey("other/3f2504e0-4f89-11d3-9a0c-0305e82c3301.mp4")).toBe(false);
  });

  test("rejects attempts to climb out of the prefix", () => {
    for (const key of [
      `${QUARANTINE_PREFIX}../secrets.env`,
      `${QUARANTINE_PREFIX}../../etc/passwd`,
      `${QUARANTINE_PREFIX}sub/dir/file.mp4`,
      `${QUARANTINE_PREFIX}.mp4`,
      `${QUARANTINE_PREFIX}not-a-uuid.mp4`,
    ]) {
      expect(isQuarantineKey(key), key).toBe(false);
    }
  });

  test("rejects an empty or missing key", () => {
    expect(isQuarantineKey("")).toBe(false);
    expect(isQuarantineKey(QUARANTINE_PREFIX)).toBe(false);
  });
});
