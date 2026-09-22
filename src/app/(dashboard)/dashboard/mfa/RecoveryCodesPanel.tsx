"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { regenerateRecoveryCodes } from "./actions";
import { KeyIcon } from "@/components/icons";

/**
 * The one-time recovery codes, shown exactly once.
 *
 * Copy and download are offered because the codes cannot be shown again:
 * only their hashes are kept. The "I've saved them" step is deliberate —
 * refreshing straight away would hide them before anyone had read them.
 */
export function RecoveryCodesSheet({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");

  return (
    <div className="mt-5 rounded-md border border-warn/40 bg-warn-soft/40 p-4">
      <p className="flex items-center gap-2 font-medium">
        <KeyIcon size={16} /> Your recovery codes
      </p>
      <p className="mt-1 text-sm text-ink-2">
        If you lose your authenticator, any one of these lets you sign in once. Save them somewhere safe
        now — a password manager is ideal. They will not be shown again.
      </p>
      <ol className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm sm:grid-cols-3" data-recovery-codes>
        {codes.map((code) => (
          <li key={code} className="select-all">
            {code}
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              window.prompt("Copy these codes:", text);
            }
          }}
          className="btn btn-secondary btn-sm"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
        <a
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(`Recovery codes — each works once\n\n${text}\n`)}`}
          download="recovery-codes.txt"
          className="btn btn-secondary btn-sm"
        >
          Download
        </a>
        <button type="button" onClick={onDone} className="btn btn-primary btn-sm ml-auto">
          I&apos;ve saved them
        </button>
      </div>
    </div>
  );
}

/**
 * On the security pages once MFA is on: how many codes are left, and a
 * password-confirmed way to issue a fresh set (which voids the old ones).
 */
export function RecoveryCodesPanel({ remaining }: { remaining: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const password = String(new FormData(e.currentTarget).get("password"));
    const result = await regenerateRecoveryCodes(password);
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    setOpen(false);
    setCodes(result.recoveryCodes ?? []);
  }

  if (codes) {
    return (
      <RecoveryCodesSheet
        codes={codes}
        onDone={() => {
          setCodes(null);
          router.refresh();
        }}
      />
    );
  }

  const low = remaining <= 2;

  return (
    <div className="mt-5 border-t border-line pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium">
            <KeyIcon size={15} /> Recovery codes
          </p>
          <p className={`mt-0.5 text-sm ${low ? "text-warn" : "text-ink-2"}`} data-recovery-remaining={remaining}>
            {remaining === 0
              ? "None left. Generate a new set before you need one."
              : `${remaining} of 10 unused${low ? " — running low; generate a new set soon." : "."}`}
          </p>
        </div>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="btn btn-secondary btn-sm">
            Generate new codes
          </button>
        )}
      </div>

      {open && (
        <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3">
          <p className="text-sm text-ink-2">
            A new set replaces every existing code immediately. Confirm your password to continue.
          </p>
          <label className="field">
            <span className="label">Your password</span>
            <input name="password" type="password" autoComplete="current-password" required className="input sm:max-w-xs" />
          </label>
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className="btn btn-primary btn-sm">
              {pending ? "Generating…" : "Generate and show codes"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-sm">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
