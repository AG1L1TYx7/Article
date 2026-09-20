import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

interface AuditEntry {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Appends one row to the audit log. This table has no update/delete path
 * anywhere in the application — see prisma/schema.prisma. Call this from
 * every handler gated by requireRole(), after the mutation succeeds.
 */
export function recordAudit(entry: AuditEntry) {
  return db.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      metadata: entry.metadata,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
    },
  });
}

/**
 * Records an authentication event against the account it concerns.
 *
 * Separate from recordAudit only to name the intent: here the actor and
 * the target are the same person, and the caller is usually not acting on
 * their own behalf — a failed login is written about someone who has not
 * proved who they are.
 *
 * Never throws. A login must not fail because the audit write did, and an
 * attacker must not be able to tell the two apart.
 */
export async function recordAuthEvent(entry: {
  userId: string;
  action:
    | "auth.login"
    | "auth.login.failed"
    | "auth.login.locked"
    | "auth.login.mfa_failed"
    | "auth.login.blocked"
    | "auth.mfa.device_trusted"
    | "auth.mfa.device_forgotten";
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
}): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorId: entry.userId,
        action: entry.action,
        targetType: "User",
        targetId: entry.userId,
        metadata: entry.metadata,
        ip: entry.ip ?? null,
      },
    });
  } catch {
    // Deliberately swallowed. See above.
  }
}
