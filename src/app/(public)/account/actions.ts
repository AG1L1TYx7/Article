"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth, signOut } from "@/lib/auth/config";
import { verifyPassword } from "@/lib/auth/password";
import { TRUST_COOKIE } from "@/lib/auth/trustedDevice";
import { anonymiseAccount } from "@/lib/accountDeletion";
import { recordAudit, recordAuthEvent } from "@/lib/audit";
import { getClientIp } from "@/lib/request";

/**
 * Clears the "remember this device" cookie for two-factor authentication,
 * so the next login on this browser asks for a code again. Only this
 * browser: the token is a cookie, not a server record, so there is
 * nothing else to revoke. Re-enrolling MFA forgets every device at once.
 */
export async function forgetThisDevice(): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false };
  (await cookies()).delete(TRUST_COOKIE);
  await recordAuthEvent({ userId: session.user.id, action: "auth.mfa.device_forgotten", ip: await getClientIp() });
  return { ok: true };
}

/** Rectification (GDPR Art. 16): the one profile field a reader shows. */
export async function updateProfile(input: { name: string }): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You are not signed in." };
  const parsed = z.string().trim().min(1, "Enter a name.").max(120).safeParse(input.name);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid name" };
  await db.user.update({ where: { id: session.user.id }, data: { name: parsed.data } });
  await recordAudit({
    actorId: session.user.id,
    action: "user.profile.update",
    targetType: "User",
    targetId: session.user.id,
    ip: await getClientIp(),
  });
  return { ok: true };
}

/**
 * Erasure (GDPR Art. 17 / CCPA §1798.105), self-service. The password is
 * required so an unattended signed-in browser cannot be used to destroy
 * an account. On success the person is signed out; the session token
 * would stop validating anyway, since anonymisation bumps sessionVersion.
 */
export async function deleteMyAccount(input: { password: string }): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You are not signed in." };

  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { id: true, passwordHash: true } });
  if (!user?.passwordHash) return { ok: false, error: "This account cannot be deleted from here." };
  const valid = await verifyPassword(user.passwordHash, input.password).catch(() => false);
  if (!valid) return { ok: false, error: "That isn't your password." };

  const result = await anonymiseAccount(user.id, { actorId: user.id, reason: "self" });
  if (!result.ok) return result;

  (await cookies()).delete(TRUST_COOKIE);
  await signOut({ redirect: false });
  return { ok: true };
}
