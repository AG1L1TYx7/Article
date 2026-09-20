"use server";

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth/config";
import { verifyPassword } from "@/lib/auth/password";
import { isLocked } from "@/lib/auth/lockout";
import { issueTrustToken, TRUST_COOKIE, verifyTrustToken } from "@/lib/auth/trustedDevice";
import { mfaCheckLimiter } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/request";
import { recordAuthEvent } from "@/lib/audit";
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
    select: {
      id: true,
      passwordHash: true,
      lockedUntil: true,
      status: true,
      mfaEnabled: true,
      mfaSecret: true,
      sessionVersion: true,
    },
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

  if (!user.mfaEnabled) return { mfa: false };

  // Same check the real sign-in makes; if the device is trusted, the code
  // step is skipped there too, so don't show it here.
  const trustCookie = (await cookies()).get(TRUST_COOKIE)?.value;
  return { mfa: !verifyTrustToken(trustCookie, user) };
}

/**
 * Called by the login page right after a sign-in that included a correct
 * code, when "remember this device" was ticked. Requires the session that
 * sign-in just created — nobody can mint a trust cookie for an account
 * they are not signed into.
 */
export async function rememberThisDevice(): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false };

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, sessionVersion: true, mfaSecret: true, mfaEnabled: true },
  });
  if (!user?.mfaEnabled || !user.mfaSecret) return { ok: false };

  const { token, expires } = issueTrustToken({ id: user.id, sessionVersion: user.sessionVersion, mfaSecret: user.mfaSecret });
  (await cookies()).set(TRUST_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
  await recordAuthEvent({ userId: user.id, action: "auth.mfa.device_trusted", ip: await getClientIp() });
  return { ok: true };
}
