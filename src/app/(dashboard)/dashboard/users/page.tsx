import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { one } from "@/lib/searchParams";
import type { Prisma } from "@/generated/prisma/client";
import { UserRow } from "./UserRow";
import { PageBody, PageHeader } from "../../PageHeader";
import { SearchIcon } from "@/components/icons";

export const metadata: Metadata = { title: "People", robots: { index: false, follow: false } };

const PAGE_SIZE = 100;
const ROLES = ["ADMIN", "MODERATOR", "READER"] as const;
const STATUSES = ["ACTIVE", "SUSPENDED", "BANNED"] as const;

export default async function UsersPage(props: PageProps<"/dashboard/users">) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // proxy.ts already gates /dashboard/users to admins. Checked again here
  // because a route guard is a convenience, not the authority — see the
  // note in lib/auth/rbac.ts.
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const params = await props.searchParams;
  const q = one(params.q).trim().slice(0, 80);
  const role = ROLES.find((r) => r === one(params.role)) ?? "";
  const status = STATUSES.find((s) => s === one(params.status)) ?? "";

  const where: Prisma.UserWhereInput = {
    ...(role ? { role } : {}),
    ...(status ? { status } : {}),
    ...(q
      ? { OR: [{ name: { contains: q } }, { email: { contains: q } }, { handle: { contains: q } }] }
      : {}),
  };

  const [users, total, activeAdmins, counts] = await Promise.all([
    db.user.findMany({
      where,
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
    db.user.count({ where }),
    db.user.count({ where: { role: "ADMIN", status: "ACTIVE" } }),
    db.user.groupBy({ by: ["role"], _count: { _all: true } }),
  ]);

  const countFor = (r: string) => counts.find((c) => c.role === r)?._count._all ?? 0;
  const hrefFor = (next: { q?: string; role?: string; status?: string }) => {
    const query = new URLSearchParams();
    const nq = next.q ?? q;
    const nr = next.role ?? role;
    const ns = next.status ?? status;
    if (nq) query.set("q", nq);
    if (nr) query.set("role", nr);
    if (ns) query.set("status", ns);
    const qs = query.toString();
    return qs ? `/dashboard/users?${qs}` : "/dashboard/users";
  };
  const filtered = !!(q || role || status);

  return (
    <main id="main-content">
      <PageHeader
        kicker="Site"
        title="People"
        description={
          <>
            {countFor("ADMIN")} admins · {countFor("MODERATOR")} moderators · {countFor("READER")} readers.
            Roles take effect immediately — changing one signs that person out everywhere.
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

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <form action="/dashboard/users" method="get" className="relative">
            {role && <input type="hidden" name="role" value={role} />}
            {status && <input type="hidden" name="status" value={status} />}
            <label htmlFor="people-search" className="sr-only">
              Search people
            </label>
            <SearchIcon size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
            <input
              id="people-search"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Name, email or handle"
              className="input w-64 pl-9"
            />
          </form>
          <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
          <Link href={hrefFor({ role: "" })} className={`btn btn-sm rounded-full ${role ? "btn-secondary" : "btn-primary"}`}>
            All roles
          </Link>
          {ROLES.map((r) => (
            <Link
              key={r}
              href={hrefFor({ role: r })}
              className={`btn btn-sm rounded-full ${role === r ? "btn-primary" : "btn-secondary"}`}
            >
              {r === "MODERATOR" ? "Writers" : r === "ADMIN" ? "Admins" : "Readers"}
            </Link>
          ))}
          <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
          {STATUSES.filter((s) => s !== "ACTIVE").map((s) => (
            <Link
              key={s}
              href={hrefFor({ status: status === s ? "" : s })}
              className={`btn btn-sm rounded-full ${status === s ? "btn-primary" : "btn-ghost"}`}
            >
              {s === "SUSPENDED" ? "Suspended" : "Banned"}
            </Link>
          ))}
          {filtered && (
            <Link href="/dashboard/users" className="btn btn-sm btn-ghost ml-auto">
              Clear filters
            </Link>
          )}
        </div>

        <p className="mb-3 text-xs text-ink-3">
          {total.toLocaleString("en-GB")} {total === 1 ? "person" : "people"}
          {filtered ? " match" : ""}
          {users.length < total ? ` · showing the first ${PAGE_SIZE}` : ""}
        </p>

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
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-ink-3">
                    Nobody matches that.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </PageBody>
    </main>
  );
}
