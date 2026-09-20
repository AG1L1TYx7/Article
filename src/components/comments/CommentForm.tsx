"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postComment } from "./actions";

export function CommentForm({
  articleId,
  parentId,
  onDone,
  autoFocus,
}: {
  articleId: string;
  parentId?: string;
  onDone?: () => void;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);

    const result = await postComment({ articleId, body, parentId });
    setPending(false);

    if (!result.ok) {
      setError(result.error ?? "Couldn't post that comment.");
      return;
    }

    setBody("");
    if (result.status === "PENDING") {
      // Say so plainly rather than showing nothing and letting them
      // wonder whether it posted.
      setNotice("Posted — a moderator will review it before it appears.");
    } else {
      onDone?.();
      router.refresh();
    }
  }

  const remaining = 5000 - body.length;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        required
        minLength={2}
        maxLength={5000}
        rows={parentId ? 2 : 3}
        autoFocus={autoFocus}
        placeholder={parentId ? "Write a reply…" : "Join the discussion…"}
        className="input resize-y leading-relaxed"
      />
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="alert alert-warn" role="status">
          {notice}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending || body.trim().length < 2}
          className="btn btn-primary"
        >
          {pending ? "Posting…" : parentId ? "Reply" : "Post comment"}
        </button>
        {onDone && (
          <button type="button" onClick={onDone} className="btn btn-ghost">
            Cancel
          </button>
        )}
        {remaining < 500 && (
          <span className="ml-auto text-xs text-ink-3 tabular-nums">{remaining} left</span>
        )}
      </div>
    </form>
  );
}
