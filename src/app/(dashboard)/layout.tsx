import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth/config";
import { SITE_NAME } from "@/lib/siteUrl";
import { initials } from "@/lib/format";
import { DashboardNav } from "./DashboardNav";
import { ExternalIcon, LogoutIcon } from "@/components/icons";

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

  const { name, email, role, mfaEnabled } = session.user;

  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-line bg-surface md:sticky md:top-0 md:h-screen md:w-60 md:border-r md:border-b-0">
        <div className="flex h-14 items-center justify-between px-4 md:px-5">
          <Link href="/dashboard" className="headline text-xl font-semibold tracking-[-0.02em]">
            {SITE_NAME}
          </Link>
          <span className="kicker hidden md:inline">Newsroom</span>
        </div>

        <DashboardNav role={role} mfaEnabled={!!mfaEnabled} />

        <div className="mt-auto border-t border-line p-3 md:p-4">
          <div className="flex items-center gap-3">
            <span className="avatar h-9 w-9 text-xs">{initials(name ?? email ?? "?")}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{name}</p>
              <p className="truncate text-xs text-ink-3">{email}</p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Link href="/" className="btn btn-ghost btn-sm flex-1 justify-start gap-1.5">
              <ExternalIcon size={14} /> View site
            </Link>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
              className="flex-1"
            >
              <button className="btn btn-ghost btn-sm w-full justify-start gap-1.5">
                <LogoutIcon size={14} /> Log out
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
