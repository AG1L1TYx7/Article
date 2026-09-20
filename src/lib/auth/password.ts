import argon2 from "argon2";
import { createHash } from "node:crypto";

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain);
}

/**
 * Checks a password against the HaveIBeenPwned breached-password list using
 * k-anonymity: only the first 5 chars of the SHA-1 hash leave the server,
 * so HIBP never sees the actual password.
 */
export async function isPasswordBreached(plain: string): Promise<boolean> {
  const sha1 = createHash("sha1").update(plain).digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false; // fail open: don't block registration on HIBP outage
    const body = await res.text();
    return body.split("\n").some((line) => line.startsWith(suffix));
  } catch {
    return false; // network failure — fail open, same reasoning
  }
}
