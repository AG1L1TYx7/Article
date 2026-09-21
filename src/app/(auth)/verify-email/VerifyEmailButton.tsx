"use client";

import { useState } from "react";
import Link from "next/link";
import { verifyEmail } from "./actions";
import { AuthCard } from "@/components/AuthCard";
import { useI18n } from "@/i18n/client";

type State = "idle" | "working" | "verified" | "failed";

export function VerifyEmailButton({ email, token }: { email: string; token: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<State>("idle");

  if (state === "verified") {
    return (
      <AuthCard title={t("auth.emailVerified")}>
        <p className="alert alert-ok" role="status">
          {t("auth.emailConfirmed")}
        </p>
        <Link href="/login" className="btn btn-primary mt-6">
          {t("auth.goToLogin")}
        </Link>
      </AuthCard>
    );
  }

  if (state === "failed") {
    return (
      <AuthCard title={t("auth.linkExpired")}>
        <p className="text-sm text-ink-2">{t("auth.verifyInvalid")}</p>
        <Link href="/login" className="btn btn-primary mt-6">
          {t("auth.goToLogin")}
        </Link>
      </AuthCard>
    );
  }

  const [before, after = ""] = t("auth.confirmingFor", { email: "\u0000" }).split("\u0000");

  return (
    <AuthCard
      title={t("auth.confirmEmail")}
      intro={
        <>
          {before}
          <strong className="text-ink">{email}</strong>
          {after}
        </>
      }
    >
      <button
        disabled={state === "working"}
        onClick={async () => {
          setState("working");
          try {
            setState((await verifyEmail(email, token)) ? "verified" : "failed");
          } catch {
            setState("failed");
          }
        }}
        className="btn btn-primary w-full py-2.5"
      >
        {state === "working" ? t("auth.confirming") : t("auth.confirmMyEmail")}
      </button>
    </AuthCard>
  );
}
