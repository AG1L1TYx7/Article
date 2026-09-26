import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { sendEmail, signInCodeEmail } from "@/lib/email";

/**
 * A six-digit code emailed to the address on the account, as a second
 * factor for people who will not install an authenticator app.
 *
 * It is deliberately the *weaker* of the two methods this site offers, and
 * the code says so in the one place it matters: an administrator may not
 * use it (enforced in src/proxy.ts). Whoever controls the mailbox controls
 * the factor, and for an account that can publish on behalf of the
 * platform that is not a good enough answer. For a member, it is a real
 * improvement over a password alone and asks nothing they do not already
 * have.
 *
 * Six digits is a million possibilities, which is only safe with all three
 * of these together — remove any one and it is brute-forceable:
 *
 *   - a short life (ten minutes);
 *   - a hard cap on guesses (five, then the code is destroyed, not just
 *     rejected — otherwise the cap resets with every new code an attacker
 *     triggers);
 *   - one live code per account, so requesting more does not widen the
 *     target.
 *
 * Stored as an HMAC keyed by AUTH_SECRET rather than a plain hash. A plain
 * SHA-256 of a six-digit code is reversible by anybody with the database
 * and a second of CPU time — there are only a million preimages to try. The
 * key is what makes the stored value useless on its own.
 */

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
/** How long before a new code may be requested, to stop mailbox flooding. */
const RESEND_COOLDOWN_MS = 60 * 1000;

function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET must be set to store sign-in codes");
  return createHmac("sha256", "email-otp").update(secret).digest();
}

function hashCode(code: string): string {
  return createHmac("sha256", key()).update(code).digest("base64url");
}

/** Six digits, uniform, from the CSPRNG. Leading zeros are kept. */
function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export type IssueResult =
  | { ok: true }
  | { ok: false; reason: "cooldown"; secondsRemaining: number };

/**
 * Issues a code and emails it.
 *
 * Only ever called once the password (or Google) has already been
 * accepted — see the callers. That ordering is what stops this being an
 * email-bombing service: somebody who cannot pass the first factor cannot
 * make us send anything.
 */
export async function issueEmailOtp(user: {
  id: string;
  email: string;
  name: string;
}): Promise<IssueResult> {
  const existing = await db.emailOtp.findUnique({
    where: { userId: user.id },
    select: { createdAt: true },
  });
  if (existing) {
    const age = Date.now() - existing.createdAt.getTime();
    if (age < RESEND_COOLDOWN_MS) {
      return {
        ok: false,
        reason: "cooldown",
        secondsRemaining: Math.ceil((RESEND_COOLDOWN_MS - age) / 1000),
      };
    }
  }

  const code = generateCode();
  await db.emailOtp.upsert({
    where: { userId: user.id },
    // Replaces any previous code, and resets the guess counter with it —
    // the counter belongs to the code it is counting against.
    create: {
      userId: user.id,
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
    update: {
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
      attempts: 0,
      createdAt: new Date(),
    },
  });

  await sendEmail({
    to: user.email,
    ...signInCodeEmail(user.name, code, Math.round(CODE_TTL_MS / 60000)),
  });

  return { ok: true };
}

export type VerifyResult = "ok" | "wrong" | "expired" | "locked" | "none";

/**
 * Checks a code, counting the attempt.
 *
 * Every outcome destroys the row except a wrong guess below the cap, so a
 * code can never be used twice and a run of guesses ends the code rather
 * than merely failing.
 */
export async function verifyEmailOtp(userId: string, code: string): Promise<VerifyResult> {
  const record = await db.emailOtp.findUnique({ where: { userId } });
  if (!record) return "none";

  if (record.expiresAt.getTime() <= Date.now()) {
    await db.emailOtp.delete({ where: { userId } }).catch(() => {});
    return "expired";
  }

  const expected = Buffer.from(record.codeHash);
  const given = Buffer.from(hashCode(code));
  const matches = expected.length === given.length && timingSafeEqual(expected, given);

  if (matches) {
    await db.emailOtp.delete({ where: { userId } }).catch(() => {});
    return "ok";
  }

  const attempts = record.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    // Destroyed, not just rejected: leaving it alive would let an attacker
    // keep guessing against the same code for the rest of its ten minutes.
    await db.emailOtp.delete({ where: { userId } }).catch(() => {});
    return "locked";
  }
  await db.emailOtp.update({ where: { userId }, data: { attempts } }).catch(() => {});
  return "wrong";
}

/** Drops any outstanding code — used when the method is turned off. */
export async function clearEmailOtp(userId: string): Promise<void> {
  await db.emailOtp.deleteMany({ where: { userId } });
}

/**
 * Codes nobody ever used, swept with the other expired rows.
 *
 * Called from lib/retention.ts. An abandoned code is harmless once it has
 * expired, but rows that are never deleted are rows that grow forever.
 */
export async function purgeExpiredEmailOtps(): Promise<number> {
  const { count } = await db.emailOtp.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}
