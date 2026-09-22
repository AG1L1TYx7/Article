import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { decryptSecret, encryptSecret } from "@/lib/auth/crypto";

/**
 * How a phone number is held, and how its verification code is checked.
 *
 * The number itself is encrypted at rest (AES-256-GCM keyed from
 * AUTH_SECRET, the same as the MFA secret) so it can be shown back to
 * its owner and used to send them a message. Beside it sits a keyed
 * hash (HMAC-SHA256) so "is this number already on another account" can
 * be answered with a unique index, without the number being readable in
 * the index. A database dump therefore yields neither.
 *
 * The six-digit code is never stored: only its hash, keyed by the
 * secret AND the account id, so a code minted for one account cannot be
 * replayed against another. Comparison is constant time.
 */

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET must be set to protect phone numbers");
  return s;
}

export function encryptPhone(e164: string): string {
  return encryptSecret(e164);
}

export function decryptPhone(payload: string): string {
  return decryptSecret(payload);
}

export function phoneHash(e164: string): string {
  return createHmac("sha256", secret()).update(`phone:${e164}`).digest("hex");
}

export const PHONE_CODE_TTL_MS = 10 * 60 * 1000;
export const PHONE_CODE_MAX_ATTEMPTS = 5;

export function generatePhoneCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashPhoneCode(code: string, userId: string): string {
  return createHmac("sha256", secret()).update(`phone-code:${userId}:${code.trim()}`).digest("hex");
}

export function phoneCodeMatches(stored: string | null | undefined, code: string, userId: string): boolean {
  if (!stored) return false;
  const a = Buffer.from(stored, "hex");
  const b = Buffer.from(hashPhoneCode(code, userId), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
