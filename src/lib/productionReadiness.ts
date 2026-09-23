/**
 * Is this configuration fit to serve the public?
 *
 * Every optional service has a local fallback so the app runs on a laptop
 * with nothing signed up for. In production some of those fallbacks are
 * not degraded modes but silent failures: with no email provider, every
 * verification link and password reset is written to a log file nobody
 * reads, and account recovery does not exist. Rather than discover that
 * from a support ticket, the server refuses to start (src/instrumentation.ts)
 * and `npm run check:production` says the same thing before deploying.
 *
 * Pure: takes the environment as an argument, so it is unit tested and
 * the CLI and the startup hook cannot disagree.
 *
 * Two grades. A BLOCKER means the site cannot do its job or is unsafe:
 * the server will not start with one unless ALLOW_PRODUCTION_FALLBACKS
 * is set, which exists for a staging box, never for the real site. A
 * WARNING is a fallback that works but is not what a production site
 * should be running on; it is printed at startup and otherwise left alone.
 */

export interface ReadinessItem {
  /** A short name for the table: "Email", "Object storage". */
  area: string;
  /** What is wrong, in one sentence. */
  problem: string;
  /** What to set or do about it. */
  fix: string;
}

export interface Readiness {
  blockers: ReadinessItem[];
  warnings: ReadinessItem[];
  /** Everything that is configured properly, for the report. */
  ok: string[];
}

type Env = Record<string, string | undefined>;

const PLACEHOLDER_SECRETS = [/generate-with/i, /change-?me/i, /^secret$/i, /^password$/i, /example/i];

const present = (v: string | undefined): v is string => typeof v === "string" && v.trim().length > 0;

