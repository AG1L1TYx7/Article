"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CommentForm } from "./CommentForm";
import { deleteOwnComment, editComment, reportComment } from "./actions";
import { useCommentNotice } from "./CommentNotice";
import { ToggleButton } from "@/components/engagement/ToggleButton";
import { toggleCommentLike } from "@/components/engagement/actions";
import { HeartIcon } from "@/components/icons";
import { initials } from "@/lib/format";
import { useI18n } from "@/i18n/client";

/** Replies shown under a comment before the rest fold behind a button. */
const REPLIES_SHOWN = 3;

export interface CommentNode {
  id: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  authorName: string;
  likeCount: number;
  likedByViewer: boolean;
  /** True for the viewer's own comments — gates the edit and delete controls. */
  isOwn: boolean;
  /**
   * Whether the edit window is still open, decided on the server at
   * request time. Not computed here: Date.now() during render is impure
   * and would differ between the server render and hydration. The server
   * action re-checks it anyway, so a stale true only ever costs a clear
   * error message.
   */
  editable: boolean;
  /**
   * A comment the author removed that still has replies hanging off it.
   * Kept as a tombstone so deleting your own comment can't take other
   * people's replies down with it. `body` is empty for these — the text
   * never leaves the server.
   */
  deleted: boolean;
  replies: CommentNode[];
}

export function CommentThread({
  comment,
  articleId,
  canReply,
  depth = 0,
}: {
  comment: CommentNode;
  articleId: string;
  canReply: boolean;
  depth?: number;
}) {
  const router = useRouter();
  const { t, n, formatDate } = useI18n();
  const [replying, setReplying] = useState(false);
  const [reported, setReported] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAllReplies, setShowAllReplies] = useState(false);
  // Notices live above the thread, not here: an edit that trips
  // moderation unmounts this very component. See CommentNotice.tsx.
  const setNotice = useCommentNotice();

  const indent = depth > 0
    ? "mt-5 border-l-2 border-line pl-4 sm:pl-5"
    : "mt-6 border-t border-line pt-6";

  // Long reply chains fold after a few so a busy thread stays scannable;
  // the fold remembers nothing across reloads on purpose — a permalink
  // to a hidden reply still works because the browser scrolls to the id
  // only once the reader has opened the chain it is in.
  const visibleReplies = showAllReplies ? comment.replies : comment.replies.slice(0, REPLIES_SHOWN);
  const foldedReplies = comment.replies.length - visibleReplies.length;

  const replies =
    comment.replies.length > 0 ? (
      <>
        <ul>
          {visibleReplies.map((reply) => (
            <CommentThread
              key={reply.id}
              comment={reply}
              articleId={articleId}
              canReply={canReply}
              depth={depth + 1}
            />
          ))}
        </ul>
        {foldedReplies > 0 && (
          <button
            type="button"
            onClick={() => setShowAllReplies(true)}
            className="btn btn-ghost btn-sm mt-3 ml-4 gap-1 text-ink-2 sm:ml-5"
          >
            {n(foldedReplies, "comments.showMoreReplies")}
          </button>
        )}
      </>
    ) : null;

  if (comment.deleted) {
    return (
      <li id={`comment-${comment.id}`} className={indent}>
        <p className="text-sm text-ink-3 italic">{t("comments.deletedByAuthor")}</p>
        {replies}
      </li>
    );
  }

  const canManage = comment.isOwn && canReply;

  async function saveEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);

    const result = await editComment({ commentId: comment.id, body: draft });
    setPending(false);

    if (!result.ok) {
      setError(result.error ?? t("comments.couldntSave"));
      return;
    }

    setEditing(false);
    if (result.status === "PENDING") {
      // An edit can send an already-public comment back to the queue, at
      // which point this comment is dropped from the rendered thread. Say
      // so rather than letting it vanish without explanation.
      setNotice(t("comments.editedPending"));
    }
    router.refresh();
  }

  async function remove() {
    setPending(true);
    setError(null);
    const result = await deleteOwnComment(comment.id);
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? t("comments.couldntDelete"));
      return;
    }
    router.refresh();
  }

  return (
    <li id={`comment-${comment.id}`} className={`${indent} scroll-mt-24 target:rounded-md target:bg-warn-soft/40`}>
      <div className="flex gap-3">
        <span className="avatar h-8 w-8 text-[11px]">{initials(comment.authorName)}</span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-medium text-ink">{comment.authorName}</span>
            {comment.isOwn && <span className="pill pill-neutral">{t("common.you")}</span>}
            <span className="text-xs text-ink-3">
              <time dateTime={comment.createdAt}>{formatDate(comment.createdAt)}</time>
              {comment.editedAt && ` · ${t("comments.edited")}`}
            </span>
          </p>

          {editing ? (
            <form onSubmit={saveEdit} className="mt-2 flex flex-col gap-2">
              <label htmlFor={`edit-${comment.id}`} className="sr-only">
                {t("comments.editYourComment")}
              </label>
              <textarea
                id={`edit-${comment.id}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                required
                minLength={2}
                maxLength={5000}
                rows={3}
                autoFocus
                className="input resize-y leading-relaxed"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={pending || draft.trim().length < 2}
                  className="btn btn-primary btn-sm"
                >
                  {pending ? t("common.saving") : t("comments.saveChanges")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(comment.body);
                    setEditing(false);
                    setError(null);
                  }}
                  className="btn btn-ghost btn-sm"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </form>
          ) : (
            /* Rendered as text, never HTML — comments are plain text by design.
               data-comment-body marks this as the rendered text of one comment:
               a stable hook that cannot match the compose box (whose value
               Playwright also counts as text) or an ancestor comment in a
               nested thread. */
            <p
              data-comment-body
              className="mt-1.5 text-[15px] leading-relaxed whitespace-pre-wrap text-ink"
            >
              {comment.body}
            </p>
          )}

          {error && (
            <p className="mt-2 text-sm text-danger" role="alert">
              {error}
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-1">
            <ToggleButton
              initialActive={comment.likedByViewer}
              initialCount={comment.likeCount}
              activeLabel={t("engagement.liked")}
              inactiveLabel={t("engagement.like")}
              icon={<HeartIcon size={14} />}
              size="sm"
              action={() => toggleCommentLike(comment.id)}
              disabled={!canReply}
              disabledTitle={t("engagement.loginToLikeComments")}
            />
            {canReply && (
              <button onClick={() => setReplying((v) => !v)} className="btn btn-ghost btn-sm">
                {replying ? t("common.cancel") : t("comments.reply")}
              </button>
            )}
            {canManage && comment.editable && !editing && (
              <button onClick={() => setEditing(true)} className="btn btn-ghost btn-sm">
                {t("common.edit")}
              </button>
            )}
            {canManage && (
              <button onClick={remove} disabled={pending} className="btn btn-ghost btn-sm">
                {t("common.delete")}
              </button>
            )}
            {/* You can't report yourself, and offering it makes no sense. */}
            {canReply && !comment.isOwn && (
              <button
                disabled={reported}
                onClick={async () => {
                  await reportComment({ commentId: comment.id, reason: "ABUSE" });
                  setReported(true);
                }}
                className="btn btn-ghost btn-sm text-ink-3 disabled:opacity-100"
              >
                {reported ? t("comments.reported") : t("comments.report")}
              </button>
            )}
          </div>

          {replying && (
            <div className="mt-3">
              <CommentForm
                articleId={articleId}
                parentId={comment.id}
                autoFocus
                onDone={() => setReplying(false)}
              />
            </div>
          )}
        </div>
      </div>

      {replies}
    </li>
  );
}
