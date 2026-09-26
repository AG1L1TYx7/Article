import { Resend } from "resend";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { getSmtpTransport, smtpFrom } from "@/lib/smtp";

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
 * Sends one email, by whichever route is configured.
 *
 * The order is deliberate, and it is "most specific wins":
 *
 *   1. **SMTP from the settings page**, when an administrator has turned
 *      it on. It comes first because it is the one somebody chose
 *      deliberately, at runtime, and expects to take effect — being
 *      silently overruled by an environment variable set months ago on a
 *      server they cannot reach is exactly the confusion this exists to
 *      remove.
 *   2. **Resend**, when RESEND_API_KEY is set.
 *   3. **The development outbox**, a log file, when neither is. That is
 *      what makes verification, password reset and the emailed sign-in
 *      code testable before any mail account exists — the e2e suite reads
 *      it.
 *
 * Never throws for a delivery failure alone. Callers are in the middle of
 * registering somebody or issuing a sign-in code, and a mail server having
 * a bad afternoon should not turn that into a 500. The failure is logged,
 * and the settings page has a "send a test" button that reports the real
 * error. The one exception is that test send, which passes `rethrow`
 * because reporting the error is its whole job.
 */
export async function sendEmail(
  { to, subject, html }: SendEmailInput,
  options: { rethrow?: boolean } = {}
): Promise<void> {
  try {
    const smtp = await getSmtpTransport();
    if (smtp) {
      await smtp.transport.sendMail({ from: smtpFrom(smtp.config), to, subject, html });
      return;
    }
  } catch (err) {
    if (options.rethrow) throw err;
    // Deliberately not silent: "no email arrived" is otherwise one of the
    // hardest things to diagnose on somebody else's server.
    console.error(`[email] SMTP send to ${to} failed:`, err instanceof Error ? err.message : err);
    return;
  }

  if (!resend) {
    console.log(`\n[email:dev] would send to ${to}\n[email:dev] subject: ${subject}\n${html}\n`);
    appendFileSync(
      DEV_OUTBOX_PATH,
      JSON.stringify({ to, subject, html, sentAt: new Date().toISOString() }) + "\n"
    );
    return;
  }

  try {
    await resend.emails.send({ from, to, subject, html });
  } catch (err) {
    if (options.rethrow) throw err;
    console.error(`[email] Resend send to ${to} failed:`, err instanceof Error ? err.message : err);
  }
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

/**
 * Sent when a Google account is connected to an existing account here.
 *
 * Two identities becoming one is the kind of change somebody needs to
 * hear about while they can still object to it — and if they did not do
 * it, this email is the only thing that tells them in time.
 *
 * The name is escaped: it is chosen by the account holder and goes into
 * HTML, so it is treated as data here exactly as it is everywhere else.
 */
export function googleLinkedEmail(name: string) {
  const safeName = name.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
  return {
    subject: "Google was connected to your account",
    html:
      `<p>Hello ${safeName},</p>` +
      `<p>A Google account with your email address was just connected to your account, ` +
      `so you can now sign in with either your password or Google.</p>` +
      `<p><strong>If this was not you</strong>, change your password immediately and contact us — ` +
      `someone else may have access to your Google account.</p>`,
  };
}

/**
 * The six-digit sign-in code, for accounts whose second factor is email.
 *
 * Deliberately plain: no link, nothing to click. A sign-in code that
 * arrives with a button is training people to click buttons in emails
 * that claim to be about their account, which is the entire mechanism of
 * the phishing this factor is supposed to resist.
 */
export function signInCodeEmail(name: string, code: string, minutes: number) {
  const safeName = name.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
  return {
    subject: `${code} is your sign-in code`,
    html:
      `<p>Hello ${safeName},</p>` +
      `<p>Your sign-in code is:</p>` +
      `<p style="font-size:28px;letter-spacing:6px;font-weight:700;margin:16px 0">${code}</p>` +
      `<p>It expires in ${minutes} minutes and can be used once.</p>` +
      `<p><strong>If you were not signing in</strong>, somebody has your password. ` +
      `Change it now — they cannot get in without this code, but they will keep trying.</p>`,
  };
}
