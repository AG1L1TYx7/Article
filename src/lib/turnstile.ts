/**
 * Cloudflare Turnstile verification.
 *
 * Follows the same dev-fallback pattern as lib/email.ts and
 * lib/rateLimit.ts: with no TURNSTILE_SECRET_KEY configured the check is
 * skipped entirely, so local development and the e2e suite run without a
 * Cloudflare account. Set the secret (and NEXT_PUBLIC_TURNSTILE_SITE_KEY)
 * and it becomes mandatory — there is no way to be half-configured, since
 * the widget only renders when the public key is present and the check
 * only runs when the secret is.
 *
 * Cloudflare publishes dummy keys for testing, so this path can be
 * exercised end to end without signing up — see .env.example.
 */
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function isTurnstileEnabled(): boolean {
  return !!process.env.TURNSTILE_SECRET_KEY;
}

export async function verifyTurnstile(token: string | null, ip?: string): Promise<boolean> {
  if (!isTurnstileEnabled()) return true;
  // A configured deployment must receive a token; a missing one is a
  // failed check, never a skipped one.
  if (!token) return false;
  // Documented hard cap — reject before spending a network round trip.
  if (token.length > 2048) return false;

  try {
    const body = new URLSearchParams({
      secret: process.env.TURNSTILE_SECRET_KEY!,
      response: token,
    });
    if (ip && ip !== "unknown") body.set("remoteip", ip);

    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;

    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    // Fail closed. Unlike the breached-password lookup (which fails open
    // so an outage can't lock people out of registering), this check is
    // the thing standing between a script and bulk account creation —
    // letting it through on error would defeat the point.
    return false;
  }
}
