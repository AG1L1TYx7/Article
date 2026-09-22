"use server";

import { db } from "@/lib/db";
import { requireUser, guardAction } from "@/lib/auth/rbac";
import { startMfaEnrollment, verifyTotp, type NewMfaEnrollment } from "@/lib/auth/mfa";
import { verifyPassword } from "@/lib/auth/password";
import { generateRecoveryCodes, hashRecoveryCodes, parseStoredCodes } from "@/lib/auth/recoveryCodes";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request";
import { mfaCodeSchema } from "@/lib/validation/auth";

export async function beginMfaSetup(): Promise<NewMfaEnrollment> {
  const session = await requireUser();

  const enrollment = await startMfaEnrollment(session.user.email!);
  // Stored immediately but mfaEnabled stays false — the secret has no
  // effect on login until confirmMfaSetup() verifies the user actually
  // scanned it and can produce a valid code.
  await db.user.update({
    where: { id: session.user.id },
    data: { mfaSecret: enrollment.encryptedSecret },
  });

  return enrollment;
}

export interface ConfirmMfaResult {
  ok: boolean;
  error?: string;
  /**
   * The one-time recovery codes, in the clear, exactly once. Only the
   * hashes are stored; nothing can show these again.
   */
  recoveryCodes?: string[];
}

export async function confirmMfaSetup(code: string): Promise<ConfirmMfaResult> {
  return guardAction(async () => {
    const session = await requireUser();

    const parsed = mfaCodeSchema.safeParse(code);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid code" };

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { email: true, mfaSecret: true },
    });
    if (!user?.mfaSecret) {
      return { ok: false, error: "Start enrollment again before entering a code." };
    }

    if (!verifyTotp(user.email, user.mfaSecret, parsed.data)) {
      return { ok: false, error: "That code didn't match. Check the time on your device and try again." };
    }

    const recoveryCodes = generateRecoveryCodes();
    await db.user.update({
      where: { id: session.user.id },
      data: { mfaEnabled: true, mfaRecoveryCodes: JSON.stringify(hashRecoveryCodes(recoveryCodes)) },
    });
    await recordAudit({
      actorId: session.user.id,
      action: "mfa.enabled",
      targetType: "User",
      targetId: session.user.id,
      ip: await getClientIp(),
    });

    return { ok: true, recoveryCodes };
  });
}

export interface RecoveryCodesResult {
  ok: boolean;
  error?: string;
  recoveryCodes?: string[];
}

/**
 * Replaces every recovery code with a fresh set. Password-confirmed: a
 * browser left signed in must not be enough to mint a way past the
 * second factor. The old codes stop working at once.
 */
export async function regenerateRecoveryCodes(password: string): Promise<RecoveryCodesResult> {
  return guardAction(async () => {
    const session = await requireUser();

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { passwordHash: true, mfaEnabled: true },
    });
    if (!user?.mfaEnabled) return { ok: false, error: "Two-factor authentication is not enabled." };
    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, password).catch(() => false))) {
      return { ok: false, error: "Incorrect password." };
    }

    const recoveryCodes = generateRecoveryCodes();
    await db.user.update({
      where: { id: session.user.id },
      data: { mfaRecoveryCodes: JSON.stringify(hashRecoveryCodes(recoveryCodes)) },
    });
    await recordAudit({
      actorId: session.user.id,
      action: "mfa.recovery_codes.regenerated",
      targetType: "User",
      targetId: session.user.id,
      ip: await getClientIp(),
    });

    return { ok: true, recoveryCodes };
  });
}

/** How many unused recovery codes the signed-in person has left. */
export async function remainingRecoveryCodes(): Promise<number> {
  const session = await requireUser();
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { mfaRecoveryCodes: true },
  });
  return parseStoredCodes(user?.mfaRecoveryCodes).length;
}

export interface DisableMfaResult {
  ok: boolean;
  error?: string;
}

export async function disableMfa(password: string): Promise<DisableMfaResult> {
  return guardAction(async () => {
    const session = await requireUser();

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { passwordHash: true },
    });
    if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, password).catch(() => false))) {
      return { ok: false, error: "Incorrect password." };
    }

    await db.user.update({
      where: { id: session.user.id },
      data: { mfaEnabled: false, mfaSecret: null, mfaRecoveryCodes: null },
    });
    await recordAudit({
      actorId: session.user.id,
      action: "mfa.disabled",
      targetType: "User",
      targetId: session.user.id,
      ip: await getClientIp(),
    });

    return { ok: true };
  });
}
