"use server";

import { db } from "@/lib/db";
import { requireRole, guardAction } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request";
import { revalidatePath } from "next/cache";

export interface UserActionResult {
  ok: boolean;
  error?: string;
}

const ASSIGNABLE_ROLES = ["READER", "MODERATOR", "ADMIN"] as const;
type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

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

export async function setUserRole(userId: string, role: string): Promise<UserActionResult> {
  return guardAction(async () => {
    const session = await requireRole("ADMIN");

    if (!ASSIGNABLE_ROLES.includes(role as AssignableRole)) {
      return { ok: false, error: "That is not a role." };
    }

    // Changing your own role is how an admin accidentally locks
    // themselves out of the page they are standing on.
    if (userId === session.user.id) {
      return { ok: false, error: "You cannot change your own role. Ask another admin." };
    }

    const target = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, email: true },
    });
    if (!target) return { ok: false, error: "That account no longer exists." };
    if (target.role === role) return { ok: true };

    if (role !== "ADMIN" && (await wouldRemoveLastAdmin(userId))) {
      return { ok: false, error: "That is the last active admin. Promote someone else first." };
    }

    await db.user.update({
      where: { id: userId },
      data: {
        role: role as AssignableRole,
        // Their existing sessions carry the old role in a token that is
        // re-checked but not re-issued. Bumping this invalidates them, so
        // the change takes effect on their very next request rather than
        // whenever they happen to log in again.
        sessionVersion: { increment: 1 },
      },
    });

    await recordAudit({
      actorId: session.user.id,
      action: "user.role.change",
      targetType: "User",
      targetId: userId,
      metadata: { from: target.role, to: role },
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
