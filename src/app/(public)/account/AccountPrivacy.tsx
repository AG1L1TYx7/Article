"use client";

import { useState } from "react";
import Link from "next/link";
import { deleteMyAccount } from "./actions";
import { TrashIcon } from "@/components/icons";
import { PasswordInput } from "@/components/PasswordInput";
import { useI18n } from "@/i18n/client";

/**
 * The rights a person can exercise without asking anyone: download
 * everything, delete the account. (Correcting their details is the
 * Personal information section, ProfileDetails.tsx.) Kept on the account
 * page rather than behind a support address because a right you have to
 * write in for is a right most people never use.
 */
export function AccountPrivacy({ canDelete }: { canDelete: boolean }) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // The confirmation phrase is the same in every language, so it can be
  // documented once and checked once.
  const phrase = t("account.deletePhrase");
  const [blurbBefore, blurbAfter] = t("account.yourDataBlurb").split("{privacyPolicy}");

  async function remove(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setDeleting(true);
    setDeleteError(null);
    const result = await deleteMyAccount({ password });
    if (!result.ok) {
      setDeleting(false);
      setDeleteError(result.error ?? t("account.couldntDelete"));
      return;
    }
    // A full navigation on purpose: the session no longer exists, and a
    // soft navigation would show the router's cached signed-in pages.
    window.location.assign(new URL("/?deleted=1", window.location.origin).toString());
  }

  return (
    <section className="card mt-4 p-6" aria-labelledby="privacy-heading">
      <h2 id="privacy-heading" className="text-lg font-medium">
        {t("account.yourData")}
      </h2>
      <p className="mt-1 text-sm text-ink-2">
        {blurbBefore}
        <Link href="/privacy" className="text-link">
          {t("account.privacyPolicy")}
        </Link>
        {blurbAfter}
      </p>

      <dl className="mt-5 divide-y divide-line border-t border-line">
        <div className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <dt className="text-sm font-medium">{t("account.downloadData")}</dt>
            <dd className="text-sm text-ink-2">{t("account.downloadDataBlurb")}</dd>
          </div>
          <a href="/account/data" download className="btn btn-secondary btn-sm">
            {t("account.download")}
          </a>
        </div>

        <div className="py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <dt className="text-sm font-medium">{t("account.deleteAccount")}</dt>
              <dd className="text-sm text-ink-2">
                {canDelete ? t("account.deleteBlurb") : t("account.deleteBlockedByArticles")}
              </dd>
            </div>
            {canDelete && !confirming && (
              <button type="button" onClick={() => setConfirming(true)} className="btn btn-danger btn-sm gap-1">
                <TrashIcon size={14} /> {t("account.deleteButton")}
              </button>
            )}
          </div>

          {confirming && (
            <form onSubmit={remove} className="alert alert-danger mt-4 flex flex-col gap-3">
              <p className="font-medium">{t("account.permanent")}</p>
              <label className="field">
                <span className="text-sm">
                  {t("account.typeToConfirm", { phrase: "" }).replace(/\s{2,}/g, " ").trim()}{" "}
                  <strong>{phrase}</strong>
                </span>
                <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="input" />
              </label>
              <label className="field">
                <span className="text-sm">{t("account.yourPassword")}</span>
                <PasswordInput
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>
              {deleteError && (
                <p className="text-sm" role="alert">
                  {deleteError}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={deleting || typed.trim().toLowerCase() !== phrase || !password}
                  className="btn btn-danger btn-sm"
                >
                  {deleting ? t("account.deleting") : t("account.deleteMyAccount")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(false);
                    setTyped("");
                    setPassword("");
                    setDeleteError(null);
                  }}
                  className="btn btn-ghost btn-sm"
                >
                  {t("account.keepMyAccount")}
                </button>
              </div>
            </form>
          )}
        </div>
      </dl>
    </section>
  );
}
