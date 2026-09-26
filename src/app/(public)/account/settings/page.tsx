import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth, googleEnabled, signOut } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { TRUST_COOKIE, trustTokenExpiry, verifyTrustToken } from "@/lib/auth/trustedDevice";
import { connectGoogle, forgetThisDevice } from "../actions";
import { ConnectedAccounts } from "../ConnectedAccounts";
import { AccountPrivacy } from "../AccountPrivacy";
import { EmailOtpToggle } from "../EmailOtpToggle";
import { HomeDistrict } from "../HomeDistrict";
import { SignOutEverywhere } from "../SignOutEverywhere";
import { ContactDetails } from "../ContactDetails";
import { ProfileDetails } from "../ProfileDetails";
import { EmailVerifyBanner } from "@/app/(dashboard)/dashboard/EmailVerifyBanner";
import { EnrollMfaFlow } from "@/app/(dashboard)/dashboard/mfa/EnrollMfaFlow";
import { DisableMfaForm } from "@/app/(dashboard)/dashboard/mfa/DisableMfaForm";
import { RecoveryCodesPanel } from "@/app/(dashboard)/dashboard/mfa/RecoveryCodesPanel";
import { parseStoredCodes } from "@/lib/auth/recoveryCodes";
import { ArrowLeftIcon, BellIcon, FlagIcon, LockIcon, LogoutIcon, ShieldIcon, SlidersIcon, UserIcon } from "@/components/icons";
import { PushToggle } from "@/components/push/PushToggle";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getTheme } from "@/theme/server";
import { decryptPhone } from "@/lib/phone";
import { maskPhone } from "@/lib/phoneFormat";
import { getI18n } from "@/i18n/server";
import type { MessageKey } from "@/i18n/t";

export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};

/**
 * Every setting a signed-in person has, grouped into four sections with a
 * menu beside them. These used to fill /account, which now shows the
 * person themselves; see ../page.tsx.
 *
 * The section ids (#account, #security, #preferences, #privacy) are link
 * targets: the profile's "Edit profile" and checklist, the MFA page and
 * the privacy policy all point at them.
 */
const SECTIONS: { id: string; title: MessageKey; blurb: MessageKey; icon: typeof UserIcon }[] = [
  { id: "account", title: "account.sectionAccount", blurb: "account.sectionAccountBlurb", icon: UserIcon },
  { id: "security", title: "account.sectionSecurity", blurb: "account.sectionSecurityBlurb", icon: ShieldIcon },
  { id: "preferences", title: "account.sectionPreferences", blurb: "account.sectionPreferencesBlurb", icon: SlidersIcon },
  { id: "privacy", title: "account.sectionPrivacy", blurb: "account.sectionPrivacyBlurb", icon: LockIcon },
];

