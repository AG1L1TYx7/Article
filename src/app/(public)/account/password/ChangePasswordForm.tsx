"use client";

import { useState } from "react";
import { changePassword } from "./actions";

export function ChangePasswordForm({ required, next }: { required: boolean; next: string }) {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await changePassword({ current, next: password, confirm });
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Couldn't change the password.");
      return;
    }
    // A full navigation: the session token is re-read on the next request
    // and proxy.ts will now let the person through.
    window.location.assign(next);
  }

  const strong = password.length >= 12;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <label className="field">
        <span className="label">{required ? "Temporary password" : "Current password"}</span>
        <input
          name="current"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
          autoFocus
          className="input"
        />
      </label>
      <label className="field">
        <span className="label">New password</span>
        <input
          name="next"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={12}
          maxLength={256}
          className="input"
        />
        <span className={`hint ${password && !strong ? "text-warn" : ""}`}>
          At least 12 characters. Length beats symbols — a short phrase you will remember is ideal.
        </span>
      </label>
      <label className="field">
        <span className="label">New password again</span>
        <input
          name="confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          className="input"
        />
        {confirm && confirm !== password && <span className="hint text-warn">These don&apos;t match yet.</span>}
      </label>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || !strong || confirm !== password || !current}
        className="btn btn-primary mt-1 w-full py-2.5"
      >
        {pending ? "Saving…" : required ? "Set my password and continue" : "Change password"}
      </button>
    </form>
  );
}
