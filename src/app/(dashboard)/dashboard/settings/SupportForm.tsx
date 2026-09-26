"use client";

import { useState, useTransition } from "react";
import { updateSupportSettings } from "./actions";
import type { SupportSettings } from "@/lib/supportSettings";

/**
 * Where contributors are told to send money.
 *
 * The switch at the top is last in the order somebody should use this
 * form: fill in the account, check it twice, then turn it on. So it says
 * so, rather than sitting at the top inviting a click before anything
 * below it is filled in.
 */
export function SupportSettingsForm({ initial }: { initial: SupportSettings }) {
  const [form, setForm] = useState<SupportSettings>(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof SupportSettings>(key: K, value: SupportSettings[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setMessage(null);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const result = await updateSupportSettings(form);
      setMessage(
        result.ok
          ? { ok: true, text: "Saved." }
          : { ok: false, text: result.error ?? "Could not save." }
      );
    });
  }

  return (
    <form onSubmit={onSubmit} className="card mt-6 p-6">
      <h2 className="text-lg font-medium">Membership and donations</h2>
      <p className="mt-1 text-sm text-ink-2">
        The account contributors are told to pay into. Nothing about giving appears anywhere on
        the site until this is switched on — and it cannot be switched on until there is somewhere
        to send money.
      </p>

      <p className="mt-4 rounded-md border border-rule bg-surface-2 p-3 text-xs text-ink-2">
        Whoever can edit this can redirect every donation. Changes are recorded in the audit log
        with the account number, so check it after anyone else edits it.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field
          label="Organisation name"
          value={form.organisationName}
          onChange={(v) => set("organisationName", v)}
          hint="As it appears on the account and on receipts."
        />
        <Field label="Bank" value={form.bankName} onChange={(v) => set("bankName", v)} />
        <Field
          label="Account name"
          value={form.accountName}
          onChange={(v) => set("accountName", v)}
        />
        <Field
          label="Account number"
          value={form.accountNumber}
          onChange={(v) => set("accountNumber", v)}
          hint="Check this character by character before saving."
        />
        <Field label="Branch" value={form.branch} onChange={(v) => set("branch", v)} />
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field
          label="Wallet (optional)"
          value={form.walletName}
          onChange={(v) => set("walletName", v)}
          hint="eSewa, Khalti, IME Pay…"
        />
        <Field
          label="Wallet ID"
          value={form.walletId}
          onChange={(v) => set("walletId", v)}
          hint="The number or ID people send to."
        />
      </div>

      <label className="field mt-5">
        <span className="label">Anything else contributors should know</span>
        <textarea
          value={form.instructions}
          onChange={(e) => set("instructions", e.target.value)}
          rows={3}
          maxLength={2000}
          className="input"
          placeholder="Shown verbatim beside the account details."
        />
      </label>

      <label className="mt-5 flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={form.showSupporters}
          onChange={(e) => set("showSupporters", e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
        />
        <span>
          <span className="font-medium">Show a public list of people who gave</span>
          <span className="mt-0.5 block text-xs text-ink-2">
            Names only, never amounts. Think about this one: a list of who funds this work is a
            list of people who can be leaned on, and in a small district that is not hypothetical.
            Anybody who ticked &ldquo;give without my name&rdquo; never appears either way.
          </span>
        </span>
      </label>

      <label className="mt-5 flex items-start gap-2.5 border-t border-line pt-5 text-sm">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => set("enabled", e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
        />
        <span>
          <span className="font-medium">Accept contributions</span>
          <span className="mt-0.5 block text-xs text-ink-2">
            Turn this on last, once the account details above are right. Before you do: collecting
            public donations in Nepal generally requires the organisation to be registered and
            affiliated with the Social Welfare Council, and money from abroad is regulated
            separately. This switch does not make any of that true.
          </span>
        </span>
      </label>

      {message && (
        <p
          className={`mt-4 text-sm ${message.ok ? "text-ink-2" : "text-danger"}`}
          role={message.ok ? "status" : "alert"}
        >
          {message.text}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn btn-primary mt-5 py-2.5">
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="input" />
      {hint && <span className="mt-1 text-xs text-ink-3">{hint}</span>}
    </label>
  );
}
