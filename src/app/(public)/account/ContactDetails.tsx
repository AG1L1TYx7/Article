"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmPhone, removePhone, requestEmailChange, startPhoneVerification } from "./actions";
import { resendVerificationEmail } from "@/app/(auth)/verify-email/actions";
import { useI18n } from "@/i18n/client";

/**
 * Email and phone, each with its verification state and the one action
 * that changes it. Everything here is password- or code-confirmed on
 * the server; this component only sequences the steps and reports back.
 */
export function ContactDetails({
  email,
  emailVerified,
  pendingEmail,
  phoneMasked,
  phoneVerified,
}: {
  email: string;
  emailVerified: boolean;
  pendingEmail: string | null;
  /** The stored number, masked for display; null when there is none. */
  phoneMasked: string | null;
  phoneVerified: boolean;
}) {
  const router = useRouter();
  const { t } = useI18n();

  // Email change
  const [changingEmail, setChangingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  // Phone
  const [phoneStep, setPhoneStep] = useState<"idle" | "number" | "code">(
    phoneMasked && !phoneVerified ? "code" : "idle"
  );
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(phoneMasked && !phoneVerified ? phoneMasked : null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [phoneDone, setPhoneDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function onRequestEmailChange(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setEmailError(null);
    const result = await requestEmailChange({ newEmail, password: emailPassword });
    setPending(false);
    if (!result.ok) {
      setEmailError(result.error ?? t("account.couldntChangeEmail"));
      return;
    }
    setEmailSentTo(newEmail);
    setChangingEmail(false);
    setEmailPassword("");
    router.refresh();
  }

  async function onSendCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setPhoneError(null);
    const result = await startPhoneVerification({ phone });
    setPending(false);
    if (!result.ok) {
      setPhoneError(result.error ?? t("account.couldntSendCode"));
      return;
    }
    setSentTo(result.masked ?? phone);
    setPhoneStep("code");
    setCode("");
  }

  async function onConfirmCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setPhoneError(null);
    const result = await confirmPhone({ code });
    setPending(false);
    if (!result.ok) {
      setPhoneError(result.error ?? t("account.couldntVerifyCode"));
      return;
    }
    setPhoneStep("idle");
    setPhoneDone(true);
    router.refresh();
  }

  async function onRemovePhone() {
    setPending(true);
    await removePhone();
    setPending(false);
    setPhoneStep("idle");
    setSentTo(null);
    setPhoneDone(false);
    router.refresh();
  }

  return (
    <section className="card mt-4 p-6" aria-labelledby="contact-heading">
      <h2 id="contact-heading" className="text-lg font-medium">
        {t("account.contact")}
      </h2>
      <p className="mt-1 text-sm text-ink-2">{t("account.contactBlurb")}</p>

      <dl className="mt-5 divide-y divide-line border-t border-line">
        {/* Email */}
        <div className="py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <dt className="text-sm font-medium">{t("account.emailLabel")}</dt>
              <dd className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
                <span>{email}</span>
                <span className={`pill ${emailVerified ? "pill-ok" : "pill-warn"}`}>
                  {emailVerified ? t("account.emailVerified") : t("account.emailUnverified")}
                </span>
              </dd>
              {pendingEmail && !emailSentTo && (
                <p className="mt-1 text-xs text-ink-3">{t("account.emailPending", { email: pendingEmail })}</p>
              )}
              {emailSentTo && (
                <p className="mt-1 text-xs text-ok" role="status">
                  {t("account.emailChangeSent", { email: emailSentTo })}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {!emailVerified && (
                <button
                  type="button"
                  disabled={pending || resent}
                  onClick={async () => {
                    setPending(true);
                    await resendVerificationEmail(email);
                    setPending(false);
                    setResent(true);
                  }}
                  className="btn btn-secondary btn-sm"
                >
                  {resent ? t("verify.checkInbox") : t("verify.resend")}
                </button>
              )}
              {!changingEmail && (
                <button type="button" onClick={() => setChangingEmail(true)} className="btn btn-secondary btn-sm">
                  {t("account.changeEmail")}
                </button>
              )}
            </div>
          </div>
          {changingEmail && (
            <form onSubmit={onRequestEmailChange} className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="field">
                <span className="label">{t("account.newEmail")}</span>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="input"
                />
              </label>
              <label className="field">
                <span className="label">{t("account.confirmWithPassword")}</span>
                <input
                  type="password"
                  value={emailPassword}
                  onChange={(e) => setEmailPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="input"
                />
              </label>
              {emailError && (
                <p className="text-sm text-danger sm:col-span-2" role="alert">
                  {emailError}
                </p>
              )}
              <div className="flex gap-2 sm:col-span-2">
                <button type="submit" disabled={pending || !newEmail || !emailPassword} className="btn btn-primary btn-sm">
                  {t("account.sendConfirmation")}
                </button>
                <button type="button" onClick={() => setChangingEmail(false)} className="btn btn-ghost btn-sm">
                  {t("common.cancel")}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Phone */}
        <div className="py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <dt className="text-sm font-medium">{t("account.phoneLabel")}</dt>
              <dd className="flex flex-wrap items-center gap-2 text-sm text-ink-2" data-phone-status={phoneVerified ? "verified" : phoneMasked ? "unverified" : "none"}>
                {phoneMasked ? (
                  <>
                    <span className="tabular-nums">{phoneMasked}</span>
                    <span className={`pill ${phoneVerified ? "pill-ok" : "pill-warn"}`}>
                      {phoneVerified ? t("account.phoneVerified") : t("account.phoneUnverified")}
                    </span>
                  </>
                ) : (
                  <span>{t("account.phoneNone")}</span>
                )}
              </dd>
              {phoneDone && (
                <p className="mt-1 text-xs text-ok" role="status">
                  {t("account.phoneSaved")}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {phoneStep === "idle" && (
                <button type="button" onClick={() => setPhoneStep("number")} className="btn btn-secondary btn-sm">
                  {phoneMasked ? t("account.changePhone") : t("account.addPhone")}
                </button>
              )}
              {phoneMasked && phoneStep === "idle" && (
                <button type="button" onClick={onRemovePhone} disabled={pending} className="btn btn-ghost btn-sm">
                  {t("account.removePhone")}
                </button>
              )}
            </div>
          </div>

          {phoneStep === "number" && (
            <form onSubmit={onSendCode} className="mt-4 flex flex-col gap-3">
              <label className="field">
                <span className="label">{t("account.phoneLabel")}</span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+977 98 1234 5678"
                  required
                  autoComplete="tel"
                  inputMode="tel"
                  className="input sm:max-w-xs"
                />
                <span className="hint">{t("account.phoneHelp")}</span>
              </label>
              {phoneError && (
                <p className="text-sm text-danger" role="alert">
                  {phoneError}
                </p>
              )}
              <div className="flex gap-2">
                <button type="submit" disabled={pending || !phone.trim()} className="btn btn-primary btn-sm">
                  {t("account.sendCode")}
                </button>
                <button type="button" onClick={() => setPhoneStep("idle")} className="btn btn-ghost btn-sm">
                  {t("common.cancel")}
                </button>
              </div>
            </form>
          )}

          {phoneStep === "code" && (
            <form onSubmit={onConfirmCode} className="mt-4 flex flex-col gap-3">
              <p className="text-sm text-ink-2" role="status">
                {t("account.codeSentTo", { phone: sentTo ?? "" })}
              </p>
              <label className="field">
                <span className="label">{t("account.enterCode")}</span>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="one-time-code"
                  required
                  name="phoneCode"
                  className="input font-mono text-xl tracking-[0.4em] sm:max-w-[12rem]"
                />
              </label>
              {phoneError && (
                <p className="text-sm text-danger" role="alert">
                  {phoneError}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={pending || code.trim().length !== 6} className="btn btn-primary btn-sm">
                  {t("account.verifyPhone")}
                </button>
                <button type="button" onClick={() => setPhoneStep("number")} className="btn btn-ghost btn-sm">
                  {t("account.resendCode")}
                </button>
                <button type="button" onClick={onRemovePhone} disabled={pending} className="btn btn-ghost btn-sm">
                  {t("common.cancel")}
                </button>
              </div>
            </form>
          )}
        </div>
      </dl>
    </section>
  );
}
