import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { UserRow } from "./UserRow";

export const metadata: Metadata = { title: "People", robots: { index: false, follow: false } };

const PAGE_SIZE = 100;

export default async function UsersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // proxy.ts already gates /dashboard/users to admins. Checked again here
  // because a route guard is a convenience, not the authority — see the
  // note in lib/auth/rbac.ts.
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const [users, activeAdmins] = await Promise.all([
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
  ]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="text-2xl font-semibold">People</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Roles take effect immediately — changing one signs that person out everywhere, so their
        next request uses the new role rather than a cached one.
      </p>

      {activeAdmins === 1 && (
        <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          There is only one active admin. Promote a second before changing that account — losing
          the last one can only be undone from a shell on the server.
        </p>
      )}

      <div className="mt-8 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-300 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="py-2 pr-4">Person</th>
              <th className="py-2 pr-4">Role</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Wrote</th>
              <th className="py-2 pr-4">Last seen</th>
              <th className="py-2">Actions</th>
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
        <p className="mt-4 text-sm text-neutral-500">
          Showing the first {PAGE_SIZE} accounts.
        </p>
      )}
    </main>
  );
}
