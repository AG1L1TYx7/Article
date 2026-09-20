"use server";

import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { isLocked } from "@/lib/auth/lockout";
import { mfaCheckLimiter } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/request";
import { z } from "zod";

const inputSchema = z.object({ email: z.email(), password: z.string().min(1) });

// Deliberately read-only — no failedLoginCount/lockout writes here. The
// real sign-in call right after this (which the login form always makes,
// regardless of what this returns) is the single source of truth for
// lockout bookkeeping; this only decides whether to show a TOTP field.
// A wrong password here costs one extra argon2 verify per login attempt,
// which is a deliberate trade for keeping "increment the failure counter"
// in exactly one place.
const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export interface PreLoginCheck {
  /** Show the second-factor prompt before signing in. */
  mfa: boolean;
  /**
   * Set only when the password was CORRECT and the account is locked
   * after earlier failures. Someone who has the password already knows the
   * account exists, so telling them the truth leaks nothing; a wrong
   * password on a locked account gets the same silence as any wrong
   * password, so this cannot be used to probe for accounts or locks.
   */
  lockedUntil?: string;
}

export async function checkMfaRequired(email: string, password: string): Promise<PreLoginCheck> {
  const ip = await getClientIp();
  const { success } = await mfaCheckLimiter.limit(ip);
  if (!success) return { mfa: false };

  const parsed = inputSchema.safeParse({ email, password });
  if (!parsed.success) return { mfa: false };

  const user = await db.user.findUnique({
    where: { email: parsed.data.email },
    select: { passwordHash: true, lockedUntil: true, status: true, mfaEnabled: true },
  });

  if (!user || !user.passwordHash) {
    await verifyPassword(DUMMY_HASH, parsed.data.password).catch(() => false);
    return { mfa: false };
  }

  const valid = await verifyPassword(user.passwordHash, parsed.data.password).catch(() => false);
  // Wrong password → same response as "no MFA needed": the client just
  // proceeds to the real sign-in, which rejects it with the usual generic
  // error. This endpoint never reveals whether the account exists or has
  // MFA enabled to someone who doesn't already know the password.
  if (!valid) return { mfa: false };

  if (isLocked(user.lockedUntil)) return { mfa: false, lockedUntil: user.lockedUntil!.toISOString() };
  if (user.status !== "ACTIVE") return { mfa: false };

  return { mfa: user.mfaEnabled };
}
