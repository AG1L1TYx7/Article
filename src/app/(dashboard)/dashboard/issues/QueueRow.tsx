"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  claimIssue,
  publishIssue,
  rejectIssue,
  releaseIssue,
  resolveIssue,
  verifyIssue,
} from "./actions";

export interface QueueIssue {
  id: string;
  reference: string;
  slug: string;
  title: string;
  status: string;
  anonymous: boolean;
  createdAt: Date;
  ward: number | null;
  reporter: { id: string; name: string; handle: string; email: string };
  district: { id: string; name: string; nameNe: string };
  province: { id: string; name: string };
  category: { name: string } | null;
  verifiedBy: { name: string } | null;
  _count: { media: number };
}

/**
 * One report in the queue, with the actions its current status allows.
 *
 * Publishing asks for confirmation. It is the only irreversible button on
 * the page — it puts an accusation in front of a whole district and sends
 * a notification that cannot be recalled — so it should not be one stray
 * click away from "verify".
 */
export function QueueRow({
  issue,
  canPublish,
  canResolve,
}: {
  issue: QueueIssue;
  canPublish: boolean;
  canResolve: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState<"reject" | "publish" | "resolve" | null>(null);
  const [pending, startTransition] = useTransition();

  function act(run: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await run();
      if (!result.ok) setError(result.error ?? "That did not work.");
      else setAsking(null);
    });
  }

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-ink-3">
            <code className="font-mono">{issue.reference}</code> · {issue.district.name} (
            {issue.province.name}){issue.ward ? ` · Ward ${issue.ward}` : ""}
            {issue.category ? ` · ${issue.category.name}` : ""}
            {issue._count.media > 0 ? ` · ${issue._count.media} file(s)` : ""}
          </p>
          <h3 className="mt-1 font-medium">
            <Link href={`/issues/${issue.slug}`} className="hover:text-link">
              {issue.title}
            </Link>
          </h3>
          <p className="mt-1 text-xs text-ink-2">
            {/* Shown because verifying means being able to go back and ask.
                Marked when the reporter asked not to be named publicly, so
                whoever is looking knows the name must not leave this page. */}
            {issue.anonymous && (
              <span className="mr-1 rounded bg-surface-2 px-1.5 py-0.5 text-ink-3">
                anonymous publicly
              </span>
            )}
            {issue.reporter.name} (@{issue.reporter.handle}) · {issue.reporter.email}
          </p>
          {issue.verifiedBy && (
            <p className="mt-1 text-xs text-ink-3">Being handled by {issue.verifiedBy.name}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {issue.status === "SUBMITTED" && (
            <button
              type="button"
              onClick={() => act(() => claimIssue(issue.id))}
              disabled={pending}
              className="btn btn-secondary btn-sm"
            >
              Take it on
            </button>
          )}

          {issue.status === "UNDER_REVIEW" && (
            <>
              <button
                type="button"
                onClick={() => act(() => verifyIssue(issue.id))}
                disabled={pending}
                className="btn btn-primary btn-sm"
              >
                Mark checked
              </button>
              <button
                type="button"
                onClick={() => act(() => releaseIssue(issue.id))}
                disabled={pending}
                className="btn btn-secondary btn-sm"
              >
                Put back
              </button>
            </>
          )}

          {issue.status === "VERIFIED" && canPublish && (
            <button
              type="button"
              onClick={() => setAsking("publish")}
              disabled={pending}
              className="btn btn-primary btn-sm"
            >
              Publish
            </button>
          )}

          {issue.status === "PUBLISHED" && canResolve && (
            <button
              type="button"
              onClick={() => setAsking("resolve")}
              disabled={pending}
              className="btn btn-secondary btn-sm"
            >
              Mark resolved
            </button>
          )}

          {issue.status !== "PUBLISHED" && issue.status !== "REJECTED" && (
            <button
              type="button"
              onClick={() => setAsking("reject")}
              disabled={pending}
              className="btn btn-secondary btn-sm"
            >
              Cannot verify
            </button>
          )}
        </div>
      </div>

      {asking === "publish" && (
        <div className="mt-4 rounded-md border border-accent/40 p-3">
          <p className="text-sm">
            Publishing tells <strong>everybody in {issue.district.name}</strong> and cannot be
            undone. Are you satisfied this has been checked?
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => act(() => publishIssue(issue.id))}
              disabled={pending}
              className="btn btn-primary btn-sm"
            >
              {pending ? "Publishing…" : "Yes, publish and alert the district"}
            </button>
            <button type="button" onClick={() => setAsking(null)} className="btn btn-secondary btn-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {(asking === "reject" || asking === "resolve") && (
        <div className="mt-4 rounded-md border border-rule p-3">
          <label className="field">
            <span className="label">
              {asking === "reject" ? "Why can it not be verified?" : "What changed?"}
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={2000}
              className="input"
              placeholder={
                asking === "reject"
                  ? "The reporter will see this. Be specific — it is how they know what would help."
                  : "Shown on the published report."
              }
            />
          </label>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() =>
                act(() =>
                  asking === "reject" ? rejectIssue(issue.id, note) : resolveIssue(issue.id, note)
                )
              }
              disabled={pending}
              className="btn btn-primary btn-sm"
            >
              {asking === "reject" ? "Send the reason" : "Mark resolved"}
            </button>
            <button type="button" onClick={() => setAsking(null)} className="btn btn-secondary btn-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
