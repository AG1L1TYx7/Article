"use server";

import { db } from "@/lib/db";
import { requireVerifiedEmail, guardAction } from "@/lib/auth/rbac";
import { commentEditSchema, commentSchema, reportSchema } from "@/lib/validation/comment";
import { assessComment, TRUSTED_AFTER_APPROVED_COMMENTS } from "@/lib/spam";
import { isCommentEditable } from "@/lib/commentPolicy";
import { commentLimiter } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/request";
import { recordAudit } from "@/lib/audit";
import { notifyReply } from "@/lib/notifications";
import { revalidatePath } from "next/cache";

export interface CommentActionResult {
  ok: boolean;
  status?: "APPROVED" | "PENDING";
  error?: string;
}

// How deep replies can nest. Past this the thread is unreadable on a
// phone, and unbounded nesting is a cheap way to make a page render
// pathologically.
const MAX_REPLY_DEPTH = 3;

async function replyDepth(parentId: string): Promise<number> {
  let depth = 1;
  let current = await db.comment.findUnique({ where: { id: parentId }, select: { parentId: true } });
  while (current?.parentId && depth <= MAX_REPLY_DEPTH) {
    depth += 1;
    current = await db.comment.findUnique({ where: { id: current.parentId }, select: { parentId: true } });
  }
  return depth;
}

export async function postComment(input: {
  articleId: string;
  body: string;
  parentId?: string;
}): Promise<CommentActionResult> {
  return guardAction(async () => {
    // Commenting needs a confirmed address, same as publishing — the
    // cheapest bot signup shouldn't be able to post (security blueprint).
    const session = await requireVerifiedEmail("READER");

    const ip = await getClientIp();
    const { success } = await commentLimiter.limit(`${ip}:${session.user.id}`);
    if (!success) {
      return { ok: false, error: "You're commenting very quickly — give it a moment." };
    }

    const parsed = commentSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid comment" };
    }
    const { articleId, body, parentId } = parsed.data;

    const article = await db.article.findFirst({
      where: { id: articleId, status: "PUBLISHED" },
      select: { id: true, slug: true },
    });
    // Unpublished articles aren't publicly readable, so they can't be
    // publicly commented on either.
    if (!article) return { ok: false, error: "That article isn't available." };

    if (parentId) {
      const parent = await db.comment.findFirst({
        where: { id: parentId, articleId, status: "APPROVED" },
        select: { id: true },
      });
      if (!parent) return { ok: false, error: "That comment is no longer available to reply to." };
      if ((await replyDepth(parentId)) > MAX_REPLY_DEPTH) {
        return { ok: false, error: "This thread is too deeply nested — reply further up instead." };
      }
    }

    // Trust is earned: a new account's comments wait for a moderator, an
    // established account's post immediately — unless the content itself
    // trips a heuristic, which sends it for review regardless of who
    // wrote it.
    const approvedSoFar = await db.comment.count({
      where: { userId: session.user.id, status: "APPROVED" },
    });
    const spam = assessComment(body);
    const trusted = approvedSoFar >= TRUSTED_AFTER_APPROVED_COMMENTS;
    const status = trusted && !spam.needsReview ? "APPROVED" : "PENDING";

    const comment = await db.comment.create({
      data: { articleId, userId: session.user.id, parentId, body, status },
    });

    // Only a reply that is already public announces itself. A held one is
    // announced by the moderator's approval instead.
    if (status === "APPROVED" && parentId) await notifyReply(comment.id);

    revalidatePath(`/article/${article.slug}`);
    return { ok: true, status };
  });
}

export async function reportComment(input: {
  commentId: string;
  reason: "SPAM" | "ABUSE" | "MISINFORMATION" | "OTHER";
  note?: string;
}): Promise<CommentActionResult> {
  return guardAction(async () => {
    const session = await requireVerifiedEmail("READER");

    const parsed = reportSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid report" };
    }

    const comment = await db.comment.findUnique({
      where: { id: parsed.data.commentId },
      select: { id: true },
    });
    if (!comment) return { ok: false, error: "That comment no longer exists." };

    const existing = await db.report.findFirst({
      where: { commentId: comment.id, reporterId: session.user.id },
      select: { id: true },
    });
    // Reporting twice shouldn't stack the queue, but shouldn't look like
    // a failure to the reader either.
    if (existing) return { ok: true };

    await db.report.create({
      data: {
        reporterId: session.user.id,
        commentId: comment.id,
        reason: parsed.data.reason,
        note: parsed.data.note,
      },
    });

    await recordAudit({
      actorId: session.user.id,
      action: "comment.report",
      targetType: "Comment",
      targetId: comment.id,
      metadata: { reason: parsed.data.reason },
      ip: await getClientIp(),
    });

    return { ok: true };
  });
}


