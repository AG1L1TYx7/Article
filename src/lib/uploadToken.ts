import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Binds a pre-signed upload key to the person who asked for it.
 *
 * Finalising an upload means taking a storage key from the client and
 * telling the server to fetch and process that object. Without this,
 * anyone who could call finalize could aim it at any key in the bucket.
 * The token says: this server issued this key, to this account, recently.
 *
 * Stateless on purpose — no row to create at request time and no orphan
 * to clean up when a browser abandons an upload, which it will.
 */

const TTL_MS = 30 * 60 * 1000;

function secret(): string {
  const value = process.env.AUTH_SECRET;
  // Everything else in the app already refuses to run without this.
  if (!value) throw new Error("AUTH_SECRET is required to sign upload tokens");
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function signUploadKey(storageKey: string, userId: string): string {
  const expiresAt = Date.now() + TTL_MS;
  const payload = `${storageKey}:${userId}:${expiresAt}`;
  return `${expiresAt}.${sign(payload)}`;
}

/**
 * True when this token was issued for exactly this key and account and
 * has not expired.
 *
 * Compared in constant time. The comparison is of HMACs rather than
 * secrets, so a timing leak here is not catastrophic, but there is no
 * reason to hand one out.
 */
export function verifyUploadKey(token: string, storageKey: string, userId: string): boolean {
  const separator = token.indexOf(".");
  if (separator === -1) return false;

  const expiresAt = Number(token.slice(0, separator));
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  const expected = sign(`${storageKey}:${userId}:${expiresAt}`);
  const provided = token.slice(separator + 1);

  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  // timingSafeEqual throws on a length mismatch, which would itself leak.
  if (expectedBytes.length !== providedBytes.length) return false;
  return timingSafeEqual(expectedBytes, providedBytes);
}
