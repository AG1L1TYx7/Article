"use server";

import { db } from "@/lib/db";
import { createToken } from "@/lib/auth/tokens";
import { sendEmail, passwordResetEmail } from "@/lib/email";
import { getBaseUrl } from "@/lib/url";
import { passwordResetLimiter } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/request";
import { z } from "zod";

const RESET_TTL_MS = 60 * 60 * 1000;
const emailSchema = z.email().max(254);

export interface ForgotPasswordResult {
  ok: boolean;
  error?: string;
}

export async function requestPasswordReset(formData: FormData): Promise<ForgotPasswordResult> {
  const ip = await getClientIp();
  const { success } = await passwordResetLimiter.limit(ip);
  if (!success) {
    return { ok: false, error: "Too many attempts. Please try again later." };
  }

  const parsed = emailSchema.safeParse(formData.get("email"));
  // Always the same success response regardless of whether the email is
  // valid, registered, or has a password at all (OAuth-only accounts) —
  // this endpoint must not be usable to enumerate accounts.
  if (!parsed.success) return { ok: true };

  const email = parsed.data;
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (user) {
    const token = await createToken("password-reset", email, RESET_TTL_MS);
    const link = `${await getBaseUrl()}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
    await sendEmail({ to: email, ...passwordResetEmail(link) });
  }

  return { ok: true };
}
