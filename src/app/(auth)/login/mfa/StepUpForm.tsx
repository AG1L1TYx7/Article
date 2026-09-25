"use client";

import { useState } from "react";
import Link from "next/link";
import { getSession, signIn } from "next-auth/react";
import { rememberThisDevice } from "../actions";
import { AuthCard } from "@/components/AuthCard";
import { useI18n } from "@/i18n/client";

/**
 * Entering the code that finishes a Google sign-in.
 *
 * Submits to the "mfa-continue" provider rather than to a server action of
 * its own, because only a provider can mint a session — and a session is
 * exactly what this step is withholding until the code is right.
 *
 * Deliberately the same wording and the same "remember this device"
 * behaviour as the password path's code step, so that whichever way
 * somebody signs in, the second factor is one familiar screen.
 */
export function StepUpForm({ token, byEmail }: { token: string; byEmail: boolean }) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // On by default, matching the password path: anybody reaching this
  // screen has just proved the second factor, and the label says plainly
  // what it means on a shared machine.
  const [rememberDevice, setRememberDevice] = useState(true);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const totp = new FormData(e.currentTarget).get("totp")?.toString() ?? "";
    const result = await signIn("mfa-continue", { token, totp, redirect: false });
    setPending(false);

    if (result?.error) {
      // One message for a wrong code and for an expired token alike. The
      // difference is not useful to the person and telling them which is
      // which tells an attacker whether the token is still live.
      setError(t("auth.incorrectCode"));
      return;
    }

    if (rememberDevice) {
      await rememberThisDevice().catch(() => {});
    }

    const session = await getSession();
    const role = session?.user?.role;
    const destination = role === "ADMIN" || role === "MODERATOR" ? "/dashboard" : "/";

    // A full navigation, not router.push(), for the same two reasons as
    // the password path in ../LoginForm.tsx: the client Router Cache still
    // holds pages rendered for a signed-out visitor, and the RSC request a
    // soft push makes can race the session cookie this sign-in just set.
    window.location.assign(destination);
  }

  return (
    <AuthCard
      title={t("auth.enterCode")}
      intro={byEmail ? t("auth.enterCodeEmailIntro") : t("auth.enterCodeIntro")}
      footer={
        <Link href="/login" className="text-link font-medium">
          {t("auth.useDifferentAccount")}
        </Link>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="field">
          <span className="label">{t("auth.sixDigitCode")}</span>
          <input
            name="totp"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
            className="input tracking-[0.3em]"
          />
        </label>
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={rememberDevice}
            onChange={(e) => setRememberDevice(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
          />
          <span className="text-ink-2">
            {t("auth.rememberDevice")}
            <span className="mt-0.5 block text-xs text-ink-3">{t("auth.rememberDeviceNote")}</span>
          </span>
        </label>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending} className="btn btn-primary mt-1 w-full py-2.5">
          {pending ? t("auth.verifying") : t("auth.verify")}
        </button>
      </form>
    </AuthCard>
  );
}
