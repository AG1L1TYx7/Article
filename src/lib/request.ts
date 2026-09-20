import { headers } from "next/headers";

/**
 * Best-effort client IP for rate limiting and audit logs. Trusts
 * X-Forwarded-For because in production this app sits behind Cloudflare —
 * do not trust this header if deploying without a trusted reverse proxy in
 * front, since it would otherwise let a client spoof its own rate-limit key.
 */
export async function getClientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return h.get("x-real-ip") ?? "unknown";
}
