"use server";

import { db } from "@/lib/db";
import { consumeToken } from "@/lib/auth/tokens";
import { hashPassword, isPasswordBreached } from "@/lib/auth/password";
import { passwordResetLimiter } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/request";
import { z } from "zod";

const inputSchema = z.object({
  email: z.email(),
  token: z.string().min(1),
  password: z.string().min(12).max(256),
});

export interface ResetPasswordResult {
  ok: boolean;
  error?: string;
}

export async function resetPassword(formData: FormData): Promise<ResetPasswordResult> {
  const ip = await getClientIp();
  const { success } = await passwordResetLimiter.limit(ip);
  if (!success) return { ok: false, error: "Too many attempts. Please try again later." };

  const parsed = inputSchema.safeParse({
    email: formData.get("email"),
    token: formData.get("token"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { email, token, password } = parsed.data;

  // Single-use: this call deletes the token whether or not it validates,
  // so a captured link can't be replayed even if this request fails later.
  const valid = await consumeToken("password-reset", email, token);
  if (!valid) {
    return { ok: false, error: "This reset link has expired or was already used." };
  }

  if (await isPasswordBreached(password)) {
    return {
      ok: false,
      error: "That password has appeared in a known data breach. Please choose another.",
    };
  }

  const passwordHash = await hashPassword(password);

  await db.user.updateMany({
    where: { email },
    data: {
      passwordHash,
      failedLoginCount: 0,
      lockedUntil: null,
      // A password reset is exactly the moment to assume every existing
      // session might be attacker-held and force a fresh login everywhere.
      sessionVersion: { increment: 1 },
    },
  });

  return { ok: true };
}
