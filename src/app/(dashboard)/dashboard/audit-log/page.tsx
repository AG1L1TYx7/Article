import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { sessionHas } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { one } from "@/lib/searchParams";
import type { Prisma } from "@/generated/prisma/client";
import { PageBody, PageHeader } from "../../PageHeader";
import { ArrowLeftIcon, ArrowRightIcon } from "@/components/icons";
import { formatDateTime, plural } from "@/lib/format";

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
  // The permission, not the tier. An administrator may deliberately create
  // a role that holds other administrative powers but NOT auditlog.view —
  // the log names every actor and their IP, and that is its own decision to
  // grant. Checking the tier here quietly ignored that decision.
  if (!sessionHas(session, "auditlog.view")) redirect("/dashboard");

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
    <main id="main-content">
      <PageHeader
        kicker="Security"
        title="Audit log"
        description="Append-only. Nothing in this application can edit or delete a row here — see the note on the model in prisma/schema.prisma."
      />

      <PageBody>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((filter) => (
            <Link
              key={filter.value}
              href={hrefFor({ action: filter.value, page: 1 })}
              aria-current={action === filter.value ? "page" : undefined}
              className={`btn btn-sm rounded-full ${
                action === filter.value ? "btn-primary" : "btn-secondary"
              }`}
            >
              {filter.label}
            </Link>
          ))}
        </div>

        <p className="mt-4 text-sm text-ink-3">{plural(total, "entry", "entries")}</p>

        {entries.length === 0 && (
          <p className="card mt-6 px-4 py-10 text-center text-sm text-ink-3">
            Nothing recorded under that filter yet.
          </p>
        )}

        {entries.length > 0 && (
          <ul className="card mt-4 divide-y divide-line">
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
                  className={`px-4 py-3 text-sm ${alarming ? "border-l-4 border-l-warn bg-warn-soft/40" : ""}`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-ink">{entry.action}</span>
                    <time dateTime={entry.createdAt.toISOString()} className="text-xs text-ink-3">
                      {formatDateTime(entry.createdAt)}
                    </time>
                  </div>
                  <p className="mt-1 text-ink-2">
                    {entry.actor.name} <span className="text-ink-3">({entry.actor.email})</span>
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-ink-3">
                    {entry.targetType} {entry.targetId}
                    {entry.ip && ` · ${entry.ip}`}
                  </p>
                  {entry.metadata !== null && entry.metadata !== undefined && (
                    <pre className="mt-2 overflow-x-auto rounded bg-surface-2 p-2 font-mono text-[11px] text-ink-2">
                      {JSON.stringify(entry.metadata)}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {pageCount > 1 && (
          <nav className="mt-6 flex items-center justify-between text-sm" aria-label="Audit log pages">
            {page > 1 ? (
              <Link href={hrefFor({ page: page - 1 })} className="btn btn-secondary btn-sm gap-1.5">
                <ArrowLeftIcon size={14} /> Newer
              </Link>
            ) : (
              <span />
            )}
            <span className="text-ink-3">
              Page {page} of {pageCount}
            </span>
            {page < pageCount ? (
              <Link href={hrefFor({ page: page + 1 })} className="btn btn-secondary btn-sm gap-1.5">
                Older <ArrowRightIcon size={14} />
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </PageBody>
    </main>
  );
}
