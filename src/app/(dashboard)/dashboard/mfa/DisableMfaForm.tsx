"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { disableMfa } from "./actions";

export function DisableMfaForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const password = String(new FormData(e.currentTarget).get("password"));
    const result = await disableMfa(password);
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label className="field">
        <span className="label">Confirm your password to disable MFA</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="input sm:max-w-xs"
        />
      </label>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn btn-danger w-fit">
        {pending ? "Disabling…" : "Disable MFA"}
      </button>
    </form>
  );
}
