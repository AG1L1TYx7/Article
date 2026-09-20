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
import { formatDate, initials, plural } from "@/lib/format";
import { PushToggle } from "@/components/push/PushToggle";

export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};

/**
 * What a role means, in the words a reader sees. Roles themselves are
 * never chosen here: sign-up always makes a READER, and only an admin on
 * the People page (or the bootstrap script on the server) can change it.
 */
const ROLE_COPY: Record<string, { label: string; blurb: string }> = {
  READER: {
    label: "Reader",
    blurb: "You can save articles, follow writers and comment. Newsroom access is granted by an editor.",
  },
  MODERATOR: {
    label: "Writer & moderator",
    blurb: "You can write and publish articles and review comments.",
  },
  ADMIN: {
    label: "Administrator",
    blurb: "Full access, including people, categories and the audit log.",
  },
};

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?from=/account");

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
      <p className="kicker">Account</p>
      <h1 className="headline mt-2 text-4xl">Your account</h1>

      {!user.emailVerifiedAt && (
        <div className="mt-6">
          <EmailVerifyBanner email={user.email} />
        </div>
      )}

      {/* Who you are */}
      <section className="card mt-6 p-6" aria-labelledby="profile-heading">
        <h2 id="profile-heading" className="sr-only">
          Profile
        </h2>
        <div className="flex flex-wrap items-center gap-5">
          <span className="avatar h-16 w-16 text-xl">{initials(user.name)}</span>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-medium">{user.name}</p>
            <p className="text-sm text-ink-3">
              @{user.handle} · {user.email}
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`pill ${isStaff ? "pill-ok" : "pill-neutral"}`}>{role.label}</span>
              <span className={`pill ${user.emailVerifiedAt ? "pill-ok" : "pill-warn"}`}>
                {user.emailVerifiedAt ? "Email verified" : "Email unverified"}
              </span>
              <span className={`pill ${user.mfaEnabled ? "pill-ok" : "pill-neutral"}`}>
                <ShieldIcon size={11} /> {user.mfaEnabled ? "2FA on" : "2FA off"}
              </span>
            </p>
          </div>
        </div>
        <p className="mt-4 text-sm text-ink-2">{role.blurb}</p>
        <p className="mt-1 text-xs text-ink-3">Member since {formatDate(user.createdAt)}</p>
      </section>

      {/* Where your things are */}
      <section className="mt-4 grid gap-3 sm:grid-cols-3" aria-label="Your activity">
        <Link href="/saved" className="card card-hover flex items-center gap-3 px-4 py-3">
          <span className="avatar h-9 w-9">
            <BookmarkIcon size={16} />
          </span>
          <span>
            <span className="block text-sm font-medium">Saved</span>
            <span className="block text-xs text-ink-3">{plural(user._count.bookmarks, "article")}</span>
          </span>
        </Link>
        <Link href="/following" className="card card-hover flex items-center gap-3 px-4 py-3">
          <span className="avatar h-9 w-9">
            <BellIcon size={16} />
          </span>
          <span>
            <span className="block text-sm font-medium">Following</span>
            <span className="block text-xs text-ink-3">
              {plural(user._count.follows, "source")} · {plural(user._count.comments, "comment")}
            </span>
          </span>
        </Link>
        {isStaff ? (
          <Link href="/dashboard" className="card card-hover flex items-center gap-3 px-4 py-3">
            <span className="avatar h-9 w-9 bg-ink text-paper ring-ink">
              <PenIcon size={16} />
            </span>
            <span>
              <span className="block text-sm font-medium">Newsroom</span>
              <span className="block text-xs text-ink-3">Write, publish, moderate</span>
            </span>
          </Link>
        ) : (
          <div className="card flex items-center gap-3 px-4 py-3 opacity-70">
            <span className="avatar h-9 w-9">
              <PenIcon size={16} />
            </span>
            <span>
              <span className="block text-sm font-medium">Newsroom</span>
              <span className="block text-xs text-ink-3">Staff only</span>
            </span>
          </div>
        )}
      </section>

      {/* Security */}
      <section className="card mt-4 p-6" aria-labelledby="security-heading">
        <h2 id="security-heading" className="flex items-center gap-2 text-lg font-medium">
          <ShieldIcon size={18} /> Two-factor authentication
        </h2>
        <p className="mt-1 text-sm text-ink-2">
          A six-digit code from an authenticator app, asked for at every sign-in on top of your
          password. Recommended for everyone; required for administrators.
        </p>
        <div className="mt-5 border-t border-line pt-5">
          {user.mfaEnabled ? (
            <>
              <p className="alert alert-ok mb-4" role="status">
                Two-factor authentication is on for this account.
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
                  <span className="font-medium text-ink">This browser is remembered</span> — no code needed here
                  until {trustExpires ? formatDate(trustExpires) : "it expires"}. Your password is still asked every time.
                </>
              ) : (
                <>
                  <span className="font-medium text-ink">This browser is not remembered.</span> Tick &ldquo;Don&apos;t
                  ask for a code on this device&rdquo; at your next login to skip the code here for 30 days.
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
                <button className="btn btn-secondary btn-sm">Forget this device</button>
              </form>
            )}
          </div>
        )}
      </section>

      {/* Alerts on this device. The toggle renders nothing when push is
          not configured on the server or not supported by the browser. */}
      <section className="card mt-4 p-6" aria-labelledby="alerts-heading">
        <h2 id="alerts-heading" className="flex items-center gap-2 text-lg font-medium">
          <BellIcon size={18} /> Alerts on this device
        </h2>
        <p className="mt-1 text-sm text-ink-2">
          Breaking stories, and replies to your comments, as notifications on this phone or computer even
          when the site is closed. Per device: turning it on here does not turn it on anywhere else.
        </p>
        <div className="mt-5 border-t border-line pt-5">
          <PushToggle variant="row" />
          <noscript>
            <p className="text-sm text-ink-3">Alerts need JavaScript turned on.</p>
          </noscript>
        </div>
      </section>

      <AccountPrivacy name={user.name} canDelete={user._count.articles === 0} />

      <section className="mt-4 flex flex-wrap items-center justify-between gap-3 px-1" aria-label="Session">
        <p className="text-sm text-ink-3">
          <Link href="/account/password" className="text-link">
            Change your password
          </Link>
          {" · "}
          <Link href="/forgot-password" className="text-link">
            Forgotten it? Reset by email
          </Link>
        </p>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button className="btn btn-secondary gap-1.5">
            <LogoutIcon size={15} /> Log out
          </button>
        </form>
      </section>
    </main>
  );
}
