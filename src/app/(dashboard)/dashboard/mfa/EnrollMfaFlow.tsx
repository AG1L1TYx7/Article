"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { beginMfaSetup, confirmMfaSetup } from "./actions";

export function EnrollMfaFlow() {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<{ qrCodeDataUrl: string; manualEntryKey: string } | null>(
    null
  );
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
    router.refresh();
  }

  if (!enrollment) {
    return (
      <button
        onClick={start}
        disabled={pending}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Generating…" : "Set up authenticator app"}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-neutral-600">
        Scan this with your authenticator app (Google Authenticator, 1Password, Authy, …), or enter
        the key manually.
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element -- locally generated data: URI, not a remote image */}
      <img src={enrollment.qrCodeDataUrl} alt="MFA enrollment QR code" width={200} height={200} />
      <p className="font-mono text-xs break-all text-neutral-500">{enrollment.manualEntryKey}</p>

      <form onSubmit={onConfirm} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-neutral-700">Enter the 6-digit code to confirm</span>
          <input
            name="code"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            autoComplete="one-time-code"
            required
            className="rounded-md border border-neutral-300 px-3 py-2 text-center text-lg tracking-[0.4em] outline-none focus:border-neutral-500"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Confirming…" : "Confirm and enable"}
        </button>
      </form>
    </div>
  );
}
