import { db } from "@/lib/db";

/**
 * Creating notifications.
 *
 * Two rules hold everywhere in this file:
 *
 * 1. Only ever for content that is already public. A notification about a
 *    comment still sitting in the moderation queue would hand its text to
 *    someone who is not supposed to see it yet, and would turn the queue
 *    into a delivery mechanism for whatever a spammer wants to say.
 * 2. Never notify someone about their own action. Replying to yourself,
 *    or a moderator approving their own comment, should be silent.
 *
 * Writes are idempotent via the unique index on
 * (userId, type, commentId) — a comment can legitimately reach APPROVED
 * more than once, and each path tries to notify.
 */

/** Swallows the duplicate-key error the unique index raises on a repeat. */
async function createOnce(data: {
  userId: string;
  type: "COMMENT_REPLY" | "COMMENT_APPROVED";
  actorId?: string | null;
  articleId?: string | null;
  commentId: string;
}): Promise<void> {
  // createMany + skipDuplicates rather than catching P2002: it does the
  // same job in one round trip and without pattern-matching on an error
  // code that is a detail of the driver.
  await db.notification.createMany({ data: [data], skipDuplicates: true });
}

/**
 * Tells the parent comment's author that someone replied.
 *
 * Call only once the reply is APPROVED — from the post path when a trusted
 * account's reply goes straight out, and from the moderation path when a
 * held one is let through.
 */
export async function notifyReply(replyId: string): Promise<void> {
  const reply = await db.comment.findUnique({
    where: { id: replyId },
    select: {
      id: true,
      status: true,
      userId: true,
      articleId: true,
      parent: { select: { userId: true, status: true } },
    },
  });

  if (!reply?.parent) return;
  // Re-checked here rather than trusted from the caller: this is the one
  // place that decides whether a comment is public enough to announce.
  if (reply.status !== "APPROVED") return;
  // A reply to a comment that has since been hidden or deleted shouldn't
  // drag its author back into the thread.
  if (reply.parent.status !== "APPROVED") return;
  if (reply.parent.userId === reply.userId) return;

  await createOnce({
    userId: reply.parent.userId,
    type: "COMMENT_REPLY",
    actorId: reply.userId,
    articleId: reply.articleId,
    commentId: reply.id,
  });
}

/**
 * Tells an author their held comment is now public.
 *
 * Closes the loop on moderation: the post form promises "a moderator will
 * review it", and without this nothing ever says that it happened.
 */
export async function notifyCommentApproved(commentId: string, moderatorId: string): Promise<void> {
  const comment = await db.comment.findUnique({
    where: { id: commentId },
    select: { id: true, status: true, userId: true, articleId: true },
  });

  if (!comment || comment.status !== "APPROVED") return;
  // A moderator approving their own comment doesn't need telling.
  if (comment.userId === moderatorId) return;

  await createOnce({
    userId: comment.userId,
    type: "COMMENT_APPROVED",
    actorId: null,
    articleId: comment.articleId,
    commentId: comment.id,
  });
}

export async function unreadNotificationCount(userId: string): Promise<number> {
  return db.notification.count({ where: { userId, readAt: null } });
}
