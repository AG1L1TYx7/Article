import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { UserRow } from "./UserRow";
import { PageBody, PageHeader } from "../../PageHeader";

export const metadata: Metadata = { title: "People", robots: { index: false, follow: false } };

const PAGE_SIZE = 100;

export default async function UsersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // proxy.ts already gates /dashboard/users to admins. Checked again here
  // because a route guard is a convenience, not the authority — see the
  // note in lib/auth/rbac.ts.
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const [users, activeAdmins, counts] = await Promise.all([
    db.user.findMany({
      orderBy: [{ role: "asc" }, { createdAt: "desc" }],
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        email: true,
        handle: true,
        role: true,
        status: true,
        mfaEnabled: true,
        emailVerifiedAt: true,
        createdAt: true,
        lastLoginAt: true,
        _count: { select: { articles: true, comments: true } },
      },
    }),
    db.user.count({ where: { role: "ADMIN", status: "ACTIVE" } }),
    db.user.groupBy({ by: ["role"], _count: { _all: true } }),
  ]);

  const countFor = (role: string) => counts.find((c) => c.role === role)?._count._all ?? 0;

  return (
    <main id="main-content">
      <PageHeader
        kicker="Site"
        title="People"
        description={
          <>
            {countFor("ADMIN")} admins · {countFor("MODERATOR")} moderators · {countFor("READER")} readers.
            Roles take effect immediately — changing one signs that person out everywhere, so their
            next request uses the new role rather than a cached one.
          </>
        }
      />

      <PageBody>
        {activeAdmins === 1 && (
          <p className="alert alert-warn mb-6">
            There is only one active admin. Promote a second before changing that account — losing
            the last one can only be undone from a shell on the server.
          </p>
        )}

        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="pl-4">Person</th>
                <th>Role</th>
                <th>Status</th>
                <th>Wrote</th>
                <th>Last seen</th>
                <th className="pr-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <UserRow
                  key={user.id}
                  user={{
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    handle: user.handle,
                    role: user.role,
                    status: user.status,
                    mfaEnabled: user.mfaEnabled,
                    verified: user.emailVerifiedAt !== null,
                    articles: user._count.articles,
                    comments: user._count.comments,
                    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
                  }}
                  isSelf={user.id === session.user.id}
                />
              ))}
            </tbody>
          </table>
        </div>

        {users.length === PAGE_SIZE && (
          <p className="mt-4 text-sm text-ink-3">
            Showing the first {PAGE_SIZE} accounts.
          </p>
        )}
      </PageBody>
    </main>
  );
}
