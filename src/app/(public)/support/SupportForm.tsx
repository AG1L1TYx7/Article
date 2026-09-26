"use client";

import { useState, useTransition } from "react";
import { pledgeAction } from "./actions";

interface Tier {
  id: string;
  name: string;
  description: string | null;
  amount: string;
  intervalMonths: number;
}

interface BankDetails {
  bankName: string;
  accountName: string;
  accountNumber: string;
  branch: string;
  walletName: string;
  walletId: string;
  instructions: string;
}

/**
 * Pledging, then paying.
 *
 * Two steps on purpose. The form records what somebody intends to give and
 * returns a reference; only then are the bank details shown, with that
 * reference beside them. Showing the details first would mean a treasurer
 * facing a statement of unattributed deposits, and a contributor with no
 * way to prove theirs arrived.
 *
 * The reference is the whole mechanism, so it is the largest thing on the
 * screen once it exists.
 */
export function SupportForm({
  tiers,
  settings,
  signedInName,
  signedInEmail,
}: {
  tiers: Tier[];
  settings: BankDetails;
  signedInName: string;
  signedInEmail: string;
}) {
  const [kind, setKind] = useState<"ONE_OFF" | "MEMBERSHIP">(tiers.length ? "MEMBERSHIP" : "ONE_OFF");
  const [tierId, setTierId] = useState(tiers[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await pledgeAction({
        kind,
        tierId: kind === "MEMBERSHIP" ? tierId : undefined,
        amount,
        donorName: String(form.get("donorName") ?? ""),
        donorEmail: String(form.get("donorEmail") ?? ""),
        anonymous,
        message: String(form.get("message") ?? ""),
      });
      if (!result.ok) {
        setError(result.error ?? "That did not work.");
        return;
      }
      setReference(result.reference!);
    });
  }

  if (reference) {
    return (
      <div className="card mt-8 p-6">
        <h2 className="text-lg font-medium">Now send the money</h2>
        <p className="mt-2 text-sm text-ink-2">
          Quote this reference on the transfer. It is how we match your payment to you — without
          it, a deposit is just an unnamed line on a bank statement.
        </p>

        <p className="mt-5 rounded-md border border-accent/40 bg-surface-2 p-4 text-center">
          <span className="block text-xs uppercase tracking-wide text-ink-3">Your reference</span>
          <code className="mt-1 block font-mono text-2xl font-semibold">{reference}</code>
        </p>

        <dl className="mt-6 grid gap-3 text-sm">
          {settings.bankName && (
            <>
              <Row label="Bank" value={settings.bankName} />
              <Row label="Account name" value={settings.accountName} />
              <Row label="Account number" value={settings.accountNumber} />
              {settings.branch && <Row label="Branch" value={settings.branch} />}
            </>
          )}
          {settings.walletId && (
            <Row label={settings.walletName || "Wallet"} value={settings.walletId} />
          )}
        </dl>

        {settings.instructions && (
          <p className="mt-5 whitespace-pre-wrap rounded-md border border-rule p-4 text-sm text-ink-2">
            {settings.instructions}
          </p>
        )}

        <p className="mt-5 text-xs text-ink-3">
          Somebody checks the account by hand, so it may be a day or two before this shows as
          received. Keep the reference — you can ask us about it any time.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-5">
      {tiers.length > 0 && (
        <fieldset>
          <legend className="label">What kind of contribution</legend>
          <div className="mt-2 flex gap-2">
            <Choice checked={kind === "MEMBERSHIP"} onClick={() => setKind("MEMBERSHIP")}>
              Membership
            </Choice>
            <Choice checked={kind === "ONE_OFF"} onClick={() => setKind("ONE_OFF")}>
              One-off
            </Choice>
          </div>
        </fieldset>
      )}

      {kind === "MEMBERSHIP" ? (
        <fieldset>
          <legend className="label">Choose a membership</legend>
          <div className="mt-2 grid gap-2">
            {tiers.map((t) => (
              <label
                key={t.id}
                className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm ${
                  tierId === t.id ? "border-accent" : "border-rule"
                }`}
              >
                <input
                  type="radio"
                  name="tier"
                  checked={tierId === t.id}
                  onChange={() => setTierId(t.id)}
                  className="mt-0.5 accent-[var(--accent)]"
                />
                <span>
                  <span className="font-medium">
                    {t.name} — {t.amount}
                    <span className="font-normal text-ink-3">
                      {t.intervalMonths === 12 ? " a year" : ` every ${t.intervalMonths} months`}
                    </span>
                  </span>
                  {t.description && (
                    <span className="mt-0.5 block text-xs text-ink-2">{t.description}</span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <label className="field">
          <span className="label">How much</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="500"
            className="input"
          />
          <span className="mt-1 text-xs text-ink-3">In rupees. Anything from Rs 10.</span>
        </label>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="field">
          <span className="label">Your name</span>
          <input
            name="donorName"
            defaultValue={signedInName}
            maxLength={120}
            disabled={anonymous}
            className="input"
          />
        </label>
        <label className="field">
          <span className="label">Email (for a receipt)</span>
          <input
            name="donorEmail"
            type="email"
            defaultValue={signedInEmail}
            maxLength={254}
            className="input"
          />
        </label>
      </div>

      <label className="flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={anonymous}
          onChange={(e) => setAnonymous(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
        />
        <span>
          <span className="font-medium">Give without my name</span>
          <span className="mt-0.5 block text-xs text-ink-2">
            No name is stored at all — not hidden, not stored. Only the people who keep the books
            will see the payment itself, in the bank.
          </span>
        </span>
      </label>

      <label className="field">
        <span className="label">Anything you want to say (optional)</span>
        <textarea name="message" rows={3} maxLength={1000} className="input" />
      </label>

      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn btn-primary w-full py-2.5">
        {pending ? "Just a moment…" : "Continue"}
      </button>
      <p className="text-center text-xs text-ink-3">
        Nothing is taken from you here. The next screen tells you where to send it.
      </p>
    </form>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line pb-2">
      <dt className="text-ink-2">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function Choice({
  checked,
  onClick,
  children,
}: {
  checked: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`btn btn-sm ${checked ? "btn-primary" : "btn-secondary"}`}
    >
      {children}
    </button>
  );
}