function SectionHeading({ id, title, blurb, icon: Icon }: { id: string; title: string; blurb: string; icon: typeof UserIcon }) {
  return (
    <header className="flex flex-col gap-1">
      <h2 id={`${id}-heading`} className="headline flex items-center gap-2 text-2xl">
        <Icon size={20} /> {title}
      </h2>
      <p className="text-sm text-ink-2">{blurb}</p>
    </header>
  );
}

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?from=/account/settings");

  const { t, formatDate } = await getI18n();

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      preferredName: true,
      bio: true,
      email: true,
      role: true,
      mfaEnabled: true,
      mfaMethod: true,
      mfaSecret: true,
      mfaRecoveryCodes: true,
      phoneEncrypted: true,
      phoneVerifiedAt: true,
      pendingEmail: true,
      sessionVersion: true,
      emailVerifiedAt: true,
      districtId: true,
      passwordHash: true,
      accounts: { select: { provider: true, createdAt: true } },
      _count: { select: { articles: true } },
    },
  });
  if (!user) redirect("/login");

  const isStaff = user.role === "ADMIN" || user.role === "MODERATOR";

  // Is THIS browser remembered for two-factor? Read from the cookie the
  // login page set; see lib/auth/trustedDevice.ts.
  const trustCookie = (await cookies()).get(TRUST_COOKIE)?.value;
  const deviceTrusted = user.mfaEnabled && verifyTrustToken(trustCookie, user);
  const trustExpires = deviceTrusted ? trustTokenExpiry(trustCookie) : null;

  const districts = await db.district.findMany({
    orderBy: [{ province: { number: "asc" } }, { name: "asc" }],
    select: { id: true, name: true, nameNe: true, province: { select: { name: true } } },
  });

  // Whether Google can sign in to this account, and whether removing it
  // would leave no way back in. An account made with Google has no
  // password, so the last sign-in method must not be removable.
  const googleAccount = user.accounts.find((a) => a.provider === "google") ?? null;
  const canDisconnectGoogle = !!user.passwordHash || user.accounts.length > 1;

  const section = (id: string) => SECTIONS.find((s) => s.id === id)!;
  const heading = (id: string) => {
    const s = section(id);
    return <SectionHeading id={s.id} title={t(s.title)} blurb={t(s.blurb)} icon={s.icon} />;
  };

  return (
    <main id="main-content" className="mx-auto max-w-5xl px-4 pt-8 pb-16 sm:px-6">
      <Link href="/account" className="inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink">
        <ArrowLeftIcon size={14} /> {t("account.backToProfile")}
      </Link>
      <h1 className="headline mt-3 text-4xl">{t("account.settingsTitle")}</h1>
      <p className="mt-2 text-sm text-ink-2">{t("account.settingsBlurb")}</p>

      {!user.emailVerifiedAt && (
        <div className="mt-6">
          <EmailVerifyBanner email={user.email} />
        </div>
      )}

      <div className="mt-8 grid gap-8 md:grid-cols-[13rem_minmax(0,1fr)]">
        {/* The menu: a column beside the sections on wide screens, a row of
            chips above them on a phone. Plain anchors, so it works without
            JavaScript and each section has a shareable address. */}
        <nav aria-label={t("account.settingsTitle")} className="md:sticky md:top-6 md:self-start">
          <ul className="flex flex-wrap gap-1.5 md:flex-col md:gap-0.5">
            {SECTIONS.map(({ id, title, icon: Icon }) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink md:border-transparent md:py-2"
                >
                  <Icon size={15} /> {t(title)}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-12">
          {/* ---------------- Account ---------------- */}
          <section id="account" aria-labelledby="account-heading" className="scroll-mt-6">
            {heading("account")}
            <div id="personal" className="scroll-mt-6">
              <ProfileDetails
                name={user.name}
                isStaff={isStaff}
                details={{ firstName: user.firstName, lastName: user.lastName, preferredName: user.preferredName, bio: user.bio }}
              />
            </div>
            {/* Email and phone: the number is decrypted only to be masked. */}
            <ContactDetails
              email={user.email}
              emailVerified={!!user.emailVerifiedAt}
              pendingEmail={user.pendingEmail}
              phoneMasked={user.phoneEncrypted ? maskPhone(decryptPhone(user.phoneEncrypted)) : null}
              phoneVerified={!!user.phoneVerifiedAt}
            />
            {/* Where they live, which is how a district alert finds them. */}
            <section id="district" className="card mt-4 scroll-mt-6 p-6" aria-labelledby="district-heading">
              <h3 id="district-heading" className="flex items-center gap-2 text-lg font-medium">
                <FlagIcon size={18} /> Reports near you
              </h3>
              <p className="mt-1 text-sm text-ink-2">
                Tell us your district and we will let you know when a verified report concerns it.
              </p>
              <HomeDistrict districts={districts} current={user.districtId} />
            </section>
          </section>

          {/* ---------------- Security ---------------- */}
          <section id="security" aria-labelledby="security-heading" className="scroll-mt-6">
            {heading("security")}

            <div className="card mt-4 flex flex-wrap items-center justify-between gap-3 p-6">
              <div>
                <p className="font-medium">{t("account.password")}</p>
                <p className="mt-0.5 text-sm text-ink-3">
                  <Link href="/forgot-password" className="text-link">
                    {t("account.forgotReset")}
                  </Link>
                </p>
              </div>
              <Link href="/account/password" className="btn btn-secondary btn-sm">
                {t("account.changePassword")}
              </Link>
            </div>

            <section className="card mt-4 p-6" aria-labelledby="twofactor-heading">
              <h3 id="twofactor-heading" className="flex items-center gap-2 text-lg font-medium">
                <ShieldIcon size={18} /> {t("account.twoFactor")}
              </h3>
              <p className="mt-1 text-sm text-ink-2">{t("account.twoFactorBlurb")}</p>
              {/* Two methods, and which one is offered depends on who is asking.
                  The app is stronger and is the only thing an administrator may
                  use (src/proxy.ts); the emailed code asks nothing of a member
                  beyond an inbox they already have. */}
              <div className="mt-5 border-t border-line pt-5">
                <p className="label">{t("auth.twoFactorMethod")}</p>
                <div className="mt-3">
                  <p className="font-medium">{t("auth.methodApp")}</p>
                  <p className="mb-3 text-xs text-ink-3">{t("auth.methodAppHelp")}</p>
                  {user.mfaEnabled && user.mfaMethod === "TOTP" ? (
                    <>
                      <p className="alert alert-ok mb-4" role="status">
                        {t("account.twoFactorIsOn")}
                      </p>
                      {/* Recovery codes belong to the authenticator app: they
                          are what gets you back in when the phone is gone. */}
                      <RecoveryCodesPanel remaining={parseStoredCodes(user.mfaRecoveryCodes).length} />
                      <div className="mt-5 border-t border-line pt-5">
                        <DisableMfaForm />
                      </div>
                    </>
                  ) : user.mfaEnabled ? (
                    // Using the emailed code: enrolling an app would mean two
                    // methods at once, which this page does not model.
                    <p className="text-sm text-ink-2">{t("account.switchMethodFirst")}</p>
                  ) : (
                    <EnrollMfaFlow />
                  )}
                </div>
                <div className="mt-5 border-t border-line pt-5">
                  <EmailOtpToggle
                    enabled={user.mfaEnabled && user.mfaMethod === "EMAIL"}
                    isAdmin={user.role === "ADMIN"}
                    emailVerified={user.emailVerifiedAt !== null}
                  />
                </div>
              </div>

              {user.mfaEnabled && (
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-sm">
                  <p className="text-ink-2">
                    {deviceTrusted ? (
                      <>
                        <span className="font-medium text-ink">{t("account.deviceRemembered")}</span>{" "}
                        {t("account.deviceRememberedUntil", { date: trustExpires ? formatDate(trustExpires) : "…" })}
                      </>
                    ) : (
                      <>
                        <span className="font-medium text-ink">{t("account.deviceNotRemembered")}</span>{" "}
                        {t("account.deviceHowTo")}
                      </>
                    )}
                  </p>
                  {deviceTrusted && (
                    <form
                      action={async () => {
                        "use server";
                        await forgetThisDevice();
                      }}
                    >
                      <button className="btn btn-secondary btn-sm">{t("account.forgetDevice")}</button>
                    </form>
                  )}
                </div>
              )}
            </section>

            {/* How you sign in, besides a password. Hidden entirely when
                Google sign-in is not configured on this deployment. */}
            {googleEnabled && (
              <section className="card mt-4 p-6" aria-labelledby="connected-heading">
                <h3 id="connected-heading" className="flex items-center gap-2 text-lg font-medium">
                  <ShieldIcon size={18} /> {t("auth.connectedAccounts")}
                </h3>
                <ConnectedAccounts
                  connectedAt={googleAccount ? formatDate(googleAccount.createdAt) : null}
                  canDisconnect={canDisconnectGoogle}
                  connectAction={connectGoogle}
                />
              </section>
            )}

            <div className="card mt-4 flex flex-wrap items-center justify-between gap-3 p-6 text-sm">
              <p className="font-medium">{t("account.session")}</p>
              <SignOutEverywhere />
            </div>
          </section>

          {/* ---------------- Preferences ---------------- */}
          <section id="preferences" aria-labelledby="preferences-heading" className="scroll-mt-6">
            {heading("preferences")}
            {/* Alerts on this device. The toggle renders nothing when push
                is not configured on the server or not supported here. */}
            <section className="card mt-4 p-6" aria-labelledby="alerts-heading">
              <h3 id="alerts-heading" className="flex items-center gap-2 text-lg font-medium">
                <BellIcon size={18} /> {t("account.alerts")}
              </h3>
              <p className="mt-1 text-sm text-ink-2">{t("account.alertsBlurb")}</p>
              <div className="mt-5 border-t border-line pt-5">
                <PushToggle variant="row" />
                <noscript>
                  <p className="text-sm text-ink-3">{t("account.alertsNeedJs")}</p>
                </noscript>
              </div>
            </section>
            <section className="card mt-4 p-6" aria-labelledby="language-heading">
              <h3 id="language-heading" className="text-lg font-medium">
                {t("account.language")}
              </h3>
              <p className="mt-1 text-sm text-ink-2">{t("account.languageBlurb")}</p>
              <div className="mt-5 border-t border-line pt-5">
                <LanguageSwitcher variant="row" />
              </div>
            </section>
            <section className="card mt-4 p-6" aria-labelledby="appearance-heading">
              <h3 id="appearance-heading" className="text-lg font-medium">
                {t("account.appearance")}
              </h3>
              <p className="mt-1 text-sm text-ink-2">{t("account.appearanceBlurb")}</p>
              <div className="mt-5 border-t border-line pt-5">
                <ThemeToggle initial={await getTheme()} variant="row" />
              </div>
            </section>
          </section>

          {/* ---------------- Privacy and data ---------------- */}
          <section id="privacy" aria-labelledby="privacy-heading-section" className="scroll-mt-6">
            <header className="flex flex-col gap-1">
              <h2 id="privacy-heading-section" className="headline flex items-center gap-2 text-2xl">
                <LockIcon size={20} /> {t("account.sectionPrivacy")}
              </h2>
              <p className="text-sm text-ink-2">{t("account.sectionPrivacyBlurb")}</p>
            </header>
            <AccountPrivacy canDelete={user._count.articles === 0} />
          </section>

          <div className="flex justify-end border-t border-line pt-6">
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button className="btn btn-secondary gap-1.5">
                <LogoutIcon size={15} /> {t("common.logout")}
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
