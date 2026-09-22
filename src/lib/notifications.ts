import { after } from "next/server";
import { db } from "@/lib/db";
import { pushToUser } from "@/lib/push";
import { commentApprovedPayload, commentReplyPayload, type PushPayload } from "@/lib/pushPayload";

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

/**
 * Swallows the duplicate-key error the unique index raises on a repeat,
 * and — only when a row was actually written — sends the same alert to
 * the person's devices as a push notification. Idempotency covers both:
 * a second attempt writes nothing and so pushes nothing.
 *
 * The push goes out after the response, so a reader's reply is not held
 * up waiting on a push service.
 */
async function createOnce(
  data: {
    userId: string;
    type: "COMMENT_REPLY" | "COMMENT_APPROVED";
    actorId?: string | null;
    articleId?: string | null;
    commentId: string;
  },
  push: () => PushPayload
): Promise<void> {
  // createMany + skipDuplicates rather than catching P2002: it does the
  // same job in one round trip and without pattern-matching on an error
  // code that is a detail of the driver.
  const { count } = await db.notification.createMany({ data: [data], skipDuplicates: true });
  if (count > 0) after(() => pushToUser(data.userId, push()).catch(() => {}));
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
      body: true,
      anonymous: true,
      author: { select: { name: true } },
      article: { select: { slug: true, title: true } },
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

  await createOnce(
    {
      userId: reply.parent.userId,
      type: "COMMENT_REPLY",
      actorId: reply.userId,
      articleId: reply.articleId,
      commentId: reply.id,
    },
    () =>
      commentReplyPayload({
        // A push notification lands on a lock screen; an anonymous reply
        // must not name its author there either.
        actorName: reply.anonymous ? "Someone" : reply.author.name,
        articleSlug: reply.article.slug,
        articleTitle: reply.article.title,
        commentId: reply.id,
        body: reply.body,
      })
  );
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
    select: {
      id: true,
      status: true,
      userId: true,
      articleId: true,
      article: { select: { slug: true, title: true } },
    },
  });

  if (!comment || comment.status !== "APPROVED") return;
  // A moderator approving their own comment doesn't need telling.
  if (comment.userId === moderatorId) return;

  await createOnce(
    {
      userId: comment.userId,
      type: "COMMENT_APPROVED",
      actorId: null,
      articleId: comment.articleId,
      commentId: comment.id,
    },
    () =>
      commentApprovedPayload({
        articleSlug: comment.article.slug,
        articleTitle: comment.article.title,
        commentId: comment.id,
      })
  );
}

export async function unreadNotificationCount(userId: string): Promise<number> {
  return db.notification.count({ where: { userId, readAt: null } });
}

/**
 * How many readers one breaking story will alert in a single publish.
 *
 * A bound, not a target. Writing the rows takes one query regardless, but
 * an unbounded fan-out in the request that publishes the article means
 * the editor waits on it — and at real subscriber numbers this belongs in
 * a queue rather than inline. See the note in docs/ on scaling this.
 */
const BREAKING_FANOUT_LIMIT = 5_000;

/**
 * Alerts readers that a breaking story has been published.
 *
 * Goes to people who asked to hear from this author or this section —
 * never to everyone. An alert that is not opted into is a notification
 * people turn off, and then the one that matters is missed too.
 *
 * Only for articles flagged breaking. Every publish alerting every
 * follower would make the flag meaningless within a week.
 */
export async function notifyBreakingNews(articleId: string): Promise<void> {
  const article = await db.article.findUnique({
    where: { id: articleId },
    select: {
      id: true,
      status: true,
      isBreaking: true,
      authorId: true,
      categoryId: true,
    },
  });

  // Re-checked here rather than trusted from the caller: this is the one
  // place that decides whether a story is worth interrupting people for.
  if (!article || article.status !== "PUBLISHED" || !article.isBreaking) return;

  const followers = await db.follow.findMany({
    where: {
      OR: [
        { authorId: article.authorId },
        ...(article.categoryId ? [{ categoryId: article.categoryId }] : []),
      ],
      // Not the author's own alert about their own story.
      followerId: { not: article.authorId },
    },
    select: { followerId: true },
    take: BREAKING_FANOUT_LIMIT,
  });

  if (followers.length === 0) return;

  // A reader following both the author and the section appears twice.
  const recipients = [...new Set(followers.map((f) => f.followerId))];

  // One query, and skipDuplicates makes a re-publish a no-op rather than
  // a second alert about the same story — which is what the unique index
  // on (userId, type, articleId) is there to enforce.
  await db.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      type: "BREAKING_NEWS" as const,
      actorId: article.authorId,
      articleId: article.id,
    })),
    skipDuplicates: true,
  });
}
