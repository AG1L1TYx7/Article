import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { one } from "@/lib/searchParams";
import type { Prisma } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "Audit log", robots: { index: false, follow: false } };

const PAGE_SIZE = 50;

/**
 * Actions worth filtering to, grouped so the security-relevant ones are
 * reachable in one click rather than by knowing the string to type.
 */
const FILTERS = [
  { value: "", label: "Everything" },
  { value: "auth.", label: "Sign-ins" },
  { value: "auth.login.failed", label: "Failed sign-ins" },
  { value: "auth.login.mfa_failed", label: "Failed 2FA" },
  { value: "user.", label: "Account changes" },
  { value: "article.", label: "Articles" },
  { value: "comment.", label: "Comments" },
  { value: "mfa.", label: "Two-factor changes" },
];

export default async function AuditLogPage(props: PageProps<"/dashboard/audit-log">) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const params = await props.searchParams;
  const action = one(params.action).slice(0, 60);
  const page = Math.max(1, Number.parseInt(one(params.page), 10) || 1);

  // startsWith rather than equals so "auth." matches the whole family.
  const where: Prisma.AuditLogWhereInput = action ? { action: { startsWith: action } } : {};

  const [entries, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        metadata: true,
        ip: true,
        createdAt: true,
        actor: { select: { name: true, email: true } },
      },
    }),
    db.auditLog.count({ where }),
  ]);

  const pageCount = Math.ceil(total / PAGE_SIZE);
  const hrefFor = (next: { action?: string; page?: number }) => {
    const query = new URLSearchParams();
    const nextAction = next.action ?? action;
    if (nextAction) query.set("action", nextAction);
    if (next.page && next.page > 1) query.set("page", String(next.page));
    const qs = query.toString();
    return qs ? `/dashboard/audit-log?${qs}` : "/dashboard/audit-log";
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Audit log</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Append-only. Nothing in this application can edit or delete a row here — see the note on
        the model in prisma/schema.prisma.
      </p>

      <nav className="mt-6 flex flex-wrap gap-2 text-sm">
        {FILTERS.map((filter) => (
          <Link
            key={filter.value}
            href={hrefFor({ action: filter.value, page: 1 })}
            className={`rounded-full border px-3 py-1 ${
              action === filter.value
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-300 text-neutral-700 hover:border-neutral-500"
            }`}
          >
            {filter.label}
          </Link>
        ))}
      </nav>

      <p className="mt-4 text-sm text-neutral-500">
        {total.toLocaleString()} {total === 1 ? "entry" : "entries"}
      </p>

      {entries.length === 0 && (
        <p className="mt-8 text-neutral-600">Nothing recorded under that filter yet.</p>
      )}

      <ul className="mt-6 flex flex-col gap-2">
        {entries.map((entry) => {
          // Failed sign-ins and failed second factors are the lines an
          // admin is actually scanning for, so they are marked rather
          // than left to be spotted in a wall of identical rows.
          const alarming = entry.action.startsWith("auth.login.failed")
            || entry.action.startsWith("auth.login.mfa_failed")
            || entry.action.startsWith("auth.login.locked");

          return (
            <li
              key={entry.id}
              className={`rounded-md border px-4 py-3 text-sm ${
                alarming ? "border-amber-300 bg-amber-50" : "border-neutral-200"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-xs font-medium text-neutral-900">
                  {entry.action}
                </span>
                <span className="text-xs text-neutral-500">
                  {entry.createdAt.toLocaleString()}
                </span>
              </div>
              <p className="mt-1 text-neutral-700">
                {entry.actor.name}{" "}
                <span className="text-neutral-500">({entry.actor.email})</span>
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                {entry.targetType} {entry.targetId}
                {entry.ip && ` · ${entry.ip}`}
              </p>
              {entry.metadata !== null && entry.metadata !== undefined && (
                <pre className="mt-2 overflow-x-auto rounded bg-neutral-100 p-2 text-xs text-neutral-700">
                  {JSON.stringify(entry.metadata)}
                </pre>
              )}
            </li>
          );
        })}
      </ul>

      {pageCount > 1 && (
        <nav className="mt-8 flex items-center justify-between text-sm" aria-label="Audit log pages">
          {page > 1 ? (
            <Link href={hrefFor({ page: page - 1 })} className="hover:underline">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-neutral-500">
            Page {page} of {pageCount}
          </span>
          {page < pageCount ? (
            <Link href={hrefFor({ page: page + 1 })} className="hover:underline">
              Older →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
