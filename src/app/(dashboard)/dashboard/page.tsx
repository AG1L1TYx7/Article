import { auth, signOut } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { EmailVerifyBanner } from "./EmailVerifyBanner";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, emailVerifiedAt: true },
  });

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="mt-2 text-neutral-600">
        Signed in as <strong>{session.user.email}</strong> — role{" "}
        <span className="rounded bg-neutral-100 px-2 py-0.5 text-sm font-mono">
          {session.user.role}
        </span>
      </p>

      {user && !user.emailVerifiedAt && <EmailVerifyBanner email={user.email} />}

      <nav className="mt-4 flex flex-col gap-1 text-sm">
        <Link href="/dashboard/articles" className="text-neutral-600 underline">
          Articles
        </Link>
        <Link href="/dashboard/comments" className="text-neutral-600 underline">
          Comment moderation
        </Link>
        <Link href="/dashboard/analytics" className="text-neutral-600 underline">
          Analytics
        </Link>
        {session.user.role === "ADMIN" && (
          <>
            <Link href="/dashboard/categories" className="text-neutral-600 underline">
              Categories
            </Link>
            <Link href="/dashboard/users" className="text-neutral-600 underline">
              People
            </Link>
            <Link href="/dashboard/audit-log" className="text-neutral-600 underline">
              Audit log
            </Link>
          </>
        )}
        <Link href="/dashboard/mfa" className="text-neutral-600 underline">
          {session.user.mfaEnabled ? "Manage two-factor authentication" : "Set up two-factor authentication"}
        </Link>
      </nav>

      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
        className="mt-6"
      >
        <button className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium">
          Log out
        </button>
      </form>
    </main>
  );
}
