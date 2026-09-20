import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { daysAgo } from "@/lib/timeWindow";

export const metadata: Metadata = { title: "Analytics", robots: { index: false, follow: false } };

const TOP_N = 10;

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-md border border-neutral-200 px-4 py-3">
      <p className="text-2xl font-semibold text-neutral-900">{value.toLocaleString()}</p>
      <p className="text-sm text-neutral-600">{label}</p>
      {hint && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
    </div>
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
    <main className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Analytics</h1>
      <p className="mt-2 text-sm text-neutral-600">
        View counts are raw request counts — a refresh counts twice and a crawler counts as a
        reader. Useful for ranking these against each other, not for reporting an audience.
      </p>

      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Published" value={publishedCount} hint={`${publishedThisWeek} in the last 7 days`} />
        <Stat label="Drafts" value={draftCount} />
        <Stat label="Readers" value={readerCount} />
        <Stat label="Comments awaiting review" value={pendingComments} />
        <Stat label="Open reports" value={openReports} />
      </div>

      {(pendingComments > 0 || openReports > 0) && (
        <p className="mt-4 text-sm">
          <Link href="/dashboard/comments" className="underline">
            Go to the moderation queue →
          </Link>
        </p>
      )}

      <h2 className="mt-12 text-lg font-semibold">Most read</h2>
      {mostRead.length === 0 && <p className="mt-2 text-sm text-neutral-500">Nothing published yet.</p>}
      <ol className="mt-3 flex flex-col gap-2">
        {mostRead.map((article) => (
          <li key={article.id} className="flex items-baseline justify-between gap-4 text-sm">
            <Link href={`/article/${article.slug}`} className="truncate hover:underline">
              {article.title}
            </Link>
            <span className="shrink-0 text-neutral-500">
              {article.viewCount.toLocaleString()} view{article.viewCount === 1 ? "" : "s"}
            </span>
          </li>
        ))}
      </ol>

      <h2 className="mt-12 text-lg font-semibold">Most discussed</h2>
      {mostDiscussed.length === 0 && <p className="mt-2 text-sm text-neutral-500">Nothing yet.</p>}
      <ol className="mt-3 flex flex-col gap-2">
        {mostDiscussed.map((article) => (
          <li key={article.id} className="flex items-baseline justify-between gap-4 text-sm">
            <Link href={`/article/${article.slug}`} className="truncate hover:underline">
              {article.title}
            </Link>
            <span className="shrink-0 text-neutral-500">
              {article._count.comments} comment{article._count.comments === 1 ? "" : "s"} ·{" "}
              {article._count.reactions} like{article._count.reactions === 1 ? "" : "s"}
            </span>
          </li>
        ))}
      </ol>
    </main>
  );
}
