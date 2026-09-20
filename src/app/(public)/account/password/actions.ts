"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth/config";
import { hashPassword, isPasswordBreached, verifyPassword } from "@/lib/auth/password";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request";
import { cookies } from "next/headers";
import { TRUST_COOKIE } from "@/lib/auth/trustedDevice";

const schema = z
  .object({
    current: z.string().min(1, "Enter your current password."),
    next: z.string().min(12, "Use at least 12 characters.").max(256),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { message: "The two new passwords don't match.", path: ["confirm"] })
  .refine((v) => v.next !== v.current, { message: "Choose a password you haven't just used.", path: ["next"] });

export interface ChangePasswordResult {
  ok: boolean;
  error?: string;
}

/**
 * Changes the signed-in person's password. The current one is required
 * even when the change is compulsory (temporary password on first login):
 * it was typed a minute ago, and asking again is what stops someone who
 * finds an unlocked, signed-in browser from taking the account over.
 *
 * Clears mustChangePassword, which is what lets proxy.ts release them to
 * the rest of the site. Does not sign out other sessions — see the note
 * on revokeAllSessions for why that is a separate, deliberate action.
 */
export async function changePassword(input: {
  current: string;
  next: string;
  confirm: string;
}): Promise<ChangePasswordResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You are not signed in." };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, passwordHash: true },
  });
  if (!user?.passwordHash) return { ok: false, error: "This account has no password to change." };

  const valid = await verifyPassword(user.passwordHash, parsed.data.current).catch(() => false);
  if (!valid) return { ok: false, error: "That isn't your current password." };

  if (await isPasswordBreached(parsed.data.next)) {
    return { ok: false, error: "That password appears in a known data breach. Choose a different one." };
  }

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(parsed.data.next), mustChangePassword: false },
  });

  // A remembered device was remembered under the old password's tenure;
  // start clean.
  (await cookies()).delete(TRUST_COOKIE);

  await recordAudit({
    actorId: user.id,
    action: "user.password.change",
    targetType: "User",
    targetId: user.id,
    ip: await getClientIp(),
  });

  return { ok: true };
}
