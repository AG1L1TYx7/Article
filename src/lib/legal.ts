import { SITE_NAME } from "@/lib/siteUrl";

/**
 * Who is legally responsible for this site — the "controller" in GDPR
 * terms, the "business" in CCPA terms. Read from the environment so the
 * same code serves any publisher; the privacy policy and terms pages
 * print these, and mark them loudly when they are missing, because a
 * privacy policy without a named controller is not a privacy policy.
 *
 *   LEGAL_ENTITY          e.g. "Dispatch Report Media Ltd"
 *   LEGAL_ADDRESS         postal address (one line, commas)
 *   LEGAL_CONTACT_EMAIL   where privacy requests go, e.g. privacy@…
 *   LEGAL_JURISDICTION    governing law for the terms, e.g. "England and Wales"
 *   LEGAL_DPO_EMAIL       optional: a Data Protection Officer, if appointed
 */
export const LEGAL = {
  entity: process.env.LEGAL_ENTITY || null,
  address: process.env.LEGAL_ADDRESS || null,
  contactEmail: process.env.LEGAL_CONTACT_EMAIL || null,
  jurisdiction: process.env.LEGAL_JURISDICTION || null,
  dpoEmail: process.env.LEGAL_DPO_EMAIL || null,
  siteName: SITE_NAME,
  /** Bumped whenever the policy or terms change materially. */
  policyVersion: "2026-09-20",
};

export const LEGAL_COMPLETE = !!(LEGAL.entity && LEGAL.address && LEGAL.contactEmail && LEGAL.jurisdiction);

/** Which third parties currently receive personal data, from the environment. */
export function activeProcessors(): { name: string; purpose: string; data: string; region: string }[] {
  const list = [];
  if (process.env.RESEND_API_KEY) {
    list.push({ name: "Resend", purpose: "Sending transactional email (verification, password reset)", data: "Email address, message content", region: "United States" });
  }
  if (process.env.S3_BUCKET) {
    list.push({ name: "Object storage (S3-compatible)", purpose: "Storing uploaded images and video", data: "Uploaded files", region: process.env.S3_REGION || "as configured" });
  }
  if (process.env.UPSTASH_REDIS_REST_URL) {
    list.push({ name: "Upstash", purpose: "Rate limiting", data: "IP address (hashed key), request counts, kept minutes", region: "as configured" });
  }
  if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
    list.push({ name: "Cloudflare Turnstile", purpose: "Telling people from bots at registration", data: "IP address, browser characteristics", region: "Global (Cloudflare)" });
  }
  if (process.env.TWILIO_ACCOUNT_SID) {
    list.push({ name: "Twilio", purpose: "Sending the text message that verifies a phone number", data: "Phone number, the six-digit code", region: "United States" });
  }
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    list.push({ name: "Your browser's push service (Google, Apple or Mozilla)", purpose: "Delivering the breaking-news alerts you asked for to your device", data: "An encrypted message it cannot read, and the device address its own browser issued", region: "Set by the browser vendor" });
  }
  list.push({ name: "Have I Been Pwned", purpose: "Checking a chosen password against known breaches", data: "The first five characters of the password's SHA-1 hash — never the password", region: "Global" });
  return list;
}

/** Retention periods, in one place so the policy and the purge agree. */
export const RETENTION = {
  auditLogDays: Number(process.env.AUDIT_RETENTION_DAYS) || 365,
  notificationDays: 180,
  lastLoginIpDays: 90,
  emailOutboxDays: 30,
  /** A push subscription the push service keeps rejecting is dropped after this long. */
  pushFailedDays: 30,
};
