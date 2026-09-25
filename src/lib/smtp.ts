import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/auth/crypto";
import { DEFAULT_SMTP, smtpConfigSchema, type SmtpConfig, type SmtpConfigView } from "@/lib/smtpConfig";

/**
 * SMTP, configured from /dashboard/settings rather than from the
 * environment.
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
 * password into a value attribute has published it to every extension in
 * that browser and to the next person who opens devtools.
 *
 * **Rotating AUTH_SECRET invalidates the stored password**, because the
 * key is derived from it. The same is already true of every enrolled
 * authenticator; the fix here is to type the password in again, and the
 * settings page says so.
 *
 * The shape itself — ports, schema, types — lives in lib/smtpConfig.ts so
 * the settings form can import it without importing this.
 */

/** One row per field, so the password can be read and written on its own. */
const KEY_CONFIG = "smtp.config";
const KEY_PASSWORD = "smtp.password";

export type { SmtpConfig, SmtpConfigView };

/**
 * Cached briefly, like the other settings.
 *
 * Sixty seconds is the longest a change can take to reach every process —
 * acceptable for something altered a few times a year, and it keeps a
 * password-reset email from paying two queries.
 */
const CACHE_MS = 60_000;
let cache: { at: number; value: SmtpConfigView } | null = null;

export function resetSmtpCache() {
  cache = null;
}

export async function getSmtpConfig(): Promise<SmtpConfigView> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  const [configRow, passwordRow] = await Promise.all([
    db.siteSetting.findUnique({ where: { key: KEY_CONFIG } }),
    db.siteSetting.findUnique({ where: { key: KEY_PASSWORD } }),
  ]);

  const parsed = smtpConfigSchema.safeParse(configRow?.value ?? {});
  const value: SmtpConfigView = {
    ...(parsed.success ? parsed.data : DEFAULT_SMTP),
    hasPassword: typeof passwordRow?.value === "string" && passwordRow.value.length > 0,
  };
  cache = { at: Date.now(), value };
  return value;
}

/**
 * The password, decrypted, for the moment of sending.
 *
 * Deliberately a separate call from getSmtpConfig(): the config is handed
 * to a React page, and anything on that object could end up serialised
 * into the HTML. This never leaves the server.
 */
async function getSmtpPassword(): Promise<string | null> {
  const row = await db.siteSetting.findUnique({ where: { key: KEY_PASSWORD } });
  if (typeof row?.value !== "string" || !row.value) return null;
  try {
    return decryptSecret(row.value);
  } catch {
    // Almost certainly AUTH_SECRET was rotated. Treated as "no password"
    // so sending fails cleanly with a message the settings page explains,
    // rather than throwing somewhere in the middle of a password reset.
    return null;
  }
}

export async function saveSmtpConfig(
  input: SmtpConfig,
  /** Undefined leaves the stored password alone; "" clears it. */
  password: string | undefined,
  updatedBy: string
): Promise<void> {
  const writes = [
    db.siteSetting.upsert({
      where: { key: KEY_CONFIG },
      create: { key: KEY_CONFIG, value: input, updatedBy },
      update: { value: input, updatedBy },
    }),
  ];

  if (password !== undefined) {
    const stored = password === "" ? "" : encryptSecret(password);
    writes.push(
      db.siteSetting.upsert({
        where: { key: KEY_PASSWORD },
        create: { key: KEY_PASSWORD, value: stored, updatedBy },
        update: { value: stored, updatedBy },
      })
    );
  }

  await db.$transaction(writes);
  resetSmtpCache();
}

/**
 * Builds a transport, or null when SMTP is not configured.
 *
 * nodemailer is imported dynamically so that a deployment which never
 * turns SMTP on does not load it at all — and, more usefully, so that
 * importing this module from a client component would fail loudly rather
 * than dragging a mail library into a browser bundle.
 */
export async function getSmtpTransport() {
  const config = await getSmtpConfig();
  if (!config.enabled || !config.host || !config.fromEmail) return null;

  const password = await getSmtpPassword();
  const nodemailer = await import("nodemailer");

  return {
    config,
    transport: nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: password ?? "" } : undefined,
      // A mail server that is not answering must not hold a page open.
      // A password reset that takes fifteen seconds and then fails is a
      // worse experience than one that fails in five and says so.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    }),
  };
}

/** `"Name" <address>` when a name is set, otherwise the bare address. */
export function smtpFrom(config: SmtpConfig): string {
  return config.fromName ? `${config.fromName} <${config.fromEmail}>` : config.fromEmail;
}

export type SmtpCheck = { ok: true } | { ok: false; error: string };

/**
 * Opens a connection and authenticates, without sending anything.
 *
 * What an administrator actually needs to know is "will a password reset
 * reach somebody", and the failures are nearly always at this stage:
 * wrong port, wrong TLS mode, wrong password. nodemailer's own errors are
 * the truth but not always the explanation, so the common ones are
 * translated.
 */
export async function verifySmtp(): Promise<SmtpCheck> {
  const built = await getSmtpTransport();
  if (!built) return { ok: false, error: "SMTP is not switched on, or the server and from-address are blank." };

  try {
    await built.transport.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: explainSmtpError(err) };
  }
}

export function explainSmtpError(err: unknown): string {
  const code = (err as { code?: string })?.code;
  const message = err instanceof Error ? err.message : String(err);

  switch (code) {
    case "EAUTH":
      return "The mail server rejected the username or password. If you use Gmail or Google Workspace with two-factor authentication, this must be an App Password, not the account password.";
    case "ECONNECTION":
    case "ESOCKET":
      return `Could not connect. Check the host and port, and whether the TLS setting matches — port 465 needs "implicit TLS" on, 587 needs it off. (${message})`;
    case "ETIMEDOUT":
    case "ECONNREFUSED":
      return "The mail server did not answer. Many hosts block outbound port 25; try 587, or 2525 if your provider offers it.";
    case "EENVELOPE":
      return "The server refused the from-address. It usually has to be an address that server is allowed to send for.";
    default:
      return message;
  }
}
