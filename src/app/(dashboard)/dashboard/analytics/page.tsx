import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { daysAgo } from "@/lib/timeWindow";
import { PageBody, PageHeader } from "../../PageHeader";
import { ArrowRightIcon } from "@/components/icons";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Analytics", robots: { index: false, follow: false } };

const TOP_N = 10;

function Stat({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: "warn" }) {
  return (
    <div className={`card px-5 py-4 ${tone === "warn" && value > 0 ? "border-warn/40" : ""}`}>
      <p className="text-3xl font-semibold tracking-tight tabular-nums">{value.toLocaleString("en-GB")}</p>
      <p className="mt-1 text-sm text-ink-2">{label}</p>
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

/** A ranked list with a bar behind each row, scaled to the top entry. */
function Ranked({
  items,
  empty,
}: {
  items: { id: string; slug: string; title: string; value: number; detail: string }[];
  empty: string;
}) {
  if (items.length === 0) return <p className="card mt-4 px-4 py-8 text-center text-sm text-ink-3">{empty}</p>;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ol className="card mt-4 divide-y divide-line">
      {items.map((item, index) => (
        <li key={item.id} className="relative flex items-center gap-4 px-4 py-3">
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 bg-surface-2"
            style={{ width: `${(item.value / max) * 100}%` }}
          />
          <span className="relative w-5 text-right font-mono text-xs text-ink-3">{index + 1}</span>
          <Link href={`/article/${item.slug}`} className="relative min-w-0 flex-1 truncate text-sm font-medium hover:underline">
            {item.title}
          </Link>
          <span className="relative shrink-0 text-xs text-ink-2 tabular-nums">{item.detail}</span>
        </li>
      ))}
    </ol>
  );
}

export default async function AnalyticsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Staff, not admin-only: a moderator writing articles has a legitimate
  // reason to see how they are doing.
  if (session.user.role !== "ADMIN" && session.user.role !== "MODERATOR") redirect("/dashboard");

  const weekAgo = daysAgo(7);

  const [
    publishedCount,
    draftCount,
    readerCount,
    pendingComments,
    openReports,
    publishedThisWeek,
    mostRead,
    mostDiscussed,
  ] = await Promise.all([
    db.article.count({ where: { status: "PUBLISHED" } }),
    db.article.count({ where: { status: "DRAFT" } }),
    db.user.count({ where: { role: "READER", status: "ACTIVE" } }),
    db.comment.count({ where: { status: "PENDING" } }),
    db.report.count({ where: { status: "OPEN" } }),
    db.article.count({ where: { status: "PUBLISHED", publishedAt: { gte: weekAgo } } }),
    db.article.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { viewCount: "desc" },
      take: TOP_N,
      select: {
        id: true,
        slug: true,
        title: true,
        viewCount: true,
        publishedAt: true,
        author: { select: { name: true } },
      },
    }),
    db.article.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { comments: { _count: "desc" } },
      take: TOP_N,
      select: {
        id: true,
        slug: true,
        title: true,
        _count: { select: { comments: true, reactions: true } },
      },
    }),
  ]);

  return (
    <main id="main-content">
      <PageHeader
        kicker="Newsroom"
        title="Analytics"
        description="View counts are raw request counts — a refresh counts twice and a crawler counts as a reader. Useful for ranking these against each other, not for reporting an audience."
      />

      <PageBody>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Published" value={publishedCount} hint={`${publishedThisWeek} in the last 7 days`} />
          <Stat label="Drafts" value={draftCount} />
          <Stat label="Readers" value={readerCount} />
          <Stat label="Comments awaiting review" value={pendingComments} tone="warn" />
          <Stat label="Open reports" value={openReports} tone="warn" />
        </div>

        {(pendingComments > 0 || openReports > 0) && (
          <p className="mt-4">
            <Link href="/dashboard/comments" className="btn btn-secondary btn-sm gap-1.5">
              Go to the moderation queue <ArrowRightIcon size={14} />
            </Link>
          </p>
        )}

        <div className="mt-10 grid gap-10 lg:grid-cols-2">
          <section aria-labelledby="most-read-heading">
            <h2 id="most-read-heading" className="section-title">
              Most read
            </h2>
            <Ranked
              empty="Nothing published yet."
              items={mostRead.map((a) => ({
                id: a.id,
                slug: a.slug,
                title: a.title,
                value: a.viewCount,
                detail: `${a.viewCount.toLocaleString("en-GB")} view${a.viewCount === 1 ? "" : "s"}${
                  a.publishedAt ? ` · ${formatDate(a.publishedAt)}` : ""
                }`,
              }))}
            />
          </section>

          <section aria-labelledby="most-discussed-heading">
            <h2 id="most-discussed-heading" className="section-title">
              Most discussed
            </h2>
            <Ranked
              empty="Nothing yet."
              items={mostDiscussed.map((a) => ({
                id: a.id,
                slug: a.slug,
                title: a.title,
                value: a._count.comments,
                detail: `${a._count.comments} comment${a._count.comments === 1 ? "" : "s"} · ${a._count.reactions} like${
                  a._count.reactions === 1 ? "" : "s"
                }`,
              }))}
            />
          </section>
        </div>
      </PageBody>
    </main>
  );
}
