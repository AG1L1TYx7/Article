"use server";

import { revalidatePath } from "next/cache";
import { guardAction, requirePermission } from "@/lib/auth/rbac";
import {
  ContributionError,
  confirmContribution,
  failContribution,
  refundContribution,
} from "@/lib/contributions";
import { recordAudit } from "@/lib/audit";
import type { Prisma } from "@/generated/prisma/client";
import { getClientIp } from "@/lib/request";

/**
 * Moving money in the records.
 *
 * Every one of these is audit-logged with the amount and the reference,
 * because these are the actions an auditor would ask about: who said this
 * money arrived, and when. The audit log is append-only and nothing in the
 * application can edit it, which is exactly the property a financial
 * record wants.
 *
 * Gated on `contribution.confirm` rather than on a role, so an
 * administrator can give the treasurer this and nothing else.
 */

export interface MoneyResult {
  ok: boolean;
  error?: string;
}

async function run(
  action: string,
  contributionId: string,
  work: (actorId: string) => Promise<void>,
  extra: Prisma.InputJsonValue = {}
): Promise<MoneyResult> {
  return guardAction(async () => {
    const session = await requirePermission("contribution.confirm");
    try {
      await work(session.user.id);
    } catch (err) {
      if (err instanceof ContributionError) return { ok: false, error: err.message };
      throw err;
    }

    await recordAudit({
      actorId: session.user.id,
      action,
      targetType: "Contribution",
      targetId: contributionId,
      metadata: extra,
      ip: await getClientIp(),
    });

    revalidatePath("/dashboard/contributions");
    return { ok: true };
  }) as Promise<MoneyResult>;
}

/** The money is in the account. */
export async function confirmAction(
  contributionId: string,
  providerRef: string,
  staffNote: string
): Promise<MoneyResult> {
  return run(
    "contribution.confirm",
    contributionId,
    (actorId) => confirmContribution({ contributionId, actorId, providerRef, staffNote }),
    { providerRef: providerRef || null }
  );
}

/** It never arrived. */
export async function markNotReceivedAction(
  contributionId: string,
  staffNote: string
): Promise<MoneyResult> {
  return run("contribution.fail", contributionId, (actorId) =>
    failContribution({ contributionId, actorId, staffNote })
  );
}

/**
 * It was given back.
 *
 * The reason is required, and it is kept. A refund with no explanation is
 * the line in the books somebody has to reconstruct from memory a year
 * later.
 */
export async function refundAction(
  contributionId: string,
  staffNote: string
): Promise<MoneyResult> {
  return run("contribution.refund", contributionId, (actorId) =>
    refundContribution({ contributionId, actorId, staffNote })
  );
}
