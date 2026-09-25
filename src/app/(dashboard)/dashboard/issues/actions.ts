"use server";

import { revalidatePath } from "next/cache";
import { guardAction, requirePermission } from "@/lib/auth/rbac";
import { IssueTransitionError, transitionIssue } from "@/lib/issues";
import { alertDistrictOfIssue, alertReporterOfChange } from "@/lib/issueAlerts";
import { reviewNoteSchema } from "@/lib/validation/issue";
import type { IssueStatus } from "@/lib/issueVisibility";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request";

/**
 * Moving a report through the queue.
 *
 * Each action asks for a different permission on purpose. Checking a
 * report and publishing it are separate jobs, and keeping them separate is
 * what stops one account — mistaken, pressured or compromised — putting an
 * unchecked accusation in front of a whole district on its own.
 *
 * Every transition is audit-logged with who did it. If a report is ever
 * disputed, the question asked will be "who decided this was true", and
 * the answer has to exist.
 */

export interface QueueResult {
  ok: boolean;
  error?: string;
}

function revalidate() {
  revalidatePath("/dashboard/issues");
  revalidatePath("/issues");
}

/** Takes a report on, so two verifiers do not chase the same one. */
export async function claimIssue(issueId: string): Promise<QueueResult> {
  return run(issueId, "UNDER_REVIEW", "issue.verify", null, "issue.claim");
}

/** Sends it back to the pile without a decision. */
export async function releaseIssue(issueId: string): Promise<QueueResult> {
  return run(issueId, "SUBMITTED", "issue.verify", null, "issue.release");
}

/** Checked out and true, but not yet public. */
export async function verifyIssue(issueId: string): Promise<QueueResult> {
  return run(issueId, "VERIFIED", "issue.verify", null, "issue.verify");
}

/**
 * Could not be substantiated.
 *
 * The note is required, and it is shown to the reporter. Somebody who took
 * a risk to report something is owed a reason — silence after a rejection
 * is how a platform teaches people not to bother next time.
 */
export async function rejectIssue(issueId: string, note: string): Promise<QueueResult> {
  const parsed = reviewNoteSchema.safeParse(note);
  if (!parsed.success || !parsed.data) {
    return { ok: false, error: "Say why it could not be verified. The reporter will see this." };
  }
  return run(issueId, "REJECTED", "issue.verify", parsed.data, "issue.reject");
}

/**
 * Makes a verified report public, and tells the district.
 *
 * The alerting happens here rather than inside the transition, because it
 * is the one irreversible part: a notification cannot be recalled. Keeping
 * it beside the permission check makes it obvious what pressing this
 * button actually does.
 */
export async function publishIssue(issueId: string): Promise<QueueResult> {
  return run(issueId, "PUBLISHED", "issue.publish", null, "issue.publish", async () => {
    const alert = await alertDistrictOfIssue(issueId);
    return { notified: alert.notified, truncated: alert.truncated };
  });
}

/** The thing complained about was dealt with. */
export async function resolveIssue(issueId: string, note: string): Promise<QueueResult> {
  const parsed = reviewNoteSchema.safeParse(note);
  if (!parsed.success || !parsed.data) {
    return { ok: false, error: "Say what changed. This is shown on the published report." };
  }
  return run(issueId, "RESOLVED", "issue.resolve", parsed.data, "issue.resolve");
}

async function run(
  issueId: string,
  to: IssueStatus,
  permission: string,
  note: string | null,
  action: string,
  after?: () => Promise<Record<string, unknown>>
): Promise<QueueResult> {
  return guardAction(async () => {
    const session = await requirePermission(permission);

    let result;
    try {
      result = await transitionIssue({ issueId, to, actorId: session.user.id, note });
    } catch (err) {
      if (err instanceof IssueTransitionError) return { ok: false, error: err.message };
      throw err;
    }

    const extra = after ? await after() : {};

    // The reporter hears about every outcome, including rejection.
    // Deliberately after the transition and not inside it: a failed push
    // must not roll back a decision somebody made.
    await alertReporterOfChange(issueId).catch(() => {});

    await recordAudit({
      actorId: session.user.id,
      action,
      targetType: "Issue",
      targetId: issueId,
      metadata: { from: result.from, to, ...extra },
      ip: await getClientIp(),
    });

    revalidate();
    return { ok: true };
  }) as Promise<QueueResult>;
}
