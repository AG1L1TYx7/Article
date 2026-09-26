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
import { issueEmailOtp } from "@/lib/auth/emailOtp";
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
   * Which second factor to ask for. "email" means a code has just been
   * sent to the address on the account; "app" means an authenticator.
   */
  method?: "app" | "email";
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
      email: true,
      name: true,
      mfaEnabled: true,
      mfaMethod: true,
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
  if (verifyTrustToken(trustCookie, user)) return { mfa: false };

  // The one place an emailed code is sent for a password sign-in, and it
  // sits *after* the password has been verified above. That ordering is
  // what stops this being a way to send mail to any address on demand.
  if (user.mfaMethod === "EMAIL") {
    await issueEmailOtp({ id: user.id, email: user.email, name: user.name }).catch(() => {
      // Nothing useful to say here: the code page offers a resend, and
      // saying "we could not email you" to whoever typed the password is
      // more information than they have earned if it was not their account.
    });
    return { mfa: true, method: "email" };
  }

  return { mfa: true, method: "app" };
}

/**
 * Sends another code, for somebody sitting on the code page.
 *
 * Takes the password again rather than trusting a flag from the browser:
 * there is no session yet, so the password is the only proof available
 * that this resend was asked for by the account holder. The cooldown in
 * lib/auth/emailOtp.ts is what stops it being used to flood an inbox.
 */
export async function resendSignInCode(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const ip = await getClientIp();
  const { success } = await mfaCheckLimiter.limit(ip);
  if (!success) return { ok: false, error: "Too many requests. Wait a minute and try again." };

  const parsed = inputSchema.safeParse({ email, password });
  if (!parsed.success) return { ok: false, error: "Could not send a new code." };

  const user = await db.user.findUnique({
    where: { email: parsed.data.email },
    select: {
      id: true,
      email: true,
      name: true,
      passwordHash: true,
      status: true,
      mfaEnabled: true,
      mfaMethod: true,
    },
  });
  if (!user?.passwordHash) {
    await verifyPassword(DUMMY_HASH, parsed.data.password).catch(() => false);
    return { ok: false, error: "Could not send a new code." };
  }
  const valid = await verifyPassword(user.passwordHash, parsed.data.password).catch(() => false);
  if (!valid || user.status !== "ACTIVE" || !user.mfaEnabled || user.mfaMethod !== "EMAIL") {
    return { ok: false, error: "Could not send a new code." };
  }

  const result = await issueEmailOtp({ id: user.id, email: user.email, name: user.name });
  if (!result.ok) {
    return { ok: false, error: `Wait ${result.secondsRemaining}s before asking for another code.` };
  }
  return { ok: true };
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
  // No mfaSecret check: an account whose second factor is an emailed code
  // has none, and it may be remembered just the same — the token binds to
  // sessionVersion, which turning the method off increments.
  if (!user?.mfaEnabled) return { ok: false };

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
