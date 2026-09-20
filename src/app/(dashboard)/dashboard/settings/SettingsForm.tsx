"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateSettings } from "./actions";
import type { CommentModerationMode, SiteSettings } from "@/lib/settings";

const MODES: { value: CommentModerationMode; label: string; blurb: string; badge?: string }[] = [
  {
    value: "trusted",
    label: "Post immediately",
    blurb:
      "Every reader's comment goes live at once. Only text the spam checks flag (link-stuffing, repeated posts) waits for review. Readers can report anything, and reports land in the moderation queue.",
    badge: "least work",
  },
  {
    value: "new_accounts",
    label: "Review new accounts only",
    blurb:
      "An account's first few comments wait for a moderator. Once that many have been approved, the account is trusted and posts live. The usual choice for a newsroom.",
    badge: "balanced",
  },
  {
    value: "all",
    label: "Review everything",
    blurb: "Every comment from every reader waits for a moderator before it appears. Safest, and the most work.",
  },
];

export function SettingsForm({ initial }: { initial: SiteSettings }) {
  const router = useRouter();
  const [mode, setMode] = useState<CommentModerationMode>(initial.commentModeration);
  const [trustedAfter, setTrustedAfter] = useState(initial.trustedAfterApprovedComments);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = mode !== initial.commentModeration || trustedAfter !== initial.trustedAfterApprovedComments;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);
    const result = await updateSettings({ commentModeration: mode, trustedAfterApprovedComments: trustedAfter });
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Couldn't save the settings.");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <section className="card p-5" aria-labelledby="moderation-heading">
        <h2 id="moderation-heading" className="text-lg font-medium">
          Comment moderation
        </h2>
        <p className="mt-1 text-sm text-ink-2">
          Who has to wait for a moderator before their comment appears. Staff never wait, whatever is chosen here.
        </p>

        <fieldset className="mt-4">
          <legend className="sr-only">Moderation mode</legend>
          <div className="grid gap-2">
            {MODES.map((m) => (
              <label
                key={m.value}
                className={`flex cursor-pointer items-start gap-3 rounded-md border px-4 py-3 transition-colors ${
                  mode === m.value ? "border-ink bg-surface-2" : "border-line hover:border-line-strong"
                }`}
              >
                <input
                  type="radio"
                  name="commentModeration"
                  value={m.value}
                  checked={mode === m.value}
                  onChange={() => setMode(m.value)}
                  className="mt-1 accent-[var(--accent)]"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {m.label}
                    {m.badge && <span className="pill pill-neutral">{m.badge}</span>}
                  </span>
                  <span className="mt-0.5 block text-sm text-ink-2">{m.blurb}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {mode === "new_accounts" && (
          <div className="field mt-4 border-t border-line pt-4">
            <label htmlFor="trusted-after" className="label">
              Approved comments before an account is trusted
            </label>
            <div className="flex items-center gap-3">
              <input
                id="trusted-after"
                type="number"
                min={1}
                max={20}
                value={trustedAfter}
                onChange={(e) => setTrustedAfter(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                className="input w-24"
              />
              <span className="text-sm text-ink-2">
                A reader&apos;s first {trustedAfter} comment{trustedAfter === 1 ? "" : "s"} wait for review; after that they
                post live.
              </span>
            </div>
          </div>
        )}
      </section>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending || !dirty} className="btn btn-primary">
          {pending ? "Saving…" : "Save settings"}
        </button>
        {saved && !dirty && (
          <span className="text-sm text-ok" role="status">
            Saved. Takes effect within a minute.
          </span>
        )}
        {error && (
          <span className="text-sm text-danger" role="alert">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
