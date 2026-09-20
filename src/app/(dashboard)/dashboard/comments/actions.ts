"use server";

import { db } from "@/lib/db";
import { requireRole, guardAction } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import { notifyCommentApproved, notifyReply } from "@/lib/notifications";
import { getClientIp } from "@/lib/request";
import { revalidatePath } from "next/cache";

export interface ModerationResult {
  ok: boolean;
  error?: string;
}

async function moderate(
  commentId: string,
  status: "APPROVED" | "HIDDEN" | "DELETED",
  action: string
): Promise<ModerationResult> {
  return guardAction(async () => {
    const session = await requireRole("MODERATOR");

    const comment = await db.comment.findUnique({
      where: { id: commentId },
      include: { article: { select: { slug: true } } },
    });
    if (!comment) return { ok: false, error: "That comment no longer exists." };

    await db.comment.update({ where: { id: commentId }, data: { status } });

    // Approval is the moment a held comment becomes public, so it is also
    // the moment it can safely be announced — both to its own author and
    // to whoever it was replying to.
    if (status === "APPROVED") {
      await notifyCommentApproved(commentId, session.user.id);
      await notifyReply(commentId);
    }

    // Moderation is exactly the kind of privileged action the audit log
    // exists for — who hid whose comment, and when.
    await recordAudit({
      actorId: session.user.id,
      action,
      targetType: "Comment",
      targetId: commentId,
      ip: await getClientIp(),
    });

    revalidatePath("/dashboard/comments");
    revalidatePath(`/article/${comment.article.slug}`);
    return { ok: true };
  });
}

// Every export from a "use server" file has to be an async function —
// arrow-function shorthands are rejected at build time, even though they
// type-check and lint cleanly.
export async function approveComment(id: string) {
  return moderate(id, "APPROVED", "comment.approve");
}

export async function hideComment(id: string) {
  return moderate(id, "HIDDEN", "comment.hide");
}

export async function deleteComment(id: string) {
  return moderate(id, "DELETED", "comment.delete");
}

/**
 * Suspends an account so it can't sign in or comment. Deliberately
 * reversible (status flips back) and never deletes the person's history —
 * the audit trail and their past comments stay intact.
 */
export async function suspendCommenter(userId: string): Promise<ModerationResult> {
  return guardAction(async () => {
    const session = await requireRole("MODERATOR");

    const target = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!target) return { ok: false, error: "That account no longer exists." };
    // A moderator suspending staff (or themselves) is not a thing.
    if (target.role !== "READER") {
      return { ok: false, error: "Only reader accounts can be suspended from here." };
    }

    await db.user.update({
      where: { id: userId },
      // Bumping sessionVersion logs them out everywhere immediately,
      // rather than leaving an active session running until it expires.
      data: { status: "SUSPENDED", sessionVersion: { increment: 1 } },
    });

    await recordAudit({
      actorId: session.user.id,
      action: "user.suspend",
      targetType: "User",
      targetId: userId,
      ip: await getClientIp(),
    });

    revalidatePath("/dashboard/comments");
    return { ok: true };
  });
}
