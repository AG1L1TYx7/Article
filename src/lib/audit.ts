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
