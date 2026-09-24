"use client";

import { useState } from "react";
import { changePassword } from "./actions";
import { useI18n } from "@/i18n/client";
import { PasswordInput } from "@/components/PasswordInput";

export function ChangePasswordForm({ required, next }: { required: boolean; next: string }) {
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
    const result = await changePassword({ current, next: password, confirm });
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
      <label className="field">
        <span className="label">{required ? t("password.temporary") : t("password.current")}</span>
        <PasswordInput
          name="current"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
          autoFocus
        />
      </label>
      <label className="field">
        <span className="label">{t("password.new")}</span>
        <PasswordInput
          name="next"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={12}
          maxLength={256}
        />
        <span className={`hint ${password && !strong ? "text-warn" : ""}`}>{t("password.hint")}</span>
      </label>
      <label className="field">
        <span className="label">{t("password.newAgain")}</span>
        <PasswordInput
          name="confirm"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
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
