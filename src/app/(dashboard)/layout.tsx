import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth/config";
import { Wordmark } from "@/components/Wordmark";
import { initials } from "@/lib/format";
import { DashboardNav } from "./DashboardNav";
import { CommandPalette } from "@/components/dashboard/CommandPalette";
import { ExternalIcon, LogoutIcon } from "@/components/icons";
import { getI18n } from "@/i18n/server";
import { getTheme } from "@/theme/server";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * The newsroom shell: a sidebar of tools on the left, the page on the
 * right. Separate from the reader-facing masthead so staff are not
 * scrolling past the day's front page to reach the moderation queue.
 *
 * The role is read here for the menu only. Every page still checks the
 * session itself — a menu is a convenience, not an access control (see
 * lib/auth/rbac.ts).
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login?from=/dashboard");

  const { t } = await getI18n();
  const theme = await getTheme();
  const { name, email, role, mfaEnabled } = session.user;

  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-line bg-surface md:sticky md:top-0 md:h-screen md:w-60 md:border-r md:border-b-0">
        <div className="flex h-14 items-center justify-between px-4 md:px-5">
          <Link href="/dashboard">
            <Wordmark height={20} />
          </Link>
          <span className="kicker hidden md:inline">{t("dashboard.newsroom")}</span>
        </div>
        <div className="hidden px-3 pb-2 md:block">
          <CommandPalette isAdmin={role === "ADMIN"} />
        </div>

        {/* Every newsroom account must enrol in two-factor before the rest
            of the dashboard opens — see src/proxy.ts. */}
        <DashboardNav role={role} mfaEnabled={!!mfaEnabled} locked={!mfaEnabled} />

        <div className="mt-auto border-t border-line px-3 py-2 md:p-4">
          {/* Who is signed in — on a phone the nav row is enough, and this
              would push the page's own title below the fold. */}
          <div className="hidden items-center gap-3 md:flex">
            <span className="avatar h-9 w-9 text-xs">{initials(name ?? email ?? "?")}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{name}</p>
              <p className="truncate text-xs text-ink-3">{email}</p>
            </div>
          </div>
          <div className="hidden items-center justify-between gap-2 md:mt-3 md:flex">
            <ThemeToggle initial={theme} />
            <LanguageSwitcher variant="compact" />
          </div>
          <div className="flex items-center gap-2 md:mt-3">
            <Link href="/" className="btn btn-ghost btn-sm flex-1 justify-start gap-1.5">
              <ExternalIcon size={14} /> {t("dashboard.viewSite")}
            </Link>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
              className="flex-1"
            >
              <button className="btn btn-ghost btn-sm w-full justify-start gap-1.5">
                <LogoutIcon size={14} /> {t("common.logout")}
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
