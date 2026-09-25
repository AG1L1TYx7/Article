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
    // Optional in the schema, required by the branch below whenever the
    // account actually has a password. An account created through Google
    // has none, and demanding the current one would leave that person
    // permanently unable to add one.
    current: z.string().optional(),
    next: z.string().min(12, "Use at least 12 characters.").max(256),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { message: "The two new passwords don't match.", path: ["confirm"] })
  .refine((v) => !v.current || v.next !== v.current, {
    message: "Choose a password you haven't just used.",
    path: ["next"],
  });

export interface ChangePasswordResult {
  ok: boolean;
  error?: string;
}

/**
 * Changes the signed-in person's password — or sets a first one.
 *
 * The current password is required whenever there is one, even when the
 * change is compulsory (temporary password on first login): it was typed
 * a minute ago, and asking again is what stops someone who finds an
 * unlocked, signed-in browser from taking the account over.
 *
 * An account created through Google has no password at all, and there is
 * nothing to ask for. Being signed in is the whole of the proof available
 * and the whole of what is needed: the person is already holding the
 * account. Adding a password is also what makes "Disconnect Google"
 * possible, so refusing this would trap them with exactly one way in.
 *
 * Clears mustChangePassword, which is what lets proxy.ts release them to
 * the rest of the site. Does not sign out other sessions — see the note
 * on revokeAllSessions for why that is a separate, deliberate action.
 */
export async function changePassword(input: {
  current?: string;
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
  if (!user) return { ok: false, error: "You are not signed in." };

  // Setting a first password (a Google-only account) skips this; changing
  // an existing one never does.
  if (user.passwordHash) {
    if (!parsed.data.current) return { ok: false, error: "Enter your current password." };
    const valid = await verifyPassword(user.passwordHash, parsed.data.current).catch(() => false);
    if (!valid) return { ok: false, error: "That isn't your current password." };
  }

  if (await isPasswordBreached(parsed.data.next)) {
    return { ok: false, error: "That password appears in a known data breach. Choose a different one." };
  }

  await db.user.update({
    where: { id: user.id },
    // Deliberately does NOT bump sessionVersion here, even though ending
    // other sessions is exactly what somebody changing a password after a
    // compromise wants.
    //
    // sessionVersion is global. Incrementing it invalidates the token that
    // is doing the incrementing, so the person is signed out by their own
    // password change — and worse, somebody sent here by
    // mustChangePassword is thrown back to the login page mid-flow.
    //
    // The capability still exists and now has a control: "Sign out
    // everywhere" on the account page, offered right beside this form. It
    // signs this browser out too, which is honest about what it does.
    data: { passwordHash: await hashPassword(parsed.data.next), mustChangePassword: false },
  });

  // A remembered device was remembered under the old password's tenure;
  // start clean.
  (await cookies()).delete(TRUST_COOKIE);

  await recordAudit({
    actorId: user.id,
    action: user.passwordHash ? "user.password.change" : "user.password.set",
    targetType: "User",
    targetId: user.id,
    ip: await getClientIp(),
  });

  return { ok: true };
}
