import { SITE_NAME } from "@/lib/siteUrl";

/**
 * Who is legally responsible for this site — the "controller" in GDPR
 * terms, the "business" in CCPA terms. Read from the environment so the
 * same code serves any publisher; the privacy policy and terms pages
 * print these, and mark them loudly when they are missing, because a
 * privacy policy without a named controller is not a privacy policy.
 *
 *   LEGAL_ENTITY          e.g. "The Dispatch Media Ltd"
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

/**
 * Which third parties currently receive personal data.
 *
 * Mostly derived from the environment, but the mail route is now a
 * runtime setting (see lib/smtp.ts), and the privacy policy has to name
 * whoever actually carries the mail — an administrator who points this at
 * Gmail has changed who processes every verification and reset message,
 * and a policy still naming Resend would be wrong in the one direction
 * that matters.
 *
 * `smtpHost` is passed in rather than read here so this stays a pure
 * function: it is rendered by a server component that can await the
 * setting, and a database call hidden inside a "build the policy" helper
 * is a surprise nobody needs.
 */
export function activeProcessors(
  options: { smtpHost?: string | null } = {}
): { name: string; purpose: string; data: string; region: string }[] {
  const list = [];
  if (options.smtpHost) {
    list.push({
      name: `Your mail server (${options.smtpHost})`,
      purpose: "Sending transactional email (verification, password reset, sign-in codes)",
      data: "Email address, message content",
      region: "Wherever that server is operated — ask the publisher if it matters to you",
    });
  } else if (process.env.RESEND_API_KEY) {
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
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    list.push({
      name: "Google (Sign in with Google)",
      purpose:
        "Letting you sign in with a Google account instead of a password, if you choose to. Nothing is sent to Google unless you press that button.",
      data:
        "Google tells us your name, email address, whether Google has verified that address, and your profile picture. We ask for nothing else. The picture is copied here once and then served from this site, so viewing a page never contacts Google.",
      region: "United States (Google acts as its own controller for what it does with your Google account)",
    });
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
  /**
   * How long a report that could not be verified is kept.
   *
   * The most dangerous stale data this platform holds. A rejected report
   * is an *unverified* accusation, still linked to the person who made it,
   * and it will never be published — so every day it is kept is risk
   * carried for no benefit. The reporter has already been told why it was
   * rejected, which is what they were owed.
   *
   * Ninety days rather than immediately, so somebody can appeal or supply
   * what was missing, and so a pattern of rejections from one account is
   * still visible to moderation for a season.
   */
  rejectedIssueDays: Number(process.env.REJECTED_ISSUE_RETENTION_DAYS) || 90,
};
