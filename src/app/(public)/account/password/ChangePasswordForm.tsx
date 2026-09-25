"use client";

import { useState } from "react";
import { changePassword } from "./actions";
import { useI18n } from "@/i18n/client";

export function ChangePasswordForm({
  required,
  next,
  hasPassword,
}: {
  required: boolean;
  next: string;
  /** False for an account created through Google: there is none to confirm. */
  hasPassword: boolean;
}) {
  const { t } = useI18n();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await changePassword(
      hasPassword ? { current, next: password, confirm } : { next: password, confirm }
    );
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? t("password.couldntChange"));
      return;
    }
    // A full navigation: the session token is re-read on the next request
    // and proxy.ts will now let the person through.
    window.location.assign(next);
  }

  const strong = password.length >= 12;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {/* Nothing to confirm when the account has no password yet — an
          account created through Google. Being signed in is the whole of
          the proof there is, and the server agrees: see the branch in
          actions.ts. */}
      {hasPassword && (
      <label className="field">
        <span className="label">{required ? t("password.temporary") : t("password.current")}</span>
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
      )}
      <label className="field">
        <span className="label">{t("password.new")}</span>
        <input
          name="next"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus={!hasPassword}
          required
          minLength={12}
          maxLength={256}
          className="input"
        />
        <span className={`hint ${password && !strong ? "text-warn" : ""}`}>{t("password.hint")}</span>
      </label>
      <label className="field">
        <span className="label">{t("password.newAgain")}</span>
        <input
          name="confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          className="input"
        />
        {confirm && confirm !== password && <span className="hint text-warn">{t("password.mismatch")}</span>}
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
        {pending ? t("common.saving") : required ? t("password.setAndContinue") : t("password.change")}
      </button>
    </form>
  );
}
