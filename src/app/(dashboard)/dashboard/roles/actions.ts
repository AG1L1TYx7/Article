"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, guardAction } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request";
import {
  RoleRuleError,
  createRole,
  deleteRole,
  updateRole,
} from "@/lib/auth/roleService";
import type { Tier } from "@/lib/auth/permissions";

/**
 * Creating and editing roles.
 *
 * Every one of these is gated on `role.manage`, which is the permission
 * that can grant every other permission — so it is also the one whose use
 * most needs to be on the record. Each action writes an audit entry naming
 * the role and the permissions as they ended up, because "who gave that
 * account the ability to publish" is a question this platform will
 * eventually be asked by somebody outside it.
 *
 * The rules themselves live in lib/auth/roleService.ts, not here: there is
 * more than one way to reach most of them, and a rule written twice is a
 * rule enforced once.
 */

export interface RoleActionResult {
  ok: boolean;
  error?: string;
}

function tierFrom(value: FormDataEntryValue | null): Tier {
  return value === "ADMIN" || value === "MODERATOR" ? value : "READER";
}

/** Ticked boxes arrive as repeated `permission` entries. */
function permissionsFrom(formData: FormData): string[] {
  return formData.getAll("permission").map(String);
}

export async function createRoleAction(formData: FormData): Promise<RoleActionResult> {
  return guardAction(async () => {
    const session = await requirePermission("role.manage");
    const permissions = permissionsFrom(formData);

    try {
      const role = await createRole({
        key: String(formData.get("key") ?? ""),
        name: String(formData.get("name") ?? ""),
        description: String(formData.get("description") ?? ""),
        tier: tierFrom(formData.get("tier")),
        permissions,
      });

      await recordAudit({
        actorId: session.user.id,
        action: "role.create",
        targetType: "UserRole",
        targetId: role.id,
        metadata: { key: role.key, name: role.name, permissions },
        ip: await getClientIp(),
      });
    } catch (err) {
      if (err instanceof RoleRuleError) return { ok: false, error: err.message };
      throw err;
    }

    revalidatePath("/dashboard/roles");
    return { ok: true };
  }) as Promise<RoleActionResult>;
}

export async function updateRoleAction(
  roleId: string,
  formData: FormData
): Promise<RoleActionResult> {
  return guardAction(async () => {
    const session = await requirePermission("role.manage");
    const permissions = permissionsFrom(formData);

    try {
      await updateRole(roleId, {
        name: String(formData.get("name") ?? ""),
        description: String(formData.get("description") ?? ""),
        tier: tierFrom(formData.get("tier")),
        permissions,
      });

      await recordAudit({
        actorId: session.user.id,
        action: "role.update",
        targetType: "UserRole",
        targetId: roleId,
        // The resulting set, not the difference: a diff needs the previous
        // state to read, and the audit log is append-only precisely so that
        // previous state is still sitting in the row before this one.
        metadata: { permissions },
        ip: await getClientIp(),
      });
    } catch (err) {
      if (err instanceof RoleRuleError) return { ok: false, error: err.message };
      throw err;
    }

    revalidatePath("/dashboard/roles");
    return { ok: true };
  }) as Promise<RoleActionResult>;
}

export async function deleteRoleAction(roleId: string): Promise<RoleActionResult> {
  return guardAction(async () => {
    const session = await requirePermission("role.manage");

    try {
      await deleteRole(roleId);
      await recordAudit({
        actorId: session.user.id,
        action: "role.delete",
        targetType: "UserRole",
        targetId: roleId,
        ip: await getClientIp(),
      });
    } catch (err) {
      if (err instanceof RoleRuleError) return { ok: false, error: err.message };
      throw err;
    }

    revalidatePath("/dashboard/roles");
    return { ok: true };
  }) as Promise<RoleActionResult>;
}
