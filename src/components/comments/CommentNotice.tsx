"use client";

import { createContext, useContext, useState } from "react";

const CommentNoticeContext = createContext<(message: string | null) => void>(() => {});

/** Lets a comment anywhere in the thread raise a notice, or clear it with null. */
export function useCommentNotice() {
  return useContext(CommentNoticeContext);
}

/**
 * Holds status messages for the whole thread, above the list itself.
 *
 * A comment can't own its own notice: editing one into something the spam
 * heuristics hold sends it back to PENDING, the revalidation drops it from
 * the rendered tree, and the component unmounts — taking any local message
 * with it. The reader would watch their comment silently disappear with no
 * explanation, which is exactly what the moderation flow is careful to
 * avoid everywhere else. Rendered here, the message outlives the comment.
 */
export function CommentNoticeProvider({ children }: { children: React.ReactNode }) {
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <CommentNoticeContext value={setNotice}>
      {notice && (
        <p role="status" className="alert alert-warn mt-4">
          {notice}
        </p>
      )}
      {children}
    </CommentNoticeContext>
  );
}
