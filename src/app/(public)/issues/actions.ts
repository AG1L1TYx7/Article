"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth/config";
import { guardAction, requireVerifiedPermission } from "@/lib/auth/rbac";
import { submitIssue } from "@/lib/issues";
import { issueSchema } from "@/lib/validation/issue";
import { commentLimiter } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/request";

/**
 * A member files a report.
 *
 * Gated on a verified email address as well as the permission. Somebody
 * who has not proved they can read their own inbox cannot be told what
 * happened to their report, and a report nobody can go back to cannot be
 * verified — so the address is not bureaucracy here, it is the thread back
 * to the person.
 *
 * Rate limited on the same budget as commenting. A report costs a verifier
 * real time to check, so the cost of flooding the queue has to be higher
 * than the cost of typing.
 */
export interface SubmitResult {
  ok: boolean;
  error?: string;
  reference?: string;
  slug?: string;
}

export async function submitIssueAction(input: unknown): Promise<SubmitResult> {
  return guardAction(async () => {
    const session = await requireVerifiedPermission("issue.submit");

    const ip = await getClientIp();
    const { success } = await commentLimiter.limit(ip);
    if (!success) {
      return { ok: false, error: "Too many reports from here just now. Try again in a few minutes." };
    }

    const parsed = issueSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
    }

    const created = await submitIssue(session.user.id, {
      title: parsed.data.title,
      body: parsed.data.body,
      categoryId: parsed.data.categoryId,
      districtId: parsed.data.districtId,
      municipalityId: parsed.data.municipalityId,
      ward: parsed.data.ward,
      anonymous: parsed.data.anonymous,
      mediaIds: parsed.data.mediaIds,
    });

    // Deliberately NOT audit-logged.
    //
    // An audit row names its actor, and AuditLog.actorId is not nullable —
    // so a row recording "this person submitted this issue" deanonymises
    // every anonymous report to anybody who can read the log. That is a
    // different and much wider audience than `issue.verify`, which is the
    // permission the whole design nominates as the gate for a reporter's
    // identity, and which carries mandatory two-factor because of it.
    //
    // Nothing is lost by omitting it. The audit log exists for privileged
    // actions — recordAudit's own contract is "call this from every
    // handler gated by requireRole()" — and a member raising a report is
    // not one. The Issue row is itself the record of who reported what,
    // and lib/issueVisibility.ts governs who may see that. Everything a
    // verifier subsequently does IS logged, with the verifier as actor.

    revalidatePath("/issues");
    return { ok: true, reference: created.reference, slug: created.slug };
  }) as Promise<SubmitResult>;
}

/**
 * Remembers where a member lives, so district alerts can reach them.
 *
 * Its own action rather than part of the report form: somebody may want
 * alerts without ever filing anything, and somebody filing a report about
 * a district they are visiting should not be moved there.
 */
export async function setHomeDistrict(districtId: string | null): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You are not signed in." };

  if (districtId) {
    const district = await db.district.findUnique({ where: { id: districtId }, select: { id: true } });
    if (!district) return { ok: false, error: "That is not a district." };
  }

  await db.user.update({
    where: { id: session.user.id },
    data: { districtId: districtId || null },
  });

  revalidatePath("/account");
  return { ok: true };
}
