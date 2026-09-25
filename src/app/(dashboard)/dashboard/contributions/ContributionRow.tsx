"use client";

import { useState, useTransition } from "react";
import { confirmAction, markNotReceivedAction, refundAction } from "./actions";

export interface ContributionView {
  id: string;
  reference: string;
  kind: string;
  status: string;
  /** Already formatted on the server — the client never divides money. */
  amount: string;
  donorName: string | null;
  donorEmail: string | null;
  anonymous: boolean;
  message: string | null;
  staffNote: string | null;
  providerRef: string | null;
  tierName: string | null;
  confirmedByName: string | null;
  createdAt: string;
  confirmedAt: string | null;
  periodEnd: string | null;
}

const STATUS_PILL: Record<string, string> = {
  PENDING: "pill-neutral",
  CONFIRMED: "pill-ok",
  FAILED: "pill-neutral",
  REFUNDED: "pill-danger",
};

/**
 * One contribution, with the actions its status allows.
 *
 * Confirming asks for the bank's own reference. It is optional in the
 * schema and asked for here anyway, because a row that cannot be tied back
 * to a line on a statement is a row nobody can reconcile — and
 * reconciliation is the entire job this page exists for.
 */
export function ContributionRow({
  contribution,
  canConfirm,
}: {
  contribution: ContributionView;
  canConfirm: boolean;
}) {
  const [open, setOpen] = useState<"confirm" | "fail" | "refund" | null>(null);
  const [providerRef, setProviderRef] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function act(run: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await run();
      if (!result.ok) setError(result.error ?? "That did not work.");
      else {
        setOpen(null);
        setNote("");
        setProviderRef("");
      }
    });
  }

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`pill ${STATUS_PILL[contribution.status] ?? "pill-neutral"}`}>
              {contribution.status.toLowerCase()}
            </span>
            <code className="font-mono text-ink-2">{contribution.reference}</code>
            <span className="text-ink-3">
              {contribution.kind === "MEMBERSHIP"
                ? `Membership${contribution.tierName ? ` · ${contribution.tierName}` : ""}`
                : "One-off"}
            </span>
          </p>

          <p className="mt-1 text-lg font-semibold tabular-nums">{contribution.amount}</p>

          <p className="mt-1 text-sm text-ink-2">
            {contribution.anonymous ? (
              <span className="text-ink-3">Given without a name</span>
            ) : (
              <>
                {contribution.donorName ?? "Name not given"}
                {contribution.donorEmail ? ` · ${contribution.donorEmail}` : ""}
              </>
            )}
          </p>

          {contribution.message && (
            <p className="mt-2 whitespace-pre-wrap rounded-md border border-rule p-2 text-sm text-ink-2">
              {contribution.message}
            </p>
          )}

          <p className="mt-2 text-xs text-ink-3">
            Pledged {new Date(contribution.createdAt).toLocaleDateString("en-GB")}
            {contribution.confirmedAt &&
              ` · confirmed ${new Date(contribution.confirmedAt).toLocaleDateString("en-GB")}`}
            {contribution.confirmedByName && ` by ${contribution.confirmedByName}`}
            {contribution.providerRef && ` · bank ref ${contribution.providerRef}`}
            {contribution.periodEnd &&
              ` · member until ${new Date(contribution.periodEnd).toLocaleDateString("en-GB")}`}
          </p>

          {contribution.staffNote && (
            <p className="mt-1 text-xs text-ink-3">Note: {contribution.staffNote}</p>
          )}
        </div>

        {canConfirm && (
          <div className="flex flex-wrap gap-2">
            {contribution.status === "PENDING" && (
              <>
                <button
                  type="button"
                  onClick={() => setOpen("confirm")}
                  className="btn btn-primary btn-sm"
                >
                  Money arrived
                </button>
                <button
                  type="button"
                  onClick={() => setOpen("fail")}
                  className="btn btn-secondary btn-sm"
                >
                  Never arrived
                </button>
              </>
            )}
            {contribution.status === "CONFIRMED" && (
              <button
                type="button"
                onClick={() => setOpen("refund")}
                className="btn btn-secondary btn-sm"
              >
                Record a refund
              </button>
            )}
          </div>
        )}
      </div>

      {open && (
        <div className="mt-4 rounded-md border border-rule p-3">
          {open === "confirm" && (
            <label className="field">
              <span className="label">Bank reference</span>
              <input
                value={providerRef}
                onChange={(e) => setProviderRef(e.target.value)}
                placeholder="The reference on the statement line"
                className="input"
              />
              <span className="mt-1 text-xs text-ink-3">
                So this row can be tied back to the statement later.
              </span>
            </label>
          )}

          <label className="field mt-3">
            <span className="label">
              {open === "refund" ? "Why was it refunded?" : "Note (optional)"}
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={2000}
              className="input"
            />
          </label>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                act(() =>
                  open === "confirm"
                    ? confirmAction(contribution.id, providerRef, note)
                    : open === "fail"
                      ? markNotReceivedAction(contribution.id, note)
                      : refundAction(contribution.id, note)
                )
              }
              className="btn btn-primary btn-sm"
            >
              {pending
                ? "Saving…"
                : open === "confirm"
                  ? "Confirm it arrived"
                  : open === "fail"
                    ? "Mark not received"
                    : "Record the refund"}
            </button>
            <button type="button" onClick={() => setOpen(null)} className="btn btn-secondary btn-sm">
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
