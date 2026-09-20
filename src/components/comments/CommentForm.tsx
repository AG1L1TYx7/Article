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
        className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {notice && <p className="text-sm text-amber-700">{notice}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || body.trim().length < 2}
          className="w-fit rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Posting…" : parentId ? "Reply" : "Post comment"}
        </button>
        {onDone && (
          <button type="button" onClick={onDone} className="text-sm text-neutral-600 underline">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
