import Link from "next/link";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth/config";
import { CommentForm } from "./CommentForm";
import { CommentThread, type CommentNode } from "./CommentThread";
import { CommentNoticeProvider } from "./CommentNotice";
import { isCommentEditable } from "@/lib/commentPolicy";
import { initials } from "@/lib/format";
import { getI18n } from "@/i18n/server";
import type { MessageKey } from "@/i18n/t";

export const COMMENT_SORTS = [
  { value: "oldest", label: "comments.sortOldest" },
  { value: "newest", label: "comments.sortNewest" },
  { value: "top", label: "comments.sortTop" },
] as const satisfies readonly { value: string; label: MessageKey }[];
export type CommentSort = (typeof COMMENT_SORTS)[number]["value"];

export function parseCommentSort(raw: string | string[] | undefined): CommentSort {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return COMMENT_SORTS.some((s) => s.value === value) ? (value as CommentSort) : "oldest";
}

/** How many top-level comments show before "Show all". */
const INITIAL_ROOTS = 20;

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
 * Sorting applies to top-level comments only. Replies always stay in the
 * order they were written: a conversation read out of order is not a
 * conversation.
 */
function sortRoots(roots: CommentNode[], sort: CommentSort): CommentNode[] {
  const byTime = (a: CommentNode, b: CommentNode) => a.createdAt.localeCompare(b.createdAt);
  if (sort === "newest") return [...roots].sort((a, b) => byTime(b, a));
  if (sort === "top") return [...roots].sort((a, b) => b.likeCount - a.likeCount || byTime(a, b));
  return roots;
}

/**
 * PENDING comments are waiting on a moderator and HIDDEN ones were taken
 * down by staff — neither is ever loaded here. DELETED ones are loaded
 * only so a removed comment can leave a tombstone above its replies; their
 * text is replaced before the node reaches the client, so a deleted body
 * is never sent to a browser.
 */
export async function CommentSection({
  articleId,
  articlePath,
  sort = "oldest",
  showAll = false,
}: {
  articleId: string;
  /** Where the sort links point back to, e.g. /article/slug. */
  articlePath: string;
  sort?: CommentSort;
  showAll?: boolean;
}) {
  const { t, n } = await getI18n();
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
      anonymous: true,
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
      // The public byline is withheld for an anonymous comment; the row
      // still knows its author, so "You", edit and delete keep working.
      authorName: deleted ? "" : c.anonymous ? t("comments.anonymous") : c.author.name,
      anonymous: c.anonymous,
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

  const tree = sortRoots(pruneTombstones(roots), sort);
  const visibleCount = countVisible(tree);
  const shown = showAll ? tree : tree.slice(0, INITIAL_ROOTS);
  const hidden = tree.length - shown.length;

  const signedIn = !!session?.user;
  const verified = session?.user?.emailConfirmed ?? false;

  const sortHref = (value: CommentSort) =>
    `${articlePath}${value === "oldest" ? "" : `?comments=${value}`}#comments`;

  return (
    <section id="comments" className="mt-14 scroll-mt-20 border-t border-line pt-8" aria-labelledby="comments-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="comments-heading" className="headline text-2xl">
          {n(visibleCount, "common.comments")}
        </h2>
        {tree.length > 1 && (
          <div className="flex gap-1" role="group" aria-label={t("comments.sortLabel")}>
            {COMMENT_SORTS.map((option) => (
              <Link
                key={option.value}
                href={sortHref(option.value)}
                aria-current={sort === option.value ? "true" : undefined}
                className={`btn btn-sm rounded-full ${sort === option.value ? "btn-primary" : "btn-ghost"}`}
              >
                {t(option.label)}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5">
        {!signedIn && (
          <div className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="text-sm text-ink-2">
              <Link href="/login" className="text-link font-medium">
                {t("common.login")}
              </Link>{" "}
              {t("comments.loginToJoin")}
            </p>
            <Link href="/register" className="btn btn-secondary btn-sm">
              {t("common.createAccount")}
            </Link>
          </div>
        )}
        {signedIn && !verified && (
          <p className="alert alert-warn">{t("comments.verifyToComment")}</p>
        )}
        {signedIn && verified && (
          <div className="flex gap-3">
            <span className="avatar mt-1 hidden h-9 w-9 text-xs sm:inline-flex">
              {initials(session?.user?.name ?? t("common.you"))}
            </span>
            <div className="min-w-0 flex-1">
              <CommentForm articleId={articleId} />
            </div>
          </div>
        )}
      </div>

      <CommentNoticeProvider>
        {shown.length > 0 && (
          <ul className="mt-2">
            {shown.map((c) => (
              <CommentThread
                key={c.id}
                comment={c}
                articleId={articleId}
                canReply={signedIn && verified}
              />
            ))}
          </ul>
        )}
        {hidden > 0 && (
          <p className="mt-6 text-center">
            <Link
              href={`${articlePath}?${sort === "oldest" ? "" : `comments=${sort}&`}all=1#comments`}
              className="btn btn-secondary"
            >
              {n(hidden, "comments.showMore")}
            </Link>
          </p>
        )}
      </CommentNoticeProvider>
    </section>
  );
}