export async function editComment(input: {
  commentId: string;
  body: string;
}): Promise<CommentActionResult> {
  return guardAction(async () => {
    const session = await requireVerifiedEmail("READER");

    // Shares a bucket with posting on purpose: both are writes to the
    // comment system, and an edit loop is just as cheap to abuse as a
    // post loop.
    const ip = await getClientIp();
    const { success } = await commentLimiter.limit(`${ip}:${session.user.id}`);
    if (!success) {
      return { ok: false, error: "You're editing very quickly — give it a moment." };
    }

    const parsed = commentEditSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid comment" };
    }

    const comment = await db.comment.findUnique({
      where: { id: parsed.data.commentId },
      select: { id: true, userId: true, status: true, createdAt: true, article: { select: { slug: true } } },
    });
    // Same message for "doesn't exist" and "isn't yours", so this can't be
    // used to probe which comment ids are real.
    if (!comment || comment.userId !== session.user.id) {
      return { ok: false, error: "That comment is no longer available to edit." };
    }
    if (comment.status === "DELETED" || comment.status === "HIDDEN") {
      return { ok: false, error: "That comment is no longer available to edit." };
    }
    if (!isCommentEditable(comment.createdAt)) {
      return { ok: false, error: "Comments can only be edited for 15 minutes after posting." };
    }

    // The edited text goes through exactly the same trust and spam checks
    // as a new comment. Without this, editing would be a one-line
    // moderation bypass: post "hello", wait for approval, rewrite it as
    // spam. An edit can therefore send an already-public comment back to
    // the queue.
    const approvedSoFar = await db.comment.count({
      where: { userId: session.user.id, status: "APPROVED" },
    });
    const spam = assessComment(parsed.data.body);
    const trusted = approvedSoFar >= TRUSTED_AFTER_APPROVED_COMMENTS;
    const status = trusted && !spam.needsReview ? "APPROVED" : "PENDING";

    await db.comment.update({
      where: { id: comment.id },
      data: { body: parsed.data.body, status, editedAt: new Date() },
    });

    // An edit can move a held reply into public view. The unique index on
    // notifications makes a repeat here a no-op.
    if (status === "APPROVED") await notifyReply(comment.id);

    await recordAudit({
      actorId: session.user.id,
      action: "comment.edit",
      targetType: "Comment",
      targetId: comment.id,
      metadata: { status },
      ip,
    });

    revalidatePath(`/article/${comment.article.slug}`);
    return { ok: true, status };
  });
}

export async function deleteOwnComment(commentId: string): Promise<CommentActionResult> {
  return guardAction(async () => {
    const session = await requireVerifiedEmail("READER");

    const comment = await db.comment.findUnique({
      where: { id: commentId },
      select: { id: true, userId: true, status: true, article: { select: { slug: true } } },
    });
    if (!comment || comment.userId !== session.user.id) {
      return { ok: false, error: "That comment is no longer available." };
    }
    // Already gone — report success rather than an error, so a double
    // click doesn't look like a failure.
    if (comment.status === "DELETED") return { ok: true };

    // Soft delete, matching the moderation queue: the row stays for the
    // audit trail, and the reader-facing query stops returning the text.
    // There is no path that hard-deletes a comment.
    await db.comment.update({
      where: { id: comment.id },
      data: { status: "DELETED" },
    });

    await recordAudit({
      actorId: session.user.id,
      action: "comment.delete.own",
      targetType: "Comment",
      targetId: comment.id,
      ip: await getClientIp(),
    });

    revalidatePath(`/article/${comment.article.slug}`);
    return { ok: true };
  });
}
