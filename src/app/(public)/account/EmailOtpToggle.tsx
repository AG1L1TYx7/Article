"use client";

import { useState, useTransition } from "react";
import { disableEmailOtp, enableEmailOtp } from "./emailOtpActions";
import { useI18n } from "@/i18n/client";

/**
 * "Email me a code when I sign in" — the second factor for people who will
 * not install an authenticator app.
 *
 * Shown only to accounts that may use it. An administrator sees the reason
 * instead of the switch, because a control that always refuses is worse
 * than no control at all.
 */
export function EmailOtpToggle({
  enabled,
  isAdmin,
  emailVerified,
}: {
  enabled: boolean;
  isAdmin: boolean;
  emailVerified: boolean;
}) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (isAdmin) {
    return <p className="mt-3 text-sm text-ink-2">{t("auth.adminMustUseApp")}</p>;
  }

  function toggle() {
    setError(null);
    startTransition(async () => {
      const result = enabled ? await disableEmailOtp() : await enableEmailOtp();
      if (!result.ok) setError(result.error ?? t("common.somethingWentWrong"));
    });
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">{t("auth.methodEmail")}</p>
          <p className="text-sm text-ink-2">
            {enabled ? t("auth.emailOtpOn") : t("auth.emailOtpOff")}
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={pending || (!enabled && !emailVerified)}
          className={`btn btn-sm ${enabled ? "btn-secondary" : "btn-primary"}`}
        >
          {enabled ? t("auth.disableTwoFactor") : t("auth.enableEmailOtp")}
        </button>
      </div>
      <p className="mt-1 text-xs text-ink-3">{t("auth.methodEmailHelp")}</p>
      {error && (
        <p className="mt-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
