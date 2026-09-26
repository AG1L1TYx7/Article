import { db } from "@/lib/db";
import { RETENTION } from "@/lib/legal";

/**
 * Data minimisation on a timer: things that were collected for a reason
 * are removed once the reason has passed. The periods are declared in
 * lib/legal.ts so the privacy policy and this purge cannot disagree.
 *
 * Runs opportunistically after public responses (like scheduled
 * publishing) at most once an hour per process, so a deployment with no
 * scheduler still keeps its word. Idempotent and cheap: each statement
 * is an indexed range delete or update.
 */
const MIN_INTERVAL_MS = 60 * 60 * 1000;
let lastRun = 0;

const daysAgo = (days: number, now: Date) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

export async function runRetention(
  now: Date = new Date()
): Promise<{ auditLogs: number; notifications: number; ips: number; tokens: number; pushSubscriptions: number; signInCodes: number; rejectedIssues: number } | null> {
  if (now.getTime() - lastRun < MIN_INTERVAL_MS) return null;
  lastRun = now.getTime();

  const [auditLogs, notifications, ips, tokens, pushSubscriptions, signInCodes, rejectedIssues] =
    await Promise.all([
    db.auditLog.deleteMany({ where: { createdAt: { lt: daysAgo(RETENTION.auditLogDays, now) } } }),
    db.notification.deleteMany({ where: { createdAt: { lt: daysAgo(RETENTION.notificationDays, now) } } }),
    // The IP of a sign-in months ago tells nobody anything useful.
    db.user.updateMany({
      where: { lastLoginIp: { not: null }, lastLoginAt: { lt: daysAgo(RETENTION.lastLoginIpDays, now) } },
      data: { lastLoginIp: null },
    }),
    // Verification and reset links are single use and expire in an hour;
    // the rows they leave behind have no reason to outlive the day.
    db.verificationToken.deleteMany({ where: { expires: { lt: daysAgo(1, now) } } }),
    // A device the push service has rejected for a month is not coming back.
    db.pushSubscription.deleteMany({ where: { failedAt: { lt: daysAgo(RETENTION.pushFailedDays, now) } } }),
    // Sign-in codes live ten minutes. An expired one is already refused
    // by lib/auth/emailOtp.ts; this is so the rows do not accumulate
    // forever for people who asked for a code and then wandered off.
    db.emailOtp.deleteMany({ where: { expiresAt: { lt: now } } }),
    // A report nobody could verify, deleted outright rather than
    // anonymised. Anonymising keeps the accusation and loses only the
    // reporter; here the accusation is the thing that was never
    // substantiated, so keeping it would leave an unchecked claim about a
    // named official sitting in the database indefinitely. The reporter
    // has already been told why. See RETENTION.rejectedIssueDays.
    db.issue.deleteMany({
      where: { status: "REJECTED", updatedAt: { lt: daysAgo(RETENTION.rejectedIssueDays, now) } },
    }),
  ]);

  return {
    auditLogs: auditLogs.count,
    notifications: notifications.count,
    ips: ips.count,
    tokens: tokens.count,
    pushSubscriptions: pushSubscriptions.count,
    signInCodes: signInCodes.count,
    rejectedIssues: rejectedIssues.count,
  };
}
