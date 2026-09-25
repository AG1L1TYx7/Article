"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { registerUser } from "./actions";
import { startGoogleSignUp } from "../google";
import { TurnstileWidget } from "@/components/security/TurnstileWidget";
import { AuthCard } from "@/components/AuthCard";
import { PasswordInput } from "@/components/PasswordInput";
import { GoogleButton, OrSeparator } from "@/components/auth/GoogleButton";
import { loginErrorMessage } from "@/lib/auth/loginErrors";
import { useI18n } from "@/i18n/client";

export function RegisterForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Turnstile injects its own hidden cf-turnstile-response input into the
  // form, so the token reaches the server action via FormData without us
  // passing it. This state only drives the disabled button, and stays
  // irrelevant when Turnstile is not configured.
  const botCheckRequired = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const [botToken, setBotToken] = useState<string | null>(null);
  // One checkbox, two routes out of this page. It is lifted into state
  // rather than left as a form field because the email form and the
  // Google form are separate <form> elements and HTML gives them no way
  // to share one input — while asking twice for the same agreement would
  // be worse than either.
  const [agreed, setAgreed] = useState(false);

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
      {/* Arriving here from a Google sign-in that had no record of consent. */}
      {loginErrorMessage(params.get("error")) && (
        <p className="alert alert-warn mb-4" role="alert">
          {loginErrorMessage(params.get("error"))}
        </p>
      )}

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
        {/* Governs both ways of signing up. Kept inside this form, where
            `required` blocks its submit and the field is posted even with
            scripting off; the React state beside it exists only so the
            Google form below can mirror the same answer. */}
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            name="consent"
            required
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
          />
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
          // Deliberately NOT disabled on the consent box. The checkbox's
          // own `required` stops an ordinary mistake, and the server
          // action refuses without consent regardless — which is the
          // check that counts, and which the privacy e2e test proves by
          // stripping `required` and submitting anyway. A disabled button
          // would make that property untestable from the outside.
          disabled={pending || (botCheckRequired && !botToken)}
          className="btn btn-primary mt-1 w-full py-2.5"
        >
          {pending ? t("auth.creatingAccount") : t("auth.createAccountButton")}
        </button>
      </form>

      {googleEnabled && (
        <>
          <OrSeparator label={t("auth.orSeparator")} />
          {/* Deliberately after the form above, not before it. Two submit
              buttons on one page are fine for a person, who sees two
              labelled buttons — but the first one in the DOM is what a
              selector like `button[type="submit"]` resolves to, and the
              existing end-to-end suite uses exactly that to mean "submit
              this form". Putting Google second keeps that meaning true. */}
          <form action={startGoogleSignUp}>
            {/* Mirrors the checkbox in the form above. Named differently
                on purpose: two inputs called "consent" would make the page
                ambiguous to anything selecting by name. The server action
                and the signIn callback both refuse without it, so this
                carries the fact rather than proving it. */}
            <input type="hidden" name="googleConsent" value={agreed ? "on" : ""} />
            <GoogleButton label={t("auth.signUpWithGoogle")} disabled={!agreed} />
          </form>
          {!agreed && <p className="mt-2 text-xs text-ink-3">{t("auth.googleNeedsConsent")}</p>}
        </>
      )}
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
