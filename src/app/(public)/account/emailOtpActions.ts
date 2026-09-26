"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth/config";
import { clearEmailOtp } from "@/lib/auth/emailOtp";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request";

/**
 * Turning the emailed sign-in code on and off.
 *
 * Deliberately separate from the authenticator-app enrolment, which needs
 * a QR code, a secret encrypted at rest and a code typed back to prove the
 * app really works. This method needs none of that: the address is already
 * on the account and already verified, so switching it on is a single
 * write — and the proof that it works is the first sign-in after.
 *
 * Refused for administrators. Whoever holds a mailbox holds this factor,
 * and for an account that can publish on behalf of the platform, or change
 * what everybody else may do, that is not a good enough answer. The same
 * rule is enforced in src/proxy.ts, which will not let an administrator
 * into the dashboard without an authenticator app.
 */

export interface MfaMethodResult {
  ok: boolean;
  error?: string;
}

export async function enableEmailOtp(): Promise<MfaMethodResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You are not signed in." };

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true, emailVerifiedAt: true, mfaEnabled: true, mfaMethod: true },
  });
  if (!user) return { ok: false, error: "You are not signed in." };

  if (user.role === "ADMIN") {
    return {
      ok: false,
      error:
        "Administrators must use an authenticator app. An emailed code is not enough for an account that can publish on behalf of the platform.",
    };
  }
  if (!user.emailVerifiedAt) {
    // Sending sign-in codes to an address nobody has proved they can read
    // is how an account becomes permanently unreachable.
    return { ok: false, error: "Verify your email address first — that is where the codes go." };
  }
  if (user.mfaEnabled && user.mfaMethod === "TOTP") {
    return {
      ok: false,
      error: "Turn off the authenticator app first if you would rather use an emailed code.",
    };
  }

  await db.user.update({
    where: { id: user.id },
    data: {
      mfaEnabled: true,
      mfaMethod: "EMAIL",
      // Ends every other session and every remembered device: the trust
      // token is bound to sessionVersion, and a device remembered under
      // "password only" has not seen this factor even once.
      sessionVersion: { increment: 1 },
    },
  });

  await recordAudit({
    actorId: user.id,
    action: "auth.mfa.enabled",
    targetType: "User",
    targetId: user.id,
    metadata: { method: "EMAIL" },
    ip: await getClientIp(),
  });

  revalidatePath("/account");
  revalidatePath("/account/settings");
  return { ok: true };
}

export async function disableEmailOtp(): Promise<MfaMethodResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You are not signed in." };

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, mfaEnabled: true, mfaMethod: true },
  });
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!user.mfaEnabled || user.mfaMethod !== "EMAIL") return { ok: true };

  await db.user.update({
    where: { id: user.id },
    data: { mfaEnabled: false, mfaMethod: null, sessionVersion: { increment: 1 } },
  });
  // Any code already in flight is meaningless now, and a row that outlives
  // its purpose is a row nobody remembers to clean up.
  await clearEmailOtp(user.id);

  await recordAudit({
    actorId: user.id,
    action: "auth.mfa.disabled",
    targetType: "User",
    targetId: user.id,
    metadata: { method: "EMAIL" },
    ip: await getClientIp(),
  });

  revalidatePath("/account");
  revalidatePath("/account/settings");
  return { ok: true };
}
