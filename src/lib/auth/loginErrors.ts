/**
 * What a refused sign-in is called, and what the person is told.
 *
 * Deliberately its own module with no imports. The login page is a client
 * component and renders these, while the code that *decides* them lives in
 * lib/auth/accountLinking.ts alongside the database and the mailer — both
 * server-only. Keeping the vocabulary here lets both sides share it
 * without dragging Prisma into the browser bundle.
 */

/** Why a Google sign-in was refused, as a code rather than a sentence. */
export type RefusalReason =
  | "google_email_unverified"
  | "local_email_unverified"
  | "account_suspended"
  | "no_email";

/**
 * The sentence shown on /login, or null when the code is unrecognised.
 *
 * Unrecognised is the important case: `?error=` is whatever is in the URL
 * bar, so this doubles as the filter that stops someone crafting a link
 * that puts their own text on our login page. Anything not listed here
 * renders nothing at all.
 */
export function loginErrorMessage(reason: string | null | undefined): string | null {
  switch (reason) {
    case "google_email_unverified":
      return "Google has not verified the email address on that account, so we cannot match it to an account here. Sign in with your password instead.";
    case "local_email_unverified":
      return "An account here already uses that email address, but it was never verified. Sign in with your password, or use the verification link we emailed you, and then connect Google from your account page.";
    case "account_suspended":
      return "That account cannot be used to sign in. If you think this is a mistake, contact us.";
    case "no_email":
      return "Google did not share an email address, which an account here needs. Check the permissions you granted and try again.";
    case "consent_required":
      return "To create an account you need to agree to the terms and privacy policy first.";
    case "rate_limited":
      return "Too many attempts from this connection. Please wait a few minutes and try again.";
    case "link_failed":
      return "Something interrupted connecting your Google account. Please try again.";
    case "mfa_expired":
      return "That took too long, so the sign-in expired for safety. Please start again.";
    default:
      return null;
  }
}
