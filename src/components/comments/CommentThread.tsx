"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CommentForm } from "./CommentForm";
import { deleteOwnComment, editComment, reportComment } from "./actions";
import { useCommentNotice } from "./CommentNotice";
import { ToggleButton } from "@/components/engagement/ToggleButton";
import { toggleCommentLike } from "@/components/engagement/actions";

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
  const [replying, setReplying] = useState(false);
  const [reported, setReported] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Notices live above the thread, not here: an edit that trips
  // moderation unmounts this very component. See CommentNotice.tsx.
  const setNotice = useCommentNotice();

  const indent = depth > 0
    ? "mt-4 border-l border-neutral-200 pl-4"
    : "mt-6 border-t border-neutral-200 pt-6";

  const replies =
    comment.replies.length > 0 ? (
      <ul>
        {comment.replies.map((reply) => (
          <CommentThread
            key={reply.id}
            comment={reply}
            articleId={articleId}
            canReply={canReply}
            depth={depth + 1}
          />
        ))}
      </ul>
    ) : null;

  if (comment.deleted) {
    return (
      <li id={`comment-${comment.id}`} className={indent}>
        <p className="text-sm text-neutral-500 italic">This comment was deleted by its author.</p>
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
      setError(result.error ?? "Couldn't save that edit.");
      return;
    }

    setEditing(false);
    if (result.status === "PENDING") {
      // An edit can send an already-public comment back to the queue, at
      // which point this comment is dropped from the rendered thread. Say
      // so rather than letting it vanish without explanation.
      setNotice("Edited — a moderator will review it before it reappears.");
    }
    router.refresh();
  }

  async function remove() {
    setPending(true);
    setError(null);
    const result = await deleteOwnComment(comment.id);
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Couldn't delete that comment.");
      return;
    }
    router.refresh();
  }

  return (
    <li id={`comment-${comment.id}`} className={indent}>
      <p className="text-sm font-medium text-neutral-800">{comment.authorName}</p>
      <p className="text-xs text-neutral-500">
        {new Date(comment.createdAt).toLocaleDateString()}
        {comment.editedAt && " · edited"}
      </p>

      {editing ? (
        <form onSubmit={saveEdit} className="mt-2 flex flex-col gap-2">
          <label htmlFor={`edit-${comment.id}`} className="sr-only">
            Edit your comment
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
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending || draft.trim().length < 2}
              className="w-fit rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(comment.body);
                setEditing(false);
                setError(null);
              }}
              className="text-sm text-neutral-600 underline"
            >
              Cancel
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
          className="mt-2 text-sm whitespace-pre-wrap text-neutral-800"
        >
          {comment.body}
        </p>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-2">
        <ToggleButton
          initialActive={comment.likedByViewer}
          initialCount={comment.likeCount}
          activeLabel="Liked"
          inactiveLabel="Like"
          action={() => toggleCommentLike(comment.id)}
          disabled={!canReply}
          disabledTitle="Log in to like comments"
        />
      </div>

      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        {canReply && (
          <button onClick={() => setReplying((v) => !v)} className="text-neutral-600 underline">
            {replying ? "Cancel" : "Reply"}
          </button>
        )}
        {canManage && comment.editable && !editing && (
          <button onClick={() => setEditing(true)} className="text-neutral-600 underline">
            Edit
          </button>
        )}
        {canManage && (
          <button
            onClick={remove}
            disabled={pending}
            className="text-neutral-600 underline disabled:opacity-50"
          >
            Delete
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
            className="text-neutral-500 underline disabled:no-underline"
          >
            {reported ? "Reported — thank you" : "Report"}
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

      {replies}
    </li>
  );
}
