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

function Delta({ current, previous }: { current: number; previous: number }) {
  const d = delta(current, previous);
  const tone = d.tone === "up" ? "text-ok" : d.tone === "down" ? "text-danger" : "text-ink-3";
  return (
    <span className={`text-xs font-medium tabular-nums ${tone}`} title={`Previous period: ${previous.toLocaleString("en-GB")}`}>
      {d.text}
    </span>
  );
}

const regionNames = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["en"], { type: "region" }) : null;

/** "FR" -> "🇫🇷 France"; "unknown" stays honest about itself. */
function countryLabel(code: string): string {
  if (code === "unknown") return "Unknown";
  const flag = code.replace(/./g, (c) => String.fromCodePoint(0x1f1e6 - 65 + c.charCodeAt(0)));
  let name = code;
  try {
    name = regionNames?.of(code) ?? code;
  } catch {
    /* an unexpected code; show it raw */
  }
  return `${flag} ${name}`;
}

function referrerLabel(value: string): string {
  return (
    { direct: "Direct / typed / app", search: "Search engines", social: "Social media", internal: "Elsewhere on this site", app: "Mobile apps" }[value] ??
    value
  );
}

function deviceLabel(value: string): string {
  return { mobile: "Phones", tablet: "Tablets", desktop: "Desktops", bot: "Bots" }[value] ?? value;
}

function formatSeconds(total: number): string {
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
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

        {/* Audience: where they are, how they arrived, what they read on. */}
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Panel title="Where readers are" sub={periodLabel}>
            {a.countries.length > 0 ? (
              <HorizontalBars
                title="Views by country"
                series={a.countries.map((c) => ({ label: countryLabel(c.label), value: c.value }))}
              />
            ) : (
              <p className="text-sm text-ink-3">
                No country data yet. The country comes from the header your CDN or host adds (Cloudflare&apos;s
                <code className="mx-1 font-mono text-xs">CF-IPCountry</code>, for instance); with nothing in front of the
                app it stays unknown. The IP itself is never stored.
              </p>
            )}
          </Panel>
          <Panel title="How readers arrive" sub={periodLabel}>
            <HorizontalBars
              title="Views by referrer"
              series={a.referrers.map((r) => ({ label: referrerLabel(r.label), value: r.value }))}
              color="var(--ink)"
            />
          </Panel>
          <Panel title="Devices" sub={periodLabel}>
            <Donut
              title="Views by device"
              series={a.devices.map((d) => ({ label: deviceLabel(d.label), value: d.value }))}
              colors={["var(--accent)", "var(--ink)", "var(--ok)", "var(--ink-3)"]}
              centre={{ value: a.devices.reduce((s, d) => s + d.value, 0).toLocaleString("en-GB"), label: "views" }}
            />
            {a.devices.some((d) => d.label === "bot") && (
              <p className="mt-3 text-xs text-ink-3">&ldquo;Bots&rdquo; are crawlers and link previews — shown so you can discount them.</p>
            )}
          </Panel>
        </div>

        {/* Reading behaviour, from the on-page beacon. */}
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Panel title="Reading" sub={periodLabel}>
            {a.reading.reads === 0 ? (
              <p className="text-sm text-ink-3">
                No reading data yet. Each article page reports, as the reader leaves, how long it was on screen and
                how far they scrolled — numbers only, nothing about the person.
              </p>
            ) : (
              <dl className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-xs text-ink-3">Average time on article</dt>
                  <dd className="mt-1 flex items-baseline gap-2">
                    <span className="text-2xl font-semibold tabular-nums">{formatSeconds(a.reading.avgSeconds)}</span>
                    <Delta current={a.reading.avgSeconds} previous={a.reading.prevAvgSeconds} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-3">Read to the end</dt>
                  <dd className="mt-1 flex items-baseline gap-2">
                    <span className="text-2xl font-semibold tabular-nums">{a.reading.completionRate}%</span>
                    <Delta current={a.reading.completionRate} previous={a.reading.prevCompletionRate} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-3">Average scroll depth</dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums">{a.reading.avgScroll}%</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-3">Reading sessions</dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums">{a.reading.reads.toLocaleString("en-GB")}</dd>
                </div>
              </dl>
            )}
          </Panel>
          <Panel title="Time spent, by article" sub={`${periodLabel} · most-read first`} className="lg:col-span-2">
            {a.articleReading.length === 0 ? (
              <p className="text-sm text-ink-3">Nothing yet.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Article</th>
                    <th className="text-right">Sessions</th>
                    <th className="text-right">Avg time</th>
                    <th className="text-right">Read to end</th>
                  </tr>
                </thead>
                <tbody>
                  {a.articleReading.map((r) => (
                    <tr key={r.id}>
                      <td className="max-w-[26rem]">
                        <Link href={`/article/${r.slug}`} className="block truncate font-medium hover:underline">
                          {r.title}
                        </Link>
                      </td>
                      <td className="text-right tabular-nums">{r.reads.toLocaleString("en-GB")}</td>
                      <td className="text-right tabular-nums whitespace-nowrap">{formatSeconds(r.avgSeconds)}</td>
                      <td className="text-right tabular-nums">
                        <span className="inline-flex items-center gap-2">
                          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
                            <span className="block h-full rounded-full bg-ok" style={{ width: `${r.completionRate}%` }} />
                          </span>
                          {r.completionRate}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
