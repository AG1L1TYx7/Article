import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Recovery codes: the way back in when the authenticator is gone.
 *
 * Ten codes are generated when two-factor is enabled and shown exactly
 * once. Each is single use. What is stored is a keyed hash of each code
 * (HMAC-SHA256 under AUTH_SECRET), so a database dump yields nothing a
 * thief could type in, the same standing the password hash has.
 *
 * Eight characters from a 32-symbol alphabet is 40 bits — with the login
 * rate limit and lockout in front of it, out of reach of guessing, and
 * short enough to read out over the phone. Ambiguous glyphs (0/O, 1/I/L)
 * are left out of the alphabet for the same reason.
 *
 * Pure apart from the random source, so it can be unit tested with a
 * fixed secret.
 */

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const RECOVERY_CODE_COUNT = 10;

function secretKey(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET must be set to hash recovery codes");
  return secret;
}

/** Lowercases and strips the dash and any spaces, so "ABCD-EFGH" and "abcd efgh" match. */
export function normaliseRecoveryCode(input: string): string {
  return input.toLowerCase().replace(/[\s-]/g, "");
}

/** Shape check only — what the login form uses to tell a code from a TOTP. */
export function looksLikeRecoveryCode(input: string): boolean {
  return /^[a-z0-9]{8}$/.test(normaliseRecoveryCode(input));
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  while (codes.length < count) {
    const bytes = randomBytes(8);
    let code = "";
    for (const b of bytes) code += ALPHABET[b % ALPHABET.length];
    // Dashed for reading; the dash is ignored on entry.
    codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
  }
  return codes;
}

export function hashRecoveryCode(code: string, secret = secretKey()): string {
  return createHmac("sha256", secret).update(normaliseRecoveryCode(code)).digest("hex");
}

export function hashRecoveryCodes(codes: string[], secret = secretKey()): string[] {
  return codes.map((c) => hashRecoveryCode(c, secret));
}

/**
 * Checks a code against the stored hashes. On a match, returns the list
 * with that one removed — the caller stores it back, which is what makes
 * the code single use. Compared in constant time, every entry, so a
 * partial match costs the same as none.
 */
export function consumeRecoveryCode(
  storedHashes: string[],
  code: string,
  secret = secretKey()
): { matched: boolean; remaining: string[] } {
  const candidate = Buffer.from(hashRecoveryCode(code, secret), "hex");
  let matchedIndex = -1;
  for (let i = 0; i < storedHashes.length; i++) {
    const stored = Buffer.from(storedHashes[i]!, "hex");
    if (stored.length === candidate.length && timingSafeEqual(stored, candidate) && matchedIndex === -1) {
      matchedIndex = i;
    }
  }
  if (matchedIndex === -1) return { matched: false, remaining: storedHashes };
  return { matched: true, remaining: storedHashes.filter((_, i) => i !== matchedIndex) };
}

/** The column holds JSON; tolerate an empty or damaged value as "no codes". */
export function parseStoredCodes(column: string | null | undefined): string[] {
  if (!column) return [];
  try {
    const parsed = JSON.parse(column);
    return Array.isArray(parsed) ? parsed.filter((h) => typeof h === "string") : [];
  } catch {
    return [];
  }
}
