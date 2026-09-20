/**
 * CSRF protection for plain Route Handlers.
 *
 * Server Actions get this for free — Next.js compares the request's
 * Origin to its Host and rejects a mismatch (see the "CSRF check" note in
 * the framework's server-actions docs). A plain Route Handler under /api/
 * gets no such thing automatically, and this app has three of them
 * (media upload, upload-url, finalize) that are cookie-authenticated and
 * state-changing — exactly the shape a CSRF attack targets.
 *
 * The session cookie is also SameSite=Lax, which independently stops it
 * from being sent on a cross-site POST in any modern browser. This is a
 * second, explicit layer for the browsers or proxies that don't apply
 * SameSite correctly, and because "we get it for free from a cookie flag
 * nobody has to think about" is a fragile thing to depend on alone.
 */

/**
 * True when the request's Origin does not match its own Host.
 *
 * A request with no Origin header at all (a same-origin GET, most
 * non-browser HTTP clients, curl) is allowed through — Origin is sent by
 * browsers specifically on state-changing cross-origin-capable requests,
 * so its absence is not itself suspicious. What matters is that when it
 * IS present, it agrees with where the request landed.
 */
export function isCrossOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return true; // No Host at all is not a request we can trust.

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true; // An unparseable Origin is not one we can vouch for.
  }

  return originHost !== host;
}
