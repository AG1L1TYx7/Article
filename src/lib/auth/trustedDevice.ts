import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * "Remember this device" for two-factor authentication.
 *
 * After one successful code, the browser is given a signed cookie that
 * lets it skip the code for thirty days. Anything that should make the
 * site ask again does so automatically, because the token is bound to:
 *
 *   - the user id, so it cannot be moved to another account;
 *   - the user's sessionVersion, so "log out everywhere", a role change or
 *     a suspension (all of which bump it) revoke every trusted device;
 *   - a fingerprint of the current MFA secret, so re-enrolling MFA — the
 *     usual response to a lost phone — starts from zero trusted devices.
 *
 * Stateless by design: HMAC over the payload with AUTH_SECRET, the same key
 * that encrypts the MFA secrets. No table, nothing to clean up, nothing for
 * cPanel to run. The trade-off is that devices cannot be listed
 * individually; "forget this device" clears the cookie, and the account
 * page's re-enrol path forgets all of them.
 *
 * The password is still required on every login. This only removes the
 * second factor on a device that has already presented it once.
 */
export const TRUST_COOKIE = "mfa_trust";
export const TRUST_DAYS = 30;

interface Payload {
  u: string; // user id
  v: number; // sessionVersion at issue time
  m: string; // fingerprint of the MFA secret
  e: number; // expiry, unix seconds
}

function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET must be set to sign trusted-device tokens");
  return createHash("sha256").update("mfa-trust:" + secret).digest();
}

function sign(body: string): string {
  return createHmac("sha256", key()).update(body).digest("base64url");
}

export function mfaFingerprint(encryptedSecret: string): string {
  return createHash("sha256").update(encryptedSecret).digest("base64url").slice(0, 16);
}

export function issueTrustToken(user: { id: string; sessionVersion: number; mfaSecret: string }): {
  token: string;
  expires: Date;
} {
  const expires = new Date(Date.now() + TRUST_DAYS * 24 * 60 * 60 * 1000);
  const payload: Payload = {
    u: user.id,
    v: user.sessionVersion,
    m: mfaFingerprint(user.mfaSecret),
    e: Math.floor(expires.getTime() / 1000),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { token: `${body}.${sign(body)}`, expires };
}

/** True when the token is intact, unexpired and still describes this user. */
export function verifyTrustToken(
  token: string | undefined | null,
  user: { id: string; sessionVersion: number; mfaSecret: string | null }
): boolean {
  if (!token || !user.mfaSecret) return false;
  const [body, signature] = token.split(".");
  if (!body || !signature) return false;

  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return false;
  }
  return (
    payload.u === user.id &&
    payload.v === user.sessionVersion &&
    payload.m === mfaFingerprint(user.mfaSecret) &&
    payload.e * 1000 > Date.now()
  );
}

/** Expiry of a token as a Date, for display; null if it does not parse. */
export function trustTokenExpiry(token: string | undefined | null): Date | null {
  const body = token?.split(".")[0];
  if (!body) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Payload;
    return new Date(payload.e * 1000);
  } catch {
    return null;
  }
}

/** Pulls one cookie out of a raw Cookie header. */
export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}