/** Every check, in the order the report shows them. */
export function assessReadiness(env: Env, extras: { ffmpegAvailable?: boolean } = {}): Readiness {
  const blockers: ReadinessItem[] = [];
  const warnings: ReadinessItem[] = [];
  const ok: string[] = [];

  // --- Things without which the site cannot do its job -------------------

  if (!present(env.DATABASE_URL)) {
    blockers.push({ area: "Database", problem: "DATABASE_URL is not set.", fix: "Set it to the production MySQL/MariaDB URL." });
  } else {
    ok.push("Database URL set");
  }

  const secret = env.AUTH_SECRET ?? "";
  if (!present(secret)) {
    blockers.push({ area: "Auth secret", problem: "AUTH_SECRET is not set.", fix: "Generate one: openssl rand -base64 32" });
  } else if (secret.trim().length < 32) {
    blockers.push({ area: "Auth secret", problem: "AUTH_SECRET is shorter than 32 characters.", fix: "Generate a longer one: openssl rand -base64 32" });
  } else if (PLACEHOLDER_SECRETS.some((re) => re.test(secret))) {
    blockers.push({ area: "Auth secret", problem: "AUTH_SECRET is still a placeholder.", fix: "Generate a real one: openssl rand -base64 32. It also encrypts MFA secrets, so set it once and keep it." });
  } else {
    ok.push("Auth secret set");
  }

  const origin = env.SITE_URL ?? env.NEXTAUTH_URL;
  if (!present(origin)) {
    blockers.push({ area: "Public address", problem: "NEXTAUTH_URL is not set.", fix: "Set it to the site's public https:// address, e.g. https://news.example.com" });
  } else {
    let parsed: URL | null = null;
    try {
      parsed = new URL(origin);
    } catch {
      parsed = null;
    }
    if (!parsed) {
      blockers.push({ area: "Public address", problem: `NEXTAUTH_URL is not a valid URL (${origin}).`, fix: "Set it to the site's public https:// address." });
    } else if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      blockers.push({ area: "Public address", problem: "NEXTAUTH_URL still points at localhost.", fix: "Set it to the site's public https:// address. Sign-in links, share cards, the feed and the sitemap are built from it." });
    } else if (parsed.protocol !== "https:") {
      blockers.push({ area: "Public address", problem: "NEXTAUTH_URL is not https.", fix: "Serve the site over HTTPS and set NEXTAUTH_URL to the https:// address; session cookies are marked Secure in production and will not be sent over http." });
    } else {
      ok.push(`Public address ${parsed.origin}`);
    }
  }

  if (!present(env.RESEND_API_KEY)) {
    blockers.push({
      area: "Email",
      problem: "No email provider: every verification link and password reset would be written to a log file and never delivered. Nobody could recover an account.",
      fix: "Set RESEND_API_KEY and EMAIL_FROM (docs/deployment.md §7).",
    });
  } else if (!present(env.EMAIL_FROM) || /example\.com/i.test(env.EMAIL_FROM ?? "")) {
    blockers.push({ area: "Email", problem: "EMAIL_FROM is missing or still the example address.", fix: 'Set it to a sender on your verified domain, e.g. "The Dispatch <no-reply@yourdomain.com>".' });
  } else {
    ok.push("Email via Resend");
  }

  // --- Fallbacks that work, but are not what production should run on ----

  if (!present(env.S3_BUCKET) || !present(env.S3_ENDPOINT)) {
    warnings.push({
      area: "Object storage",
      problem: "Uploads are stored on this server's disk. They are not backed up with the database and do not survive rebuilding the server.",
      fix: "Set S3_* and MEDIA_PUBLIC_BASE_URL (Cloudflare R2 or any S3-compatible bucket).",
    });
  } else if (!present(env.MEDIA_PUBLIC_BASE_URL)) {
    warnings.push({ area: "Object storage", problem: "S3 is configured but MEDIA_PUBLIC_BASE_URL is not, so media URLs point at the bucket endpoint directly.", fix: "Set MEDIA_PUBLIC_BASE_URL to the public (CDN) address of the bucket." });
  } else {
    ok.push("Object storage");
  }

  if (!present(env.UPSTASH_REDIS_REST_URL) || !present(env.UPSTASH_REDIS_REST_TOKEN)) {
    warnings.push({
      area: "Rate limiting",
      problem: "Rate limits are counted in this process only. Correct on one instance; on more than one, every limit is multiplied by the instance count.",
      fix: "Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN before running more than one instance.",
    });
  } else {
    ok.push("Rate limiting via Upstash");
  }

  if (!present(env.TURNSTILE_SECRET_KEY) || !present(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY)) {
    warnings.push({ area: "Registration CAPTCHA", problem: "Registration has no CAPTCHA, so bots can create accounts at the rate limit.", fix: "Set NEXT_PUBLIC_TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY (Cloudflare Turnstile, free)." });
  } else {
    ok.push("Registration CAPTCHA");
  }

  if (!present(env.CLAMAV_HOST)) {
    warnings.push({ area: "Malware scanning", problem: "Uploads are not malware-scanned. Every file is still re-encoded, which is the main control.", fix: "Run ClamAV (docker-compose ships it) and set CLAMAV_HOST." });
  } else {
    ok.push("Malware scanning");
  }

  if (extras.ffmpegAvailable === false) {
    warnings.push({ area: "Video and audio", problem: "No ffmpeg binary was found, so video and audio uploads will be refused (images still work).", fix: "Set FFMPEG_PATH, or reinstall dependencies so ffmpeg-static downloads its binary." });
  } else if (extras.ffmpegAvailable) {
    ok.push("ffmpeg for video and audio");
  }

  if (!present(env.VAPID_PUBLIC_KEY) || !present(env.VAPID_PRIVATE_KEY)) {
    warnings.push({ area: "Push notifications", problem: "Web push is off; readers cannot turn on breaking-news alerts.", fix: "Run npm run push:keys and set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT." });
  } else {
    ok.push("Web push");
  }

  if (!present(env.TWILIO_ACCOUNT_SID) || !present(env.TWILIO_AUTH_TOKEN) || !present(env.TWILIO_FROM)) {
    warnings.push({ area: "Phone verification", problem: "Verification texts are written to a log file; readers cannot verify a phone number.", fix: "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM, or leave phone verification unused." });
  } else {
    ok.push("Phone verification via Twilio");
  }

  const legalMissing = ["LEGAL_ENTITY", "LEGAL_ADDRESS", "LEGAL_CONTACT_EMAIL"].filter((k) => !present(env[k]));
  if (legalMissing.length) {
    warnings.push({ area: "Legal pages", problem: `The privacy policy and terms show placeholders: ${legalMissing.join(", ")} not set.`, fix: "Set the LEGAL_* variables to the publishing entity's real details." });
  } else {
    ok.push("Legal pages filled in");
  }

  return { blockers, warnings, ok };
}

/** The report as plain text, for a terminal or a server log. */
export function formatReadiness(r: Readiness): string {
  const lines: string[] = [];
  if (r.blockers.length) {
    lines.push(`NOT READY — ${r.blockers.length} blocker${r.blockers.length === 1 ? "" : "s"}:`);
    for (const b of r.blockers) lines.push(`  ✗ ${b.area}: ${b.problem}`, `      → ${b.fix}`);
  } else {
    lines.push("READY — no blockers.");
  }
  if (r.warnings.length) {
    lines.push(`${r.warnings.length} warning${r.warnings.length === 1 ? "" : "s"} (the site works, but should not stay this way):`);
    for (const w of r.warnings) lines.push(`  ! ${w.area}: ${w.problem}`, `      → ${w.fix}`);
  }
  if (r.ok.length) lines.push(`Configured: ${r.ok.join(", ")}.`);
  return lines.join("\n");
}
