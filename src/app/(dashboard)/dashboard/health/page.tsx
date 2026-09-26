import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { runHealthChecks, type Check, type Group } from "@/lib/health/checks";
import type { Status } from "@/lib/health/grade";
import { PageBody, PageHeader } from "../../PageHeader";
import { RunAgainButton } from "./RunAgainButton";

export const metadata: Metadata = { title: "System health", robots: { index: false, follow: false } };

/**
 * Everything about the running site an administrator would want to see
 * when something feels wrong, on one page, measured when it is opened.
 *
 * Admins only, deliberately. A list of what is weak about a site (an
 * outdated package, a missing setting, how many failed sign-ins there
 * were) is a to-do list for an attacker, so none of it goes near the
 * public /api/health, which says only "up" or "down".
 */
export const dynamic = "force-dynamic";

const GROUPS: Group[] = ["Security", "Database", "Configuration", "Application", "Storage"];

const STATUS_COPY: Record<Status, { label: string; pill: string; bar: string }> = {
  fail: { label: "Problem", pill: "pill-danger", bar: "bg-danger" },
  warn: { label: "Check", pill: "pill-warn", bar: "bg-warn" },
  ok: { label: "OK", pill: "pill-ok", bar: "bg-ok" },
  info: { label: "Info", pill: "pill-neutral", bar: "bg-line-strong" },
};

const ORDER: Record<Status, number> = { fail: 0, warn: 1, info: 2, ok: 3 };

function Row({ check }: { check: Check }) {
  const copy = STATUS_COPY[check.status];
  return (
    <li className="relative grid gap-1 py-4 pl-4 sm:grid-cols-[11rem_1fr] sm:gap-4">
      {/* Colour AND a word: the state is readable without seeing colour. */}
      <span aria-hidden className={`absolute top-4 bottom-4 left-0 w-1 rounded-full ${copy.bar}`} />
      <div className="flex items-start justify-between gap-2 sm:flex-col sm:justify-start">
        <span className="text-sm font-medium">{check.title}</span>
        <span className={`pill ${copy.pill}`}>{copy.label}</span>
      </div>
      <div className="min-w-0">
        <p className="text-sm">{check.summary}</p>
        {check.details && check.details.length > 0 && (
          <ul className="mt-1.5 flex flex-col gap-0.5 text-[13px] text-ink-3">
            {check.details.map((d, i) => (
              <li key={i} className="break-words">
                {d.startsWith("https://") ? (
                  <a href={d} className="text-link" target="_blank" rel="noreferrer">
                    {d.replace("https://github.com/", "")}
                  </a>
                ) : (
                  d
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

export default async function HealthPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?from=/dashboard/health");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const report = await runHealthChecks();
  const count = (s: Status) => report.checks.filter((c) => c.status === s).length;
  const headline =
    report.overall === "fail"
      ? `${count("fail")} problem${count("fail") === 1 ? "" : "s"} need${count("fail") === 1 ? "s" : ""} attention`
      : report.overall === "warn"
        ? `Working, with ${count("warn")} thing${count("warn") === 1 ? "" : "s"} to check`
        : "Everything checked is healthy";
  const checkedAt = new Date(report.checkedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" });

  return (
    <>
      <PageHeader
        kicker="Administration"
        title="System health"
        description="Measured now, each time this page opens. Only administrators can see it; the public health check reports only whether the site is up."
        actions={<RunAgainButton />}
      />
      <PageBody>
        <section
          aria-label="Summary"
          className={`alert ${report.overall === "fail" ? "alert-danger" : report.overall === "warn" ? "alert-warn" : "alert-ok"} flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1`}
        >
          <p className="text-base font-medium">{headline}</p>
          <p className="text-sm tabular-nums">
            {count("fail")} problem{count("fail") === 1 ? "" : "s"} · {count("warn")} to check · {count("ok")} OK · checked {checkedAt} UTC
          </p>
        </section>

        {GROUPS.map((group) => {
          const checks = report.checks.filter((c) => c.group === group).sort((a, b) => ORDER[a.status] - ORDER[b.status]);
          if (!checks.length) return null;
          return (
            <section key={group} aria-labelledby={`health-${group}`} className="card mt-6 px-5 py-2">
              <h2 id={`health-${group}`} className="pt-3 text-lg font-medium">
                {group}
              </h2>
              <ul className="divide-y divide-line">
                {checks.map((c) => (
                  <Row key={c.id} check={c} />
                ))}
              </ul>
            </section>
          );
        })}
      </PageBody>
    </>
  );
}
