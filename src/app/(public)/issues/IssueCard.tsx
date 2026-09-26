import Link from "next/link";
import type { PublicIssue } from "@/lib/issues";

/**
 * One report in a list.
 *
 * Renders `issue.reportedBy`, which is what lib/issues.ts produced — never
 * a reporter field from a row. That indirection is the whole protection:
 * this component has no way to name somebody who asked not to be named,
 * because it is never given one.
 */
export function IssueCard({
  issue,
  formatDate,
}: {
  issue: PublicIssue;
  formatDate: (d: Date | string) => string;
}) {
  const resolved = issue.status === "RESOLVED";

  return (
    <article className="card p-5 transition-colors hover:border-line-strong">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`pill ${resolved ? "pill-ok" : "pill-neutral"}`}>
          {resolved ? "Resolved" : "Verified"}
        </span>
        <span className="text-ink-2">
          {issue.district.name} · {issue.district.nameNe}
          {issue.ward ? ` · Ward ${issue.ward}` : ""}
        </span>
        {issue.category && <span className="text-ink-3">{issue.category.name}</span>}
      </div>

      <h2 className="mt-2 text-lg font-medium">
        <Link href={`/issues/${issue.slug}`} className="hover:text-link">
          {issue.title}
        </Link>
      </h2>

      <p className="mt-1 line-clamp-2 text-sm text-ink-2">{issue.body}</p>

      <p className="mt-3 text-xs text-ink-3">
        {issue.reportedBy.kind === "anonymous" ? (
          // Said plainly rather than left blank: a reader weighing a report
          // is entitled to know the difference between "anonymous" and
          // "we forgot to show who".
          <span>Reported anonymously</span>
        ) : (
          <span>
            Reported by{" "}
            <Link href={`/author/${issue.reportedBy.handle}`} className="text-link">
              {issue.reportedBy.name}
            </Link>
          </span>
        )}
        {issue.publishedAt && <span> · {formatDate(issue.publishedAt)}</span>}
        <span> · {issue.reference}</span>
      </p>
    </article>
  );
}
