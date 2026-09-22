"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { beginMfaSetup, confirmMfaSetup } from "./actions";
import { RecoveryCodesSheet } from "./RecoveryCodesPanel";

export function EnrollMfaFlow() {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<{ qrCodeDataUrl: string; manualEntryKey: string } | null>(
    null
  );
  // Shown once, after the code is confirmed, before the page refreshes
  // into its "enabled" state. Nothing can show them again.
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function start() {
    setPending(true);
    setError(null);
    try {
      setEnrollment(await beginMfaSetup());
    } catch {
      // Without this, a failed action rejects the promise and the button
      // sits on "Generating…" forever with nothing explaining why.
      setError("Couldn't start enrollment. Reload the page and try again.");
    } finally {
      setPending(false);
    }
  }

  async function onConfirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const code = String(new FormData(e.currentTarget).get("code"));
    const result = await confirmMfaSetup(code);
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    setRecoveryCodes(result.recoveryCodes ?? []);
  }

  if (recoveryCodes) {
    return (
      <div>
        <p className="alert alert-ok" role="status">
          MFA is enabled on this account.
        </p>
        <RecoveryCodesSheet codes={recoveryCodes} onDone={() => router.refresh()} />
      </div>
    );
  }

  if (!enrollment) {
    return (
      <div>
        <ol className="flex flex-col gap-2 text-sm text-ink-2">
          <li className="flex gap-3">
            <span className="avatar h-6 w-6 text-[11px]">1</span>
            Install an authenticator app — Google Authenticator, 1Password, Authy or similar.
          </li>
          <li className="flex gap-3">
            <span className="avatar h-6 w-6 text-[11px]">2</span>
            Scan the QR code this page shows you.
          </li>
          <li className="flex gap-3">
            <span className="avatar h-6 w-6 text-[11px]">3</span>
            Enter the six-digit code the app shows to confirm, then save the recovery codes you are given.
          </li>
        </ol>
        {error && (
          <p className="mt-4 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <button onClick={start} disabled={pending} className="btn btn-primary mt-6">
          {pending ? "Generating…" : "Set up authenticator app"}
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-6 sm:grid-cols-[auto_1fr] sm:items-start">
      <div className="flex flex-col items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- locally generated data: URI, not a remote image */}
        <img
          src={enrollment.qrCodeDataUrl}
          alt="MFA enrollment QR code"
          width={200}
          height={200}
          className="rounded-md border border-line bg-white p-2"
        />
        <p className="text-center text-xs text-ink-3">Can&apos;t scan? Enter this key by hand:</p>
        <p className="font-mono text-xs break-all text-ink-2 select-all">{enrollment.manualEntryKey}</p>
      </div>

      <form onSubmit={onConfirm} className="flex flex-col gap-3">
        <p className="text-sm text-ink-2">
          Scan this with your authenticator app, then enter the code it shows to confirm.
        </p>
        <label className="field">
          <span className="label">Enter the 6-digit code to confirm</span>
          <input
            name="code"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            autoComplete="one-time-code"
            required
            className="input py-3 text-center font-mono text-2xl tracking-[0.5em]"
          />
        </label>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? "Confirming…" : "Confirm and enable"}
        </button>
      </form>
    </div>
  );
}
