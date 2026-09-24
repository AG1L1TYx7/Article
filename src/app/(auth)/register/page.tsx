"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { registerUser } from "./actions";
import { TurnstileWidget } from "@/components/security/TurnstileWidget";
import { AuthCard } from "@/components/AuthCard";
import { PasswordInput } from "@/components/PasswordInput";
import { useI18n } from "@/i18n/client";

export default function RegisterPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Turnstile injects its own hidden cf-turnstile-response input into the
  // form, so the token reaches the server action via FormData without us
  // passing it. This state only drives the disabled button, and stays
  // irrelevant when Turnstile is not configured.
  const botCheckRequired = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const [botToken, setBotToken] = useState<string | null>(null);

  // "I agree to the {terms} and the {privacy}." with two links inside.
  const consent = t("auth.consent");
  const [beforeTerms, afterTerms = ""] = consent.split("{terms}");
  const [betweenLinks, afterPrivacy = ""] = afterTerms.split("{privacy}");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await registerUser(new FormData(e.currentTarget));
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? t("common.somethingWentWrong"));
      return;
    }
    router.push("/login?registered=1");
  }

  return (
    <AuthCard
      title={t("auth.createAccount")}
      intro={
        <>
          {t("auth.registerIntro")}
          <span className="mt-1 block text-xs text-ink-3">{t("auth.registerNote")}</span>
        </>
      }
      footer={
        <>
          {t("auth.alreadyHaveOne")}{" "}
          <Link href="/login" className="text-link font-medium">
            {t("auth.login")}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label={t("common.name")} name="name" autoComplete="name" required />
        <Field
          label={t("auth.handle")}
          name="handle"
          autoComplete="username"
          required
          pattern="[a-z0-9_\-]+"
          helper={t("auth.handleHelp")}
        />
        <Field label={t("common.email")} name="email" type="email" autoComplete="email" required />
        <Field
          label={t("common.password")}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          helper={t("auth.passwordHelp")}
        />
        <TurnstileWidget onToken={setBotToken} />
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" name="consent" required className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
          <span className="text-ink-2">
            {beforeTerms}
            <Link href="/terms" className="text-link" target="_blank">
              {t("auth.termsOfUse")}
            </Link>
            {betweenLinks}
            <Link href="/privacy" className="text-link" target="_blank">
              {t("auth.privacyPolicy")}
            </Link>
            {afterPrivacy}
          </span>
        </label>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending || (botCheckRequired && !botToken)}
          className="btn btn-primary mt-1 w-full py-2.5"
        >
          {pending ? t("auth.creatingAccount") : t("auth.createAccountButton")}
        </button>
      </form>
    </AuthCard>
  );
}

function Field(props: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  pattern?: string;
  helper?: string;
}) {
  const { label, helper, type, ...rest } = props;
  return (
    <label className="field">
      <span className="label">{label}</span>
      {type === "password" ? <PasswordInput {...rest} /> : <input {...rest} type={type} className="input" />}
      {helper && <span className="hint">{helper}</span>}
    </label>
  );
}
