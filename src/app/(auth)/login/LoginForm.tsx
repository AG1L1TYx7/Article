"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getSession, signIn } from "next-auth/react";
import { checkMfaRequired, rememberThisDevice, resendSignInCode } from "./actions";
import { startGoogleSignIn } from "../google";
import { safeRedirectPath } from "@/lib/safeRedirect";
import { AuthCard } from "@/components/AuthCard";
import { PasswordInput } from "@/components/PasswordInput";
import { GoogleButton, OrSeparator } from "@/components/auth/GoogleButton";
import { loginErrorMessage } from "@/lib/auth/loginErrors";
import { useI18n } from "@/i18n/client";

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const params = useSearchParams();
  const { t, n } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Holds the verified-so-far credentials once a TOTP code is required, so
  // the second submit doesn't ask the user to retype their password.
  const [awaitingTotp, setAwaitingTotp] = useState<{
    email: string;
    password: string;
    /** Which factor is being asked for — see checkMfaRequired(). */
    method: "app" | "email";
  } | null>(null);
  // Only for the emailed method: the outcome of pressing "send another".
  const [resent, setResent] = useState<string | null>(null);
  // "Don't ask again on this device" — on by default because the people
  // who reach this step have already proved the second factor once, and
  // the label spells out what it means on a shared machine.
  const [rememberDevice, setRememberDevice] = useState(true);

  // "By continuing with Google you confirm ... {terms} ... {privacy}."
  const googleNotice = t("auth.googleTermsNotice");
  const [googleBeforeTerms, googleAfterTerms = ""] = googleNotice.split("{terms}");
  const [googleBetweenLinks, googleAfterPrivacy = ""] = googleAfterTerms.split("{privacy}");

  async function signInAndRedirect(email: string, password: string, totp?: string) {
    // Important: only include `totp` when it's a real code. next-auth's
    // client signIn() serializes credentials through `new URLSearchParams`,
    // which stringifies `totp: undefined` into the literal text
    // "undefined" — that then fails the server's 6-digit regex and
    // rejects *every* login, MFA or not. (Caught by e2e tests: all four
    // login-dependent MFA tests failed, including one for an account with
    // MFA disabled entirely.)
    const result = await signIn("credentials", {
      email,
      password,
      ...(totp ? { totp } : {}),
      redirect: false,
    });
    if (result?.error) {
      setError(awaitingTotp ? t("auth.incorrectCode") : t("auth.incorrectCredentials"));
      return;
    }
    // A code was just accepted on this device; if asked, remember it so
    // the next thirty days of logins need only the password here.
    if (totp && rememberDevice) {
      await rememberThisDevice().catch(() => {});
    }
    // Only ever a path on this site: an attacker-supplied ?from= must not
    // be able to turn a successful login into a redirect to their domain.
    //
    // This used to check `from.startsWith("/")`, which is not enough —
    // "//evil.com" satisfies it and browsers resolve it to
    // https://evil.com. See lib/safeRedirect.ts.
    // Staff go to the newsroom; readers go to the front page. Readers used
    // to be sent to /dashboard and bounced back by proxy.ts — a wasted
    // round trip that also flashed the wrong page. The role is read from
    // the session the sign-in just created, so a stale client value can't
    // send anyone the wrong way.
    const session = await getSession();
    const role = session?.user?.role;
    const home = role === "ADMIN" || role === "MODERATOR" ? "/dashboard" : "/";
    const destination = safeRedirectPath(params.get("from"), home);

    // A full navigation, not router.push(), for two reasons. The client
    // Router Cache still holds pages rendered for the signed-out visitor,
    // so a soft navigation can land on stale signed-out content. And the
    // RSC request a soft push makes can race the session cookie the
    // sign-in just set: when it loses, proxy.ts sees no session and
    // bounces straight back to /login — which showed up as a rare, load-
    // dependent hang in the MFA e2e test, with the header already
    // rendering signed-in links while the URL had snapped back to /login.
    window.location.assign(destination);
  }

  async function onSubmitCredentials(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const formData = new FormData(e.currentTarget);
    const email = String(formData.get("email"));
    const password = String(formData.get("password"));

    const check = await checkMfaRequired(email, password);
    if (check.lockedUntil) {
      // Right password, locked account: say so, rather than the generic
      // "incorrect" that makes people retype a correct password five more
      // times and extend the lock.
      const until = new Date(check.lockedUntil);
      const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
      setError(n(minutes, "auth.locked"));
      setPending(false);
      return;
    }
    if (check.mfa) {
      setAwaitingTotp({ email, password, method: check.method ?? "app" });
      setPending(false);
      return;
    }

    await signInAndRedirect(email, password);
    setPending(false);
  }

  async function onSubmitTotp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!awaitingTotp) return;
    setError(null);
    setPending(true);
    const code = String(new FormData(e.currentTarget).get("totp"));
    await signInAndRedirect(awaitingTotp.email, awaitingTotp.password, code);
    setPending(false);
  }

  async function onResend() {
    if (!awaitingTotp) return;
    setResent(null);
    setError(null);
    const result = await resendSignInCode(awaitingTotp.email, awaitingTotp.password);
    setResent(result.ok ? t("auth.codeResent") : (result.error ?? t("common.somethingWentWrong")));
  }

  if (awaitingTotp) {
    const byEmail = awaitingTotp.method === "email";
    return (
      <AuthCard
        title={t("auth.enterCode")}
        intro={byEmail ? t("auth.enterCodeEmailIntro") : t("auth.enterCodeIntro")}
        footer={
          <button onClick={() => setAwaitingTotp(null)} className="text-link">
            {t("auth.useDifferentAccount")}
          </button>
        }
      >
        <form onSubmit={onSubmitTotp} className="flex flex-col gap-4">
          <label htmlFor="totp" className="sr-only">
            {t("auth.sixDigitCode")}
          </label>
          {/* No numeric pattern: a recovery code (eight letters and
              digits) is accepted here too. */}
          <input
            id="totp"
            name="totp"
            inputMode="text"
            maxLength={9}
            autoComplete="one-time-code"
            autoCapitalize="off"
            autoFocus
            required
            className="input py-3 text-center font-mono text-2xl tracking-[0.3em]"
          />
          <p className="-mt-2 text-xs text-ink-3">{t("auth.recoveryHint")}</p>
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={rememberDevice}
              onChange={(e) => setRememberDevice(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
            />
            <span>
              <span className="font-medium">{t("auth.rememberDevice")}</span>
              <span className="mt-0.5 block text-xs text-ink-3">{t("auth.rememberDeviceNote")}</span>
            </span>
          </label>
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={pending} className="btn btn-primary w-full py-2.5">
            {pending ? t("auth.verifying") : t("auth.verify")}
          </button>
          {/* Only for the emailed code: an authenticator app needs no
              resend, and offering one would just be a dead button. */}
          {byEmail && (
            <div className="text-center text-sm">
              <button
                type="button"
                onClick={onResend}
                disabled={pending}
                className="text-link"
              >
                {t("auth.sendAnotherCode")}
              </button>
              {resent && <p className="mt-1 text-xs text-ink-3">{resent}</p>}
            </div>
          )}
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t("auth.login")}
      intro={t("auth.welcomeBack")}
      footer={
        <>
          {t("auth.newHere")}{" "}
          <Link href="/register" className="text-link font-medium">
            {t("common.createAccount")}
          </Link>
        </>
      }
    >
      {params.get("registered") && (
        <p className="alert alert-ok mb-4" role="status">
          {t("auth.accountCreated")}
        </p>
      )}
      {params.get("reset") && (
        <p className="alert alert-ok mb-4" role="status">
          {t("auth.passwordUpdated")}
        </p>
      )}
      {/* A Google sign-in that was refused comes back here as ?error=<reason>.
          The sentence explains what to do instead, because "something went
          wrong" on a login page is how people give up on an account. */}
      {loginErrorMessage(params.get("error")) && (
        <p className="alert alert-warn mb-4" role="alert">
          {loginErrorMessage(params.get("error"))}
        </p>
      )}
      <form onSubmit={onSubmitCredentials} className="flex flex-col gap-4">
        <label className="field">
          <span className="label">{t("common.email")}</span>
          <input name="email" type="email" autoComplete="email" required className="input" />
        </label>
        <label className="field">
          <span className="flex items-center justify-between">
            <span className="label">{t("common.password")}</span>
            <a href="/forgot-password" className="text-xs text-ink-2 hover:text-ink">
              {t("auth.forgotPassword")}
            </a>
          </span>
          <PasswordInput name="password" autoComplete="current-password" required />
        </label>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending} className="btn btn-primary mt-1 w-full py-2.5">
          {pending ? t("auth.loggingIn") : t("auth.login")}
        </button>
      </form>

      {googleEnabled && (
        <>
          <OrSeparator label={t("auth.orSeparator")} />
          {/* After the password form, not before it: the first
              button[type="submit"] in the DOM is what the end-to-end suite
              means by "submit this form", and it should go on meaning the
              one above. */}
          <form action={startGoogleSignIn}>
            <input type="hidden" name="from" value={params.get("from") ?? ""} />
            <GoogleButton label={t("auth.continueWithGoogle")} />
          </form>
          {/* The agreement, for the one person at /login who turns out not
              to have an account yet: pressing the button above creates
              one, and this is the conspicuous notice that doing so
              accepts. Without it their only possible landing place is the
              registration page with a complaint, which is a poor way to
              meet somebody who did nothing wrong. */}
          <p className="mt-3 text-center text-xs text-ink-3">
            {googleBeforeTerms}
            <Link href="/terms" className="text-link" target="_blank">
              {t("auth.termsOfUse")}
            </Link>
            {googleBetweenLinks}
            <Link href="/privacy" className="text-link" target="_blank">
              {t("auth.privacyPolicy")}
            </Link>
            {googleAfterPrivacy}
          </p>
        </>
      )}
    </AuthCard>
  );
}
