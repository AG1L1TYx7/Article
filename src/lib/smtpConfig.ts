import { z } from "zod";

/**
 * The shape of the SMTP settings: the ports allowed, the schema they are
 * validated against, and the type the form renders.
 *
 * Split from lib/smtp.ts — which holds the database reads, the decryption
 * and the transport — for one hard reason: the settings form is a client
 * component, and importing the server module from it drags Prisma and
 * nodemailer into the browser bundle. That fails the production build
 * with "the chunking context does not support external modules", which is
 * a long way from saying what is wrong. Same pairing as
 * searchQuery/search and analyticsClassify/analyticsCapture.
 *
 * Mail is not a nice-to-have here. A password reset, an email
 * verification and a sign-in code all travel by it, so "email is not
 * working" means "people cannot get into their accounts". Putting the
 * configuration behind a redeploy means the person who can fix it is
 * whoever has shell access, at whatever hour — which for a platform run
 * by volunteers in several countries is the wrong answer.
 *
 * The password is encrypted at rest with the same AES-256-GCM helper the
 * MFA secrets use, and is never sent to the browser — not even masked
 * back to the administrator who typed it. A settings page that renders a
 * password in a value attribute has published it to every extension in
 * that browser and to the next person who opens devtools.
 *
 * **Rotating AUTH_SECRET invalidates the stored password**, because the
 * key is derived from it. The same is already true of every enrolled
 * authenticator; the fix here is to type the password in again, and the
 * settings page says so.
 */

/**
 * Ports an administrator may point this at.
 *
 * Not a security boundary — an administrator can already do far more than
 * this — but it stops the settings form doubling as a port scanner run
 * from the server, and it catches the common typo before it becomes a
 * connection timeout nobody can explain.
 *
 * 25 plain, 465 implicit TLS, 587 submission with STARTTLS, 2525 the
 * common alternative when a host blocks 587, 1025 for a local Mailpit or
 * MailHog while developing.
 */
export const ALLOWED_SMTP_PORTS = [25, 465, 587, 2525, 1025] as const;

export const smtpConfigSchema = z.object({
  /** Off means fall back to Resend, then to the development log. */
  enabled: z.boolean(),
  host: z.string().trim().min(1, "Enter the mail server's hostname.").max(253),
  port: z
    .number()
    .int()
    .refine((p) => (ALLOWED_SMTP_PORTS as readonly number[]).includes(p), {
      message: `Port must be one of ${ALLOWED_SMTP_PORTS.join(", ")}.`,
    }),
  /**
   * True for implicit TLS (port 465). False means the connection starts
   * in the clear and upgrades with STARTTLS, which is what 587 expects.
   */
  secure: z.boolean(),
  /** Blank for a relay that authenticates by IP, which some hosts do. */
  user: z.string().trim().max(320),
  /** What recipients see. Must be an address the server will accept. */
  fromEmail: z.email("Enter the address mail should come from.").max(320),
  fromName: z.string().trim().max(120),
});

export type SmtpConfig = z.infer<typeof smtpConfigSchema>;

/** What the settings page renders: everything except the password. */
export interface SmtpConfigView extends SmtpConfig {
  /** Whether a password is stored, so the form can say "leave blank to keep". */
  hasPassword: boolean;
}

export const DEFAULT_SMTP: SmtpConfig = {
  enabled: false,
  host: "",
  port: 587,
  secure: false,
  user: "",
  fromEmail: "",
  fromName: "",
};
