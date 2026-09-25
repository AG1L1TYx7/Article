"use server";

import { db } from "@/lib/db";
import { requireUser, guardAction } from "@/lib/auth/rbac";
import { startMfaEnrollment, verifyTotp, type NewMfaEnrollment } from "@/lib/auth/mfa";
import { verifyPassword } from "@/lib/auth/password";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request";
import { mfaCodeSchema } from "@/lib/validation/auth";

export async function beginMfaSetup(): Promise<NewMfaEnrollment> {
  const session = await requireUser();

  // Refuse when a second factor is already enrolled.
  //
  // Without this, a session alone is enough to re-point somebody's
  // two-factor at a different device: begin, then confirm with a code from
  // your own authenticator. The victim's app stops working and the
  // attacker's starts, silently. Every neighbouring control asks for the
  // password first — disableMfa does, changePassword does, deleting the
  // account does — and re-enrolling reaches the same end state as
  // disable-then-enable while asking for nothing.
  //
  // It also overwrote mfaSecret unconditionally, so abandoning the wizard
  // half-way broke a working authenticator: verifyTotp would read the new
  // secret for a code the user's app could not produce.
  //
  // Turn it off first (which does ask for the password) and enrol again.
  const current = await db.user.findUnique({
    where: { id: session.user.id },
    select: { mfaEnabled: true },
  });
  if (current?.mfaEnabled) {
    throw new Error(
      "Two-factor authentication is already set up. Turn it off before setting up a new device."
    );
  }

  const enrollment = await startMfaEnrollment(session.user.email!);
  // Stored immediately but mfaEnabled stays false — the secret has no
  // effect on login until confirmMfaSetup() verifies the user actually
  // scanned it and can produce a valid code.
  await db.user.update({
    where: { id: session.user.id },
    data: { mfaSecret: enrollment.encryptedSecret },
  });

  // Only what the browser needs. `encryptedSecret` is what is stored on the
  // row; returning it puts the AES-GCM ciphertext of a second factor into
  // the RSC payload for no reason, since EnrollMfaFlow reads neither field.
  return {
    encryptedSecret: "",
    qrCodeDataUrl: enrollment.qrCodeDataUrl,
    manualEntryKey: enrollment.manualEntryKey,
  };
}

export interface ConfirmMfaResult {
  ok: boolean;
  error?: string;
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

    // mfaMethod is not optional here. src/proxy.ts admits an administrator
    // only when their second factor is an authenticator app, and it reads
    // that from this column — so enrolling without setting it leaves them
    // bounced back to this page forever, having done everything right.
    await db.user.update({
      where: { id: session.user.id },
      // Deliberately does NOT bump sessionVersion.
      //
      // sessionVersion is global: incrementing it invalidates the token
      // doing the incrementing, so the person is signed out in the middle
      // of enrolling and never sees that it worked. Ending other sessions
      // is a separate, deliberate act — see "Sign out everywhere" on the
      // account page, which is what revokeAllSessions() is for.
      data: { mfaEnabled: true, mfaMethod: "TOTP" },
    });
    await recordAudit({
      actorId: session.user.id,
      action: "mfa.enabled",
      targetType: "User",
      targetId: session.user.id,
      ip: await getClientIp(),
    });

    return { ok: true };
  });
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
      select: { passwordHash: true, role: true },
    });
    if (!user) return { ok: false, error: "You are not signed in." };

    // An account created through Google has no password to confirm with.
    // Requiring one would mean it could enrol a second factor and then
    // never remove it — locked into a device it may no longer have.
    // Being signed in is the whole of the proof available, and the same
    // standard the account page applies to setting a first password.
    if (user.passwordHash) {
      if (!(await verifyPassword(user.passwordHash, password).catch(() => false))) {
        return { ok: false, error: "Incorrect password." };
      }
    }

    // Administrators may not be without one: proxy.ts would send them
    // straight back to enrol again, which is a worse experience than
    // saying so here.
    if (user.role === "ADMIN") {
      return {
        ok: false,
        error:
          "Administrators must keep an authenticator app. Ask another administrator to change your role first if you need to remove it.",
      };
    }

    await db.user.update({
      where: { id: session.user.id },
      data: { mfaEnabled: false, mfaMethod: null, mfaSecret: null },
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
