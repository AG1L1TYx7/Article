"use client";

import { useState } from "react";
import Link from "next/link";
import { requestPasswordReset } from "./actions";
import { AuthCard } from "@/components/AuthCard";
import { useI18n } from "@/i18n/client";

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    await requestPasswordReset(new FormData(e.currentTarget));
    setPending(false);
    setSubmitted(true);
  }

  return (
    <AuthCard
      title={t("auth.resetTitle")}
      intro={submitted ? undefined : t("auth.resetIntro")}
      footer={
        <Link href="/login" className="text-link">
          {t("auth.backToLogin")}
        </Link>
      }
    >
      {submitted ? (
        <p className="alert alert-ok" role="status">
          {t("auth.resetSent")}
        </p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <label className="field">
            <span className="label">{t("common.email")}</span>
            <input name="email" type="email" autoComplete="email" required className="input" />
          </label>
          <button type="submit" disabled={pending} className="btn btn-primary mt-1 w-full py-2.5">
            {pending ? t("auth.sending") : t("auth.sendResetLink")}
          </button>
        </form>
      )}
    </AuthCard>
  );
}
