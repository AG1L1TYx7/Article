import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { one } from "@/lib/searchParams";
import { delta, loadAnalytics, RANGES, type Ranked, type RangeDays } from "@/lib/analytics";
import { AreaChart, BarChart, Donut, HorizontalBars } from "@/components/charts/Charts";
import { PageBody, PageHeader } from "../../PageHeader";
import { ArrowRightIcon } from "@/components/icons";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Analytics", robots: { index: false, follow: false } };

function Kpi({ label, value, previous, hint }: { label: string; value: number; previous: number; hint?: string }) {
  const d = delta(value, previous);
  const tone = d.tone === "up" ? "text-ok" : d.tone === "down" ? "text-danger" : "text-ink-3";
  return (
    <div className="card px-5 py-4">
      <p className="text-sm text-ink-2">{label}</p>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="text-3xl font-semibold tracking-tight tabular-nums">{value.toLocaleString("en-GB")}</span>
        <span className={`text-xs font-medium tabular-nums ${tone}`} title={`Previous period: ${previous.toLocaleString("en-GB")}`}>
          {d.text}
        </span>
      </p>
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

function Ranking({ items, empty }: { items: Ranked[]; empty: string }) {
  if (items.length === 0) return <p className="card mt-4 px-4 py-8 text-center text-sm text-ink-3">{empty}</p>;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ol className="card mt-4 divide-y divide-line">
      {items.map((item, index) => (
        <li key={item.id} className="relative flex items-center gap-4 px-4 py-3">
          <span aria-hidden="true" className="absolute inset-y-0 left-0 bg-surface-2" style={{ width: `${(item.value / max) * 100}%` }} />
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

function Panel({ title, sub, children, className = "" }: { title: string; sub?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card p-5 ${className}`} aria-label={title}>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {sub && <span className="text-xs text-ink-3">{sub}</span>}
      </div>
      {children}
    </section>
  );
}

export default async function AnalyticsPage(props: PageProps<"/dashboard/analytics">) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Staff, not admin-only: a moderator writing articles has a legitimate
  // reason to see how they are doing.
  if (session.user.role !== "ADMIN" && session.user.role !== "MODERATOR") redirect("/dashboard");

  const params = await props.searchParams;
  const requested = Number(one(params.range));
  const days: RangeDays = (RANGES as readonly number[]).includes(requested) ? (requested as RangeDays) : 30;

  const a = await loadAnalytics(days);
  const periodLabel = `last ${days} days`;

  return (
    <main id="main-content">
      <PageHeader
        kicker="Newsroom"
        title="Analytics"
        description={`What readers did in the ${periodLabel}, compared with the ${days} days before. View counts are raw requests — a refresh counts twice and a crawler counts as a reader — so use them to rank, not to report an audience.`}
        actions={
          <div className="flex gap-1" role="group" aria-label="Period">
            {RANGES.map((r) => (
              <Link
                key={r}
                href={r === 30 ? "/dashboard/analytics" : `/dashboard/analytics?range=${r}`}
                aria-current={days === r ? "page" : undefined}
                className={`btn btn-sm rounded-full ${days === r ? "btn-primary" : "btn-secondary"}`}
              >
                {r} days
              </Link>
            ))}
          </div>
        }
      />

      <PageBody>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Kpi label="Views" value={a.totals.views} previous={a.totals.prevViews} hint={a.hasDailyViews ? undefined : "Counting per day started today"} />
          <Kpi label="Published" value={a.totals.published} previous={a.totals.prevPublished} />
          <Kpi label="New readers" value={a.totals.newReaders} previous={a.totals.prevNewReaders} />
          <Kpi label="Comments" value={a.totals.comments} previous={a.totals.prevComments} />
          <Kpi label="Likes" value={a.totals.likes} previous={a.totals.prevLikes} />
        </div>

        {(a.allTime.pendingComments > 0 || a.allTime.openReports > 0) && (
          <p className="alert alert-warn mt-4 flex flex-wrap items-center justify-between gap-2">
            <span>
              {a.allTime.pendingComments} comment{a.allTime.pendingComments === 1 ? "" : "s"} awaiting review · {a.allTime.openReports} open report
              {a.allTime.openReports === 1 ? "" : "s"}
            </span>
            <Link href="/dashboard/comments" className="btn btn-sm btn-primary gap-1.5">
              Moderation queue <ArrowRightIcon size={14} />
            </Link>
          </p>
        )}

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <Panel title="Views per day" sub={`solid: ${periodLabel} · dotted: the ${days} before`} className="lg:col-span-2">
            <AreaChart title="Views per day" series={a.viewsByDay} compare={a.prevViewsByDay} />
            {!a.hasDailyViews && (
              <p className="mt-3 text-xs text-ink-3">
                Per-day counting began on {formatDate(new Date())}; the line fills in from here. The all-time
                totals below already cover everything published.
              </p>
            )}
          </Panel>
          <Panel title="Engagement mix" sub={periodLabel}>
            <Donut
              title="Engagement mix"
              series={a.engagementMix}
              centre={{ value: a.engagementMix.reduce((s, p) => s + p.value, 0).toLocaleString("en-GB"), label: "actions" }}
            />
          </Panel>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Panel title="Articles published" sub="per day">
            <BarChart title="Articles published per day" series={a.publishedByDay} height={150} width={360} labelEvery={Math.ceil(days / 4)} />
          </Panel>
          <Panel title="Comments" sub="approved, per day">
            <BarChart title="Comments per day" series={a.commentsByDay} height={150} width={360} color="var(--accent)" labelEvery={Math.ceil(days / 4)} />
          </Panel>
          <Panel title="New readers" sub="registrations, per day">
            <BarChart title="New readers per day" series={a.readersByDay} height={150} width={360} color="var(--ok)" labelEvery={Math.ceil(days / 4)} />
          </Panel>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Panel title="Views by section" sub="all time">
            <HorizontalBars title="Views by section" series={a.viewsBySection} />
          </Panel>
          <Panel title="Views by writer" sub="all time">
            <HorizontalBars title="Views by writer" series={a.viewsByAuthor} color="var(--ink)" />
          </Panel>
        </div>

        <div className="mt-8 grid gap-10 lg:grid-cols-2">
          {a.trending.length > 0 && (
            <section aria-labelledby="trending-heading">
              <h2 id="trending-heading" className="section-title">
                Trending
              </h2>
              <p className="mt-1 text-xs text-ink-3">Most viewed in the {periodLabel}.</p>
              <Ranking items={a.trending} empty="Nothing yet." />
            </section>
          )}
          <section aria-labelledby="most-read-heading">
            <h2 id="most-read-heading" className="section-title">
              Most read
            </h2>
            <p className="mt-1 text-xs text-ink-3">All time.</p>
            <Ranking items={a.mostRead} empty="Nothing published yet." />
          </section>
          <section aria-labelledby="most-discussed-heading">
            <h2 id="most-discussed-heading" className="section-title">
              Most discussed
            </h2>
            <p className="mt-1 text-xs text-ink-3">All time.</p>
            <Ranking items={a.mostDiscussed} empty="Nothing yet." />
          </section>
        </div>

        <p className="mt-10 text-xs text-ink-3">
          Library: {a.allTime.published.toLocaleString("en-GB")} published · {a.allTime.drafts} drafts · {a.allTime.scheduled} scheduled ·{" "}
          {a.allTime.readers.toLocaleString("en-GB")} active readers.
        </p>
      </PageBody>
    </main>
  );
}
