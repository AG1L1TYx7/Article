"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { disconnectGoogle } from "./actions";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { useI18n } from "@/i18n/client";

/**
 * "Connected accounts" — whether Google can sign in to this account, and
 * the two buttons that change that.
 *
 * `canDisconnect` is decided on the server (the account must keep at least
 * one way in) and passed down, so the reason is explained here rather than
 * only discovered after pressing the button. The server action checks it
 * again regardless; this is the courtesy, not the control.
 */
export function ConnectedAccounts({
  connectedAt,
  canDisconnect,
  connectAction,
}: {
  connectedAt: string | null;
  canDisconnect: boolean;
  connectAction: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onDisconnect() {
    setError(null);
    startTransition(async () => {
      const result = await disconnectGoogle();
      if (!result.ok) setError(result.error ?? t("common.somethingWentWrong"));
    });
  }

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
      <div>
        <p className="font-medium">{t("auth.googleAccount")}</p>
        <p className="text-sm text-ink-2">
          {connectedAt
            ? t("auth.googleConnectedOn", { date: connectedAt })
            : t("auth.googleNotConnected")}
        </p>
      </div>

      {connectedAt ? (
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={onDisconnect}
            disabled={pending || !canDisconnect}
            className="btn btn-secondary btn-sm"
          >
            {t("auth.disconnectGoogle")}
          </button>
          {!canDisconnect && (
            <p className="max-w-xs text-right text-xs text-ink-3">
              {t("auth.disconnectNeedsPassword")}{" "}
              {/* Say where, not just what: this is the only route from
                  "you cannot do that" to being able to. */}
              <Link href="/account/password" className="text-link">
                {t("password.setTitle")}
              </Link>
            </p>
          )}
        </div>
      ) : (
        <form action={connectAction} className="w-full sm:w-auto sm:min-w-56">
          <GoogleButton label={t("auth.connectGoogle")} />
        </form>
      )}

      {error && (
        <p className="w-full text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
