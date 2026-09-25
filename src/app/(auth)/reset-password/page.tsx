"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { resetPassword } from "./actions";
import { AuthCard } from "@/components/AuthCard";
import { PasswordInput } from "@/components/PasswordInput";
import { useI18n } from "@/i18n/client";

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const token = params.get("token") ?? "";
  const email = params.get("email") ?? "";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await resetPassword(new FormData(e.currentTarget));
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? t("common.somethingWentWrong"));
      return;
    }
    router.push("/login?reset=1");
  }

  if (!token || !email) {
    return (
      <AuthCard
        title={t("auth.linkIncomplete")}
        footer={
          <Link href="/forgot-password" className="text-link">
            {t("auth.requestNewLink")}
          </Link>
        }
      >
        <p className="text-sm text-ink-2">{t("auth.linkMissingParams")}</p>
      </AuthCard>
    );
  }

  const [before, after = ""] = t("auth.forEmail", { email: "\u0000" }).split("\u0000");

  return (
    <AuthCard
      title={t("auth.chooseNewPassword")}
      intro={
        <>
          {before}
          <strong className="text-ink">{email}</strong>
          {after}
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="email" value={email} />
        <label className="field">
          <span className="label">{t("auth.newPassword")}</span>
          <PasswordInput name="password" autoComplete="new-password" required minLength={12} />
          <span className="hint">{t("auth.passwordHelp")}</span>
        </label>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending} className="btn btn-primary mt-1 w-full py-2.5">
          {pending ? t("common.saving") : t("auth.saveNewPassword")}
        </button>
      </form>
    </AuthCard>
  );
}
