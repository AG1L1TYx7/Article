import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth, signOut } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { TRUST_COOKIE, trustTokenExpiry, verifyTrustToken } from "@/lib/auth/trustedDevice";
import { forgetThisDevice } from "./actions";
import { AccountPrivacy } from "./AccountPrivacy";
import { EmailVerifyBanner } from "@/app/(dashboard)/dashboard/EmailVerifyBanner";
import { EnrollMfaFlow } from "@/app/(dashboard)/dashboard/mfa/EnrollMfaFlow";
import { DisableMfaForm } from "@/app/(dashboard)/dashboard/mfa/DisableMfaForm";
import { BellIcon, BookmarkIcon, LogoutIcon, PenIcon, ShieldIcon } from "@/components/icons";
import { initials } from "@/lib/format";
import { PushToggle } from "@/components/push/PushToggle";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { getI18n } from "@/i18n/server";
import type { MessageKey } from "@/i18n/t";

export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};

/**
 * What a role means, in the words a reader sees. Roles themselves are
 * never chosen here: sign-up always makes a READER, and only an admin on
 * the People page (or the bootstrap script on the server) can change it.
 */
const ROLE_COPY: Record<string, { label: MessageKey; blurb: MessageKey }> = {
  READER: { label: "account.roleReader", blurb: "account.roleReaderBlurb" },
  MODERATOR: { label: "account.roleModerator", blurb: "account.roleModeratorBlurb" },
  ADMIN: { label: "account.roleAdmin", blurb: "account.roleAdminBlurb" },
};

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?from=/account");

  const { t, n, formatDate } = await getI18n();

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      handle: true,
      email: true,
      role: true,
      mfaEnabled: true,
      mfaSecret: true,
      sessionVersion: true,
      emailVerifiedAt: true,
      createdAt: true,
      _count: { select: { bookmarks: true, comments: true, follows: true, articles: true } },
    },
  });
  if (!user) redirect("/login");

  const role = ROLE_COPY[user.role] ?? ROLE_COPY.READER!;
  const isStaff = user.role === "ADMIN" || user.role === "MODERATOR";

  // Is THIS browser remembered for two-factor? Read from the cookie the
  // login page set; see lib/auth/trustedDevice.ts.
  const trustCookie = (await cookies()).get(TRUST_COOKIE)?.value;
  const deviceTrusted = user.mfaEnabled && verifyTrustToken(trustCookie, user);
  const trustExpires = deviceTrusted ? trustTokenExpiry(trustCookie) : null;

  return (
    <main id="main-content" className="mx-auto max-w-3xl px-4 pt-10 pb-16 sm:px-6">
      <p className="kicker">{t("account.kicker")}</p>
      <h1 className="headline mt-2 text-4xl">{t("account.title")}</h1>

      {!user.emailVerifiedAt && (
        <div className="mt-6">
          <EmailVerifyBanner email={user.email} />
        </div>
      )}

      {/* Who you are */}
      <section className="card mt-6 p-6" aria-labelledby="profile-heading">
        <h2 id="profile-heading" className="sr-only">
          {t("account.profile")}
        </h2>
        <div className="flex flex-wrap items-center gap-5">
          <span className="avatar h-16 w-16 text-xl">{initials(user.name)}</span>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-medium">{user.name}</p>
            <p className="text-sm text-ink-3">
              @{user.handle} · {user.email}
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`pill ${isStaff ? "pill-ok" : "pill-neutral"}`}>{t(role.label)}</span>
              <span className={`pill ${user.emailVerifiedAt ? "pill-ok" : "pill-warn"}`}>
                {user.emailVerifiedAt ? t("account.emailVerified") : t("account.emailUnverified")}
              </span>
              <span className={`pill ${user.mfaEnabled ? "pill-ok" : "pill-neutral"}`}>
                <ShieldIcon size={11} /> {user.mfaEnabled ? t("account.twoFactorOn") : t("account.twoFactorOff")}
              </span>
            </p>
          </div>
        </div>
        <p className="mt-4 text-sm text-ink-2">{t(role.blurb)}</p>
        <p className="mt-1 text-xs text-ink-3">{t("account.memberSince", { date: formatDate(user.createdAt) })}</p>
      </section>

      {/* Where your things are */}
      <section className="mt-4 grid gap-3 sm:grid-cols-3" aria-label={t("account.activity")}>
        <Link href="/saved" className="card card-hover flex items-center gap-3 px-4 py-3">
          <span className="avatar h-9 w-9">
            <BookmarkIcon size={16} />
          </span>
          <span>
            <span className="block text-sm font-medium">{t("account.saved")}</span>
            <span className="block text-xs text-ink-3">{n(user._count.bookmarks, "common.articles")}</span>
          </span>
        </Link>
        <Link href="/following" className="card card-hover flex items-center gap-3 px-4 py-3">
          <span className="avatar h-9 w-9">
            <BellIcon size={16} />
          </span>
          <span>
            <span className="block text-sm font-medium">{t("account.following")}</span>
            <span className="block text-xs text-ink-3">
              {n(user._count.follows, "account.sources")} · {n(user._count.comments, "common.comments")}
            </span>
          </span>
        </Link>
        {isStaff ? (
          <Link href="/dashboard" className="card card-hover flex items-center gap-3 px-4 py-3">
            <span className="avatar h-9 w-9 bg-ink text-paper ring-ink">
              <PenIcon size={16} />
            </span>
            <span>
              <span className="block text-sm font-medium">{t("account.newsroom")}</span>
              <span className="block text-xs text-ink-3">{t("account.newsroomBlurb")}</span>
            </span>
          </Link>
        ) : (
          <div className="card flex items-center gap-3 px-4 py-3 opacity-70">
            <span className="avatar h-9 w-9">
              <PenIcon size={16} />
            </span>
            <span>
              <span className="block text-sm font-medium">{t("account.newsroom")}</span>
              <span className="block text-xs text-ink-3">{t("account.staffOnly")}</span>
            </span>
          </div>
        )}
      </section>

      {/* Security */}
      <section className="card mt-4 p-6" aria-labelledby="security-heading">
        <h2 id="security-heading" className="flex items-center gap-2 text-lg font-medium">
          <ShieldIcon size={18} /> {t("account.twoFactor")}
        </h2>
        <p className="mt-1 text-sm text-ink-2">{t("account.twoFactorBlurb")}</p>
        <div className="mt-5 border-t border-line pt-5">
          {user.mfaEnabled ? (
            <>
              <p className="alert alert-ok mb-4" role="status">
                {t("account.twoFactorIsOn")}
              </p>
              <DisableMfaForm />
            </>
          ) : (
            <EnrollMfaFlow />
          )}
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

      {/* Alerts on this device. The toggle renders nothing when push is
          not configured on the server or not supported by the browser. */}
      <section className="card mt-4 p-6" aria-labelledby="alerts-heading">
        <h2 id="alerts-heading" className="flex items-center gap-2 text-lg font-medium">
          <BellIcon size={18} /> {t("account.alerts")}
        </h2>
        <p className="mt-1 text-sm text-ink-2">{t("account.alertsBlurb")}</p>
        <div className="mt-5 border-t border-line pt-5">
          <PushToggle variant="row" />
          <noscript>
            <p className="text-sm text-ink-3">{t("account.alertsNeedJs")}</p>
          </noscript>
        </div>
      </section>

      {/* Language */}
      <section className="card mt-4 p-6" aria-labelledby="language-heading">
        <h2 id="language-heading" className="text-lg font-medium">
          {t("account.language")}
        </h2>
        <p className="mt-1 text-sm text-ink-2">{t("account.languageBlurb")}</p>
        <div className="mt-5 border-t border-line pt-5">
          <LanguageSwitcher variant="row" />
        </div>
      </section>

      <AccountPrivacy name={user.name} canDelete={user._count.articles === 0} />

      <section className="mt-4 flex flex-wrap items-center justify-between gap-3 px-1" aria-label={t("account.session")}>
        <p className="text-sm text-ink-3">
          <Link href="/account/password" className="text-link">
            {t("account.changePassword")}
          </Link>
          {" · "}
          <Link href="/forgot-password" className="text-link">
            {t("account.forgotReset")}
          </Link>
        </p>
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
      </section>
    </main>
  );
}
