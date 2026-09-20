import { Resend } from "resend";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const from = process.env.EMAIL_FROM ?? "News Platform <no-reply@example.com>";

// Dev-only outbox so e2e tests (and manual testing) can read the verify/
// reset links without a real inbox. Gitignored; never written in
// production (guarded by the same `!resend` check as the console log).
const DEV_OUTBOX_PATH = join(process.cwd(), ".email-dev-outbox.log");

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

/**
 * Sends via Resend when RESEND_API_KEY is configured. Otherwise logs the
 * email to the console — this is what makes the verify-email and
 * password-reset flows fully testable in local dev before a Resend
 * account exists (see .env.example).
 */
export async function sendEmail({ to, subject, html }: SendEmailInput): Promise<void> {
  if (!resend) {
    console.log(`\n[email:dev] would send to ${to}\n[email:dev] subject: ${subject}\n${html}\n`);
    appendFileSync(
      DEV_OUTBOX_PATH,
      JSON.stringify({ to, subject, html, sentAt: new Date().toISOString() }) + "\n"
    );
    return;
  }

  await resend.emails.send({ from, to, subject, html });
}

export function verificationEmail(link: string) {
  return {
    subject: "Verify your email",
    html: `<p>Confirm your email to finish setting up your account.</p><p><a href="${link}">Verify email</a></p><p>This link expires in 24 hours. If you didn't create an account, you can ignore this email.</p>`,
  };
}

export function passwordResetEmail(link: string) {
  return {
    subject: "Reset your password",
    html: `<p>Someone requested a password reset for this account.</p><p><a href="${link}">Choose a new password</a></p><p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email — your password will not change.</p>`,
  };
}
