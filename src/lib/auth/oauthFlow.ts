import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { LEGAL } from "@/lib/legal";

/**
 * The two pieces of state that have to survive the trip out to Google and
 * back, neither of which can live in a session — because at both moments
 * there is no session yet.
 *
 *   1. **Consent.** GDPR Art. 7(1) requires the controller to be able to
 *      demonstrate that consent was given. A checkbox in a form that then
 *      redirects to Google proves nothing on its own: the account is
 *      created on the way back, in a different request. So pressing
 *      "Continue with Google" on the registration page mints a signed
 *      token recording *which version* of the terms was accepted and
 *      when, and the signIn callback refuses to create a new account
 *      without it. See lib/auth/config.ts.
 *
 *   2. **A pending second factor.** An account with two-factor enabled
 *      must not be handed a session merely because Google recognised it —
 *      that would make "Sign in with Google" a way around the second
 *      factor, and for admins the second factor is mandatory. The Google
 *      leg therefore ends in a redirect carrying a signed token naming the
 *      account, and no session is issued until the code is entered and the
 *      "mfa-continue" provider mints one. See /login/mfa.
 *
 * Both are HMAC-signed with a key derived from AUTH_SECRET, the same
 * secret behind the trusted-device cookie and the encryption of MFA
 * secrets — so rotating it invalidates all of them together, which is the
 * behaviour you want from a compromised key.
 *
 * Both are deliberately stateless: no table, nothing to purge, nothing for
 * a cron job on shared hosting to get wrong. Short lifetimes do the work a
 * revocation list otherwise would.
 */

/** Long enough to read a terms page and approve a Google consent screen. */
const CONSENT_TTL_MS = 30 * 60 * 1000;
/** Long enough to fetch a phone and read a code off it, and no longer. */
const STEP_UP_TTL_MS = 5 * 60 * 1000;

export const CONSENT_COOKIE = "oauth_consent";

function key(purpose: string): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET must be set to sign OAuth flow tokens");
  return createHash("sha256").update(`${purpose}:${secret}`).digest();
}

function sign(purpose: string, body: string): string {
  return createHmac("sha256", key(purpose)).update(body).digest("base64url");
}

function encode(purpose: string, payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(purpose, body)}`;
}

function decode<T>(purpose: string, token: string | undefined | null): T | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = sign(purpose, body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Consent

interface ConsentPayload {
  /** Which version of the terms and privacy policy was shown. */
  p: string;
  /** Accepted at, unix seconds — the moment recorded, not the moment stored. */
  a: number;
  /** Expiry, unix seconds. */
  e: number;
}

export function issueConsentToken(): { token: string; expires: Date } {
  const now = Date.now();
  const expires = new Date(now + CONSENT_TTL_MS);
  return {
    token: encode("oauth-consent", {
      p: LEGAL.policyVersion,
      a: Math.floor(now / 1000),
      e: Math.floor(expires.getTime() / 1000),
    } satisfies ConsentPayload),
    expires,
  };
}

/**
 * The moment consent was given, or null if there is no valid record of it.
 *
 * A token that names a policy version other than the current one is
 * refused rather than accepted: if the terms changed while the person was
 * at Google, they agreed to something that is no longer what they would be
 * agreeing to, and the honest response is to ask again.
 */
export function readConsentToken(token: string | undefined | null): Date | null {
  const payload = decode<ConsentPayload>("oauth-consent", token);
  if (!payload) return null;
  if (payload.p !== LEGAL.policyVersion) return null;
  if (payload.e * 1000 <= Date.now()) return null;
  const acceptedAt = new Date(payload.a * 1000);
  return Number.isFinite(acceptedAt.getTime()) ? acceptedAt : null;
}

// ---------------------------------------------------------------------------
// Pending second factor

interface AccountPayload {
  /** User id. */
  u: string;
  /** sessionVersion at issue — so "log out everywhere" invalidates this too. */
  v: number;
  /** Expiry, unix seconds. */
  e: number;
}

function issueAccountToken(
  purpose: string,
  ttlMs: number,
  user: { id: string; sessionVersion: number }
): string {
  return encode(purpose, {
    u: user.id,
    v: user.sessionVersion,
    e: Math.floor((Date.now() + ttlMs) / 1000),
  } satisfies AccountPayload);
}

function readAccountToken(
  purpose: string,
  token: string | undefined | null
): { userId: string; sessionVersion: number } | null {
  const payload = decode<AccountPayload>(purpose, token);
  if (!payload) return null;
  if (payload.e * 1000 <= Date.now()) return null;
  if (typeof payload.u !== "string" || typeof payload.v !== "number") return null;
  return { userId: payload.u, sessionVersion: payload.v };
}

export function issueStepUpToken(user: { id: string; sessionVersion: number }): string {
  return issueAccountToken("oauth-stepup", STEP_UP_TTL_MS, user);
}

/**
 * Who this pending second factor is for, or null.
 *
 * Carrying only an id and a version means the token is worthless on its
 * own: whoever holds it still has to produce a current six-digit code for
 * that account, and the account's sessionVersion must not have moved.
 */
export function readStepUpToken(
  token: string | undefined | null
): { userId: string; sessionVersion: number } | null {
  return readAccountToken("oauth-stepup", token);
}

// ---------------------------------------------------------------------------
// Connecting Google to an account that is already signed in

/**
 * "Connect Google" from the account page is a different act from signing
 * in with it, and has to be told apart from one.
 *
 * Signing in matches on the email address; connecting does not, because
 * somebody may well want to attach a Google account whose address is not
 * the one they registered with — and they are already signed in, so there
 * is nothing left to prove about who they are.
 *
 * Carried in its own cookie rather than inferred from the session inside
 * the signIn callback, which would mean calling auth() from the module
 * that defines it. Being explicit also means the intent expires: a
 * half-finished connect cannot sit around and change the meaning of an
 * ordinary Google sign-in an hour later.
 */
export const CONNECT_COOKIE = "oauth_connect";
const CONNECT_TTL_MS = 10 * 60 * 1000;

export function issueConnectToken(user: { id: string; sessionVersion: number }): string {
  return issueAccountToken("oauth-connect", CONNECT_TTL_MS, user);
}

export function readConnectToken(
  token: string | undefined | null
): { userId: string; sessionVersion: number } | null {
  return readAccountToken("oauth-connect", token);
}
