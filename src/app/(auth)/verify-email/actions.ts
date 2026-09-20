"use server";

import { db } from "@/lib/db";
import { consumeToken, createToken } from "@/lib/auth/tokens";
import { sendEmail, verificationEmail } from "@/lib/email";
import { getBaseUrl } from "@/lib/url";
import { registerLimiter } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/request";

const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

export async function verifyEmail(email: string, token: string): Promise<boolean> {
  const valid = await consumeToken("email-verify", email, token);
  if (!valid) return false;

  await db.user.updateMany({
    where: { email },
    data: { emailVerifiedAt: new Date() },
  });
  return true;
}

export interface ResendResult {
  ok: boolean;
  error?: string;
}

export async function resendVerificationEmail(email: string): Promise<ResendResult> {
  // Reuses the registration limiter's bucket size — same abuse shape
  // (unauthenticated, email-triggering endpoint).
  const ip = await getClientIp();
  const { success } = await registerLimiter.limit(ip);
  if (!success) return { ok: false, error: "Too many attempts. Please try again later." };

  const user = await db.user.findUnique({ where: { email }, select: { emailVerifiedAt: true } });
  // Same response whether the account exists, is already verified, or
  // not — don't let this endpoint be used to enumerate accounts.
  if (user && !user.emailVerifiedAt) {
    const token = await createToken("email-verify", email, EMAIL_VERIFY_TTL_MS);
    const link = `${await getBaseUrl()}/verify-email?token=${token}&email=${encodeURIComponent(email)}`;
    await sendEmail({ to: email, ...verificationEmail(link) });
  }

  return { ok: true };
}
