import { headers } from "next/headers";
import { siteUrl } from "@/lib/siteUrl";

/**
 * Absolute origin for building links in emails (verify, reset password).
 *
 * **Prefers the configured origin over the request's Host header**, and
 * that ordering is the whole point.
 *
 * These links are the most security-sensitive strings this application
 * produces: a password-reset link is a bearer token for an account. Built
 * from `Host` / `X-Forwarded-Host`, they are built from something the
 * client sends. Anybody could POST to /forgot-password — an unauthenticated
 * endpoint, for any address they like — with `Host: attacker.example`, and
 * the victim would receive a genuine email, from the real sender, carrying
 * a real token, pointing at the attacker's origin. Opening it hands over
 * the token.
 *
 * The usual answer is "a reverse proxy overwrites Host", and in this
 * deployment Cloudflare does. But that makes the safety of a password
 * reset depend on infrastructure sitting in front of the app, and the
 * cPanel path (docs/cpanel.md) has no such guarantee. The origin is
 * already configured — NEXTAUTH_URL is required of every deployment and
 * SITE_URL overrides it — so there is no reason to ask the client.
 *
 * The request host is used only when neither is configured, which is local
 * development. `trustHost: true` in lib/auth/config.ts is a separate,
 * deliberate decision about Auth.js's own callback URLs and is unaffected.
 */
export async function getBaseUrl(): Promise<string> {
  const configured = process.env.SITE_URL ?? process.env.NEXTAUTH_URL;
  if (configured) return siteUrl().origin;

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  if (host) return `${proto}://${host}`;
  return "http://localhost:3000";
}
