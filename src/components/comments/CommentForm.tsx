"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postComment } from "./actions";
import { useI18n } from "@/i18n/client";

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
  const { t, formatNumber } = useI18n();
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);

    const result = await postComment({ articleId, body, parentId, anonymous });
    setPending(false);

    if (!result.ok) {
      setError(result.error ?? t("comments.couldntPost"));
      return;
    }

    setBody("");
    if (result.status === "PENDING") {
      // Say so plainly rather than showing nothing and letting them
      // wonder whether it posted.
      setNotice(t("comments.postedPending"));
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
        placeholder={parentId ? t("comments.writeReply") : t("comments.joinDiscussion")}
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
      <label className="flex items-start gap-2.5 text-sm text-ink-2">
        <input
          type="checkbox"
          name="anonymous"
          checked={anonymous}
          onChange={(e) => setAnonymous(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
        />
        <span>
          <span className="font-medium text-ink">{t("comments.postAnonymously")}</span>
          <span className="mt-0.5 block text-xs text-ink-3">{t("comments.anonymousNote")}</span>
        </span>
      </label>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending || body.trim().length < 2}
          className="btn btn-primary"
        >
          {pending ? t("comments.posting") : parentId ? t("comments.reply") : t("comments.postComment")}
        </button>
        {onDone && (
          <button type="button" onClick={onDone} className="btn btn-ghost">
            {t("common.cancel")}
          </button>
        )}
        {remaining < 500 && (
          <span className="ml-auto text-xs text-ink-3 tabular-nums">
            {t("comments.charactersLeft", { count: formatNumber(remaining) })}
          </span>
        )}
      </div>
    </form>
  );
}
