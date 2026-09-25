"use server";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole, requirePermission, guardAction } from "@/lib/auth/rbac";
import { assignRole, RoleRuleError } from "@/lib/auth/roleService";
import { hashPassword } from "@/lib/auth/password";
import { createToken } from "@/lib/auth/tokens";
import { sendEmail, passwordResetEmail } from "@/lib/email";
import { getBaseUrl } from "@/lib/url";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request";
import { revalidatePath } from "next/cache";

export interface UserActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Refuses a change that would leave nobody able to administer the site.
 *
 * Demoting or suspending the last admin is unrecoverable through the UI —
 * the only way back is the bootstrap:staff script on the server, which
 * assumes whoever did it still has shell access. Cheap to check, and the
 * one mistake here that cannot be undone from inside the application.
 */
async function wouldRemoveLastAdmin(userId: string): Promise<boolean> {
  const target = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, status: true },
  });
  if (target?.role !== "ADMIN" || target.status !== "ACTIVE") return false;

  const otherActiveAdmins = await db.user.count({
    where: { role: "ADMIN", status: "ACTIVE", id: { not: userId } },
  });
  return otherActiveAdmins === 0;
}

const newUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().max(254),
  handle: z
    .string()
    .trim()
    .min(3)
    .max(30)
    .regex(/^[a-z0-9_-]+$/, "Handle can only contain lowercase letters, numbers, - and _"),
  roleId: z.string().min(1, "Pick a role."),
  // Optional: the admin picks the temporary password (to read out over
  // the phone, say). Same length rule as registration. Empty means
  // "generate one".
  temporaryPassword: z
    .string()
    .max(256)
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : undefined))
    .refine((v) => !v || v.length >= 12, "A temporary password must be at least 12 characters"),
});

export interface CreateUserResult extends UserActionResult {
  /** Shown once; never stored in plain text or logged. */
  temporaryPassword?: string;
  emailed?: boolean;
}

/**
 * An admin adds a person directly, with a role, instead of asking them to
 * register and then promoting them. The account is email-verified on the
 * spot — the admin is vouching for the address — and gets a random
 * temporary password, shown once to the admin. A password-reset link is
 * also emailed, so where mail is configured the person never needs the
 * temporary password at all.
 */
export async function createUser(input: {
  name: string;
  email: string;
  handle: string;
  roleId: string;
  temporaryPassword?: string;
}): Promise<CreateUserResult> {
  return guardAction(async () => {
    const session = await requirePermission("user.manage");

    const parsed = newUserSchema.safeParse({ ...input, email: input.email.trim().toLowerCase() });
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const { name, email, handle, roleId } = parsed.data;

    const clash = await db.user.findFirst({
      where: { OR: [{ email }, { handle }] },
      select: { email: true },
    });
    if (clash) {
      return {
        ok: false,
        error: clash.email === email ? "An account with that email already exists." : "That handle is taken.",
      };
    }

    const role = await db.userRole.findUnique({
      where: { id: roleId },
      select: { id: true, key: true, tier: true },
    });
    if (!role) return { ok: false, error: "That is not a role." };

    const temporaryPassword = parsed.data.temporaryPassword ?? randomBytes(12).toString("base64url");
    const user = await db.user.create({
      data: {
        name,
        email,
        handle,
        // Both columns together — see assignRole() in lib/auth/roleService.ts
        // for why User.role is a denormalised copy of the role's tier.
        roleId: role.id,
        role: role.tier,
        passwordHash: await hashPassword(temporaryPassword),
        emailVerifiedAt: new Date(),
        // Whoever made this password up, it is not the person's own: the
        // first thing they do after signing in is choose one that is.
        mustChangePassword: true,
      },
      select: { id: true },
    });

    await recordAudit({
      actorId: session.user.id,
      action: "user.create",
      targetType: "User",
      targetId: user.id,
      metadata: { role: role.key },
      ip: await getClientIp(),
    });

    // Best effort: locally this lands in .email-dev-outbox.log; in
    // production it is the link they actually use.
    let emailed = false;
    try {
      await emailPasswordReset(email);
      emailed = true;
    } catch {
      // The temporary password still works.
    }

    revalidatePath("/dashboard/users");
    return { ok: true, temporaryPassword, emailed };
  });
}

