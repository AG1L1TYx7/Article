import Link from "next/link";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth/config";
import { CommentForm } from "./CommentForm";
import { CommentThread, type CommentNode } from "./CommentThread";
import { CommentNoticeProvider } from "./CommentNotice";
import { isCommentEditable } from "@/lib/commentPolicy";

/** Counts the comments a reader can actually read, tombstones excluded. */
function countVisible(nodes: CommentNode[]): number {
  return nodes.reduce((n, node) => n + (node.deleted ? 0 : 1) + countVisible(node.replies), 0);
}

/**
 * Drops deleted comments that nothing hangs off.
 *
 * A deleted comment is only kept when it still has visible replies: losing
 * it entirely would take other people's replies down with it, which turns
 * "delete my comment" into a way to erase a conversation you did not
 * write. Bottom-up, so a deleted comment whose only replies were also
 * deleted disappears completely.
 */
function pruneTombstones(nodes: CommentNode[]): CommentNode[] {
  const kept: CommentNode[] = [];
  for (const node of nodes) {
    node.replies = pruneTombstones(node.replies);
    if (node.deleted && node.replies.length === 0) continue;
    kept.push(node);
  }
  return kept;
}

/**
 * PENDING comments are waiting on a moderator and HIDDEN ones were taken
 * down by staff — neither is ever loaded here. DELETED ones are loaded
 * only so a removed comment can leave a tombstone above its replies; their
 * text is replaced before the node reaches the client, so a deleted body
 * is never sent to a browser.
 */
export async function CommentSection({ articleId }: { articleId: string }) {
  const session = await auth();
  const viewerId = session?.user?.id ?? null;

  const comments = await db.comment.findMany({
    where: { articleId, status: { in: ["APPROVED", "DELETED"] } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      body: true,
      status: true,
      parentId: true,
      userId: true,
      createdAt: true,
      editedAt: true,
      author: { select: { name: true } },
      _count: { select: { reactions: true } },
    },
  });

  // One query for every like this viewer has on this thread, rather than
  // one per comment.
  const likedIds = new Set(
    viewerId
      ? (
          await db.reaction.findMany({
            where: { userId: viewerId, commentId: { in: comments.map((c) => c.id) } },
            select: { commentId: true },
          })
        ).map((r) => r.commentId!)
      : []
  );

  // Flat rows -> tree, in one pass. Replies whose parent isn't approved
  // are dropped rather than promoted to the top level, so hiding a
  // comment hides the sub-thread hanging off it too.
  const byId = new Map<string, CommentNode>();
  for (const c of comments) {
    const deleted = c.status === "DELETED";
    byId.set(c.id, {
      id: c.id,
      body: deleted ? "" : c.body,
      createdAt: c.createdAt.toISOString(),
      editedAt: c.editedAt?.toISOString() ?? null,
      authorName: deleted ? "" : c.author.name,
      likeCount: deleted ? 0 : c._count.reactions,
      likedByViewer: likedIds.has(c.id),
      isOwn: !deleted && c.userId === viewerId,
      // Decided here rather than in the client component: reading the
      // clock during a client render is impure and would disagree between
      // the server render and hydration.
      editable: !deleted && c.userId === viewerId && isCommentEditable(c.createdAt),
      deleted,
      replies: [],
    });
  }
  const roots: CommentNode[] = [];
  for (const c of comments) {
    const node = byId.get(c.id)!;
    if (c.parentId) byId.get(c.parentId)?.replies.push(node);
    else roots.push(node);
  }

  const tree = pruneTombstones(roots);
  const visibleCount = countVisible(tree);

  const signedIn = !!session?.user;
  const verified = session?.user?.emailConfirmed ?? false;

  return (
    <section className="mt-12">
      <h2 className="text-lg font-semibold">
        {visibleCount} {visibleCount === 1 ? "comment" : "comments"}
      </h2>

      <div className="mt-4">
        {!signedIn && (
          <p className="text-sm text-neutral-600">
            <Link href="/login" className="underline">Log in</Link> to join the discussion.
          </p>
        )}
        {signedIn && !verified && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Verify your email address to comment.
          </p>
        )}
        {signedIn && verified && <CommentForm articleId={articleId} />}
      </div>

      <CommentNoticeProvider>
        {tree.length > 0 && (
          <ul>
            {tree.map((c) => (
              <CommentThread
                key={c.id}
                comment={c}
                articleId={articleId}
                canReply={signedIn && verified}
              />
            ))}
          </ul>
        )}
      </CommentNoticeProvider>
    </section>
  );
}