/** Sends a reset link to an existing person — for "I've forgotten it" at the desk. */
export async function sendPasswordResetTo(userId: string): Promise<UserActionResult> {
  return guardAction(async () => {
    const session = await requireRole("ADMIN");
    const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) return { ok: false, error: "That account no longer exists." };
    await emailPasswordReset(user.email);
    await recordAudit({
      actorId: session.user.id,
      action: "user.password_reset_sent",
      targetType: "User",
      targetId: userId,
      ip: await getClientIp(),
    });
    return { ok: true };
  });
}

async function emailPasswordReset(email: string) {
  const token = await createToken("password-reset", email, 60 * 60 * 1000);
  const link = `${await getBaseUrl()}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
  await sendEmail({ to: email, ...passwordResetEmail(link) });
}

/**
 * Moves somebody onto a role.
 *
 * Takes a role id now that roles are editable data, not one of three
 * fixed names. Every rule this used to apply inline — no self-edit, never
 * the last administrator — moved to assignRole() in lib/auth/roleService.ts,
 * because the role editor can reach the same dangerous states from the
 * other direction and a rule written twice is a rule enforced once.
 */
export async function setUserRole(userId: string, roleId: string): Promise<UserActionResult> {
  return guardAction(async () => {
    const session = await requirePermission("user.manage");

    const [target, role] = await Promise.all([
      db.user.findUnique({ where: { id: userId }, select: { id: true, roleId: true } }),
      db.userRole.findUnique({ where: { id: roleId }, select: { id: true, key: true } }),
    ]);
    if (!target) return { ok: false, error: "That account no longer exists." };
    if (!role) return { ok: false, error: "That is not a role." };
    if (target.roleId === role.id) return { ok: true };

    const previous = target.roleId
      ? await db.userRole.findUnique({ where: { id: target.roleId }, select: { key: true } })
      : null;

    try {
      await assignRole({ userId, roleId: role.id, actorId: session.user.id });
    } catch (err) {
      if (err instanceof RoleRuleError) return { ok: false, error: err.message };
      throw err;
    }

    await recordAudit({
      actorId: session.user.id,
      action: "user.role.change",
      targetType: "User",
      targetId: userId,
      metadata: { from: previous?.key ?? null, to: role.key },
      ip: await getClientIp(),
    });

    revalidatePath("/dashboard/users");
    return { ok: true };
  });
}

export async function setUserStatus(userId: string, status: string): Promise<UserActionResult> {
  return guardAction(async () => {
    const session = await requireRole("ADMIN");

    if (status !== "ACTIVE" && status !== "SUSPENDED" && status !== "BANNED") {
      return { ok: false, error: "That is not a status." };
    }

    if (userId === session.user.id) {
      return { ok: false, error: "You cannot suspend your own account." };
    }

    const target = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true },
    });
    if (!target) return { ok: false, error: "That account no longer exists." };
    if (target.status === status) return { ok: true };

    if (status !== "ACTIVE" && (await wouldRemoveLastAdmin(userId))) {
      return { ok: false, error: "That is the last active admin. Promote someone else first." };
    }

    await db.user.update({
      where: { id: userId },
      data: {
        status: status as "ACTIVE" | "SUSPENDED" | "BANNED",
        // Logs them out everywhere immediately. A suspension that waits
        // for a token to expire is not a suspension.
        sessionVersion: { increment: 1 },
      },
    });

    await recordAudit({
      actorId: session.user.id,
      action: status === "ACTIVE" ? "user.reinstate" : "user.suspend",
      targetType: "User",
      targetId: userId,
      metadata: { from: target.status, to: status },
      ip: await getClientIp(),
    });

    revalidatePath("/dashboard/users");
    return { ok: true };
  });
}
