import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { EmailVerifyBanner } from "./EmailVerifyBanner";
import { PageBody, PageHeader } from "../PageHeader";
import { ArrowRightIcon, PlusIcon, ShieldIcon } from "@/components/icons";
import { formatDate, formatDateTime, formatRelative } from "@/lib/format";
import { daysAgo } from "@/lib/timeWindow";
import { StatusPill } from "./articles/StatusPill";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false, follow: false } };

/**
 * One thing that needs a person, with a number, a reason and a way in.
 * The left stripe is the only colour on the card, and it means the same
 * as the status pills everywhere else: amber for waiting, slate for
 * scheduled, crimson for something reported.
 */
function Attention({
  tone,
  title,
  detail,
  href,
  action,
}: {
  tone: "warn" | "info" | "danger" | "ok";
  title: string;
  detail: string;
  href: string;
  action: string;
}) {
  const stripe = { warn: "border-l-warn", info: "border-l-info", danger: "border-l-danger", ok: "border-l-ok" }[tone];
  return (
    <div className={`card border-l-[3px] px-5 py-4 ${stripe}`}>
      <p className="text-[15px] font-semibold">{title}</p>
      <p className="mt-1 text-sm text-ink-2">{detail}</p>
      <Link href={href} className="btn btn-secondary btn-sm mt-4 gap-1">
        {action} <ArrowRightIcon size={14} />
      </Link>
    </div>
  );
}

/** Views per day for the last seven days, as a small area chart. */
function Sparkline({ points }: { points: number[] }) {
  const w = 320;
  const h = 64;
  const max = Math.max(1, ...points);
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const coords = points.map((v, i) => [i * step, h - 6 - (v / max) * (h - 12)] as const);
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 block h-16 w-full" aria-hidden="true">
      <path d={`${line} V${h} H0 Z`} fill="var(--info)" fillOpacity="0.14" />
      <path d={line} fill="none" stroke="var(--info)" strokeWidth="2" strokeLinejoin="round" />
      {last && <circle cx={last[0]} cy={last[1]} r="4" fill="var(--info)" stroke="var(--surface)" strokeWidth="2" />}
    </svg>
  );
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const isAdmin = session.user.role === "ADMIN";
  const mine = { authorId: session.user.id };
  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setUTCHours(23, 59, 59, 999);
  const weekStart = daysAgo(6);
  weekStart.setUTCHours(0, 0, 0, 0);
  const prevWeekStart = daysAgo(13);
  prevWeekStart.setUTCHours(0, 0, 0, 0);

  const [user, pendingComments, oldestPending, scheduledToday, nextScheduled, openReports, drafts, weekViews, prevWeekViews] =
    await Promise.all([
      db.user.findUnique({ where: { id: session.user.id }, select: { email: true, emailVerifiedAt: true } }),
      db.comment.count({ where: { status: "PENDING" } }),
      db.comment.findFirst({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
      db.article.count({ where: { status: "SCHEDULED", scheduledFor: { lte: endOfToday } } }),
      db.article.findFirst({
        where: { status: "SCHEDULED" },
        orderBy: { scheduledFor: "asc" },
        select: { title: true, scheduledFor: true },
      }),
      db.report.count({ where: { status: "OPEN" } }),
      db.article.findMany({
        where: { ...(isAdmin ? {} : mine), status: { in: ["DRAFT", "SCHEDULED"] } },
        orderBy: { updatedAt: "desc" },
        take: 6,
        select: {
          id: true,
          title: true,
          status: true,
          updatedAt: true,
          scheduledFor: true,
          author: { select: { name: true } },
          category: { select: { name: true } },
        },
      }),
      db.articleViewDaily.groupBy({
        by: ["day"],
        where: { day: { gte: weekStart }, ...(isAdmin ? {} : { article: mine }) },
        _sum: { views: true },
        orderBy: { day: "asc" },
      }),
      db.articleViewDaily.aggregate({
        where: { day: { gte: prevWeekStart, lt: weekStart }, ...(isAdmin ? {} : { article: mine }) },
        _sum: { views: true },
      }),
    ]);

  // Seven points, one per day, zero where nothing was counted.
  const byDay = new Map(weekViews.map((r) => [r.day.toISOString().slice(0, 10), r._sum.views ?? 0]));
  const points = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + i);
    return byDay.get(d.toISOString().slice(0, 10)) ?? 0;
  });
  const weekTotal = points.reduce((a, b) => a + b, 0);
  const prevTotal = prevWeekViews._sum.views ?? 0;
  const change = prevTotal > 0 ? Math.round(((weekTotal - prevTotal) / prevTotal) * 100) : null;

  const firstName = session.user.name?.split(" ")[0] ?? "there";
  const hour = now.getUTCHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const quiet = pendingComments === 0 && scheduledToday === 0 && openReports === 0;

  return (
    <main id="main-content">
      <PageHeader
        kicker={formatDate(now)}
        title={`${greeting}, ${firstName}.`}
        description={
          <>
            Signed in as <strong className="text-ink">{session.user.email}</strong> ·{" "}
            <span className="pill pill-neutral align-middle">{session.user.role}</span>
          </>
        }
        actions={
          <Link href="/dashboard/articles/new" className="btn btn-primary gap-1.5">
            <PlusIcon size={16} /> New article
          </Link>
        }
      />

      <PageBody>
        {user && !user.emailVerifiedAt && <EmailVerifyBanner email={user.email} />}

        {!session.user.mfaEnabled && (
          <div className="alert alert-warn mb-6 flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <ShieldIcon size={16} /> Newsroom accounts must enable two-factor authentication.
            </span>
            <Link href="/dashboard/mfa" className="btn btn-sm btn-primary">
              Set it up
            </Link>
          </div>
        )}

        <section aria-labelledby="attention-heading">
          <h2 id="attention-heading" className="kicker mb-3">
            Needs attention
          </h2>
          {quiet ? (
            <div className="card border-l-[3px] border-l-ok px-5 py-4">
              <p className="text-[15px] font-semibold text-ok">Nothing waiting — nice work.</p>
              <p className="mt-1 text-sm text-ink-2">No comments in the queue, nothing reported, nothing scheduled for today.</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              <Attention
                tone={pendingComments > 0 ? "warn" : "ok"}
                title={pendingComments === 0 ? "Queue clear" : `${pendingComments} comment${pendingComments === 1 ? "" : "s"} waiting`}
                detail={
                  oldestPending
                    ? `Oldest has waited ${formatRelative(oldestPending.createdAt, now).replace(" ago", "")}. Held comments show why.`
                    : "Nothing is waiting for review."
                }
                href="/dashboard/comments"
                action="Open queue"
              />
              <Attention
                tone="info"
                title={
                  scheduledToday === 0
                    ? "Nothing scheduled today"
                    : `${scheduledToday} stor${scheduledToday === 1 ? "y goes" : "ies go"} live today`
                }
                detail={
                  nextScheduled?.scheduledFor
                    ? `Next: “${nextScheduled.title}” at ${formatDateTime(nextScheduled.scheduledFor)}.`
                    : "Schedule a draft from its edit page to publish it later."
                }
                href="/dashboard/articles"
                action="See schedule"
              />
              <Attention
                tone={openReports > 0 ? "danger" : "ok"}
                title={openReports === 0 ? "No open reports" : `${openReports} report${openReports === 1 ? "" : "s"} to review`}
                detail={
                  openReports > 0
                    ? "Readers flagged comments. A repeated reporter on one thread is worth a look."
                    : "Readers have not flagged anything recently."
                }
                href="/dashboard/comments?tab=reported"
                action="Look now"
              />
            </div>
          )}
        </section>

        <div className="mt-10 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <section aria-labelledby="drafts-heading" className="card">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 id="drafts-heading" className="font-semibold">
                {isAdmin ? "Drafts and scheduled" : "Your drafts and scheduled"}
              </h2>
              <Link href="/dashboard/articles" className="text-link text-sm">
                All articles
              </Link>
            </div>
            {drafts.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <p className="font-medium">Nothing in progress</p>
                <p className="mt-1 text-sm text-ink-2">Your next draft is one click away.</p>
                <Link href="/dashboard/articles/new" className="btn btn-primary mt-5 gap-1.5">
                  <PlusIcon size={16} /> Write an article
                </Link>
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th className="pl-4">Title</th>
                    <th>Status</th>
                    <th>Section</th>
                    <th className="pr-4">Last saved</th>
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((article) => (
                    <tr key={article.id}>
                      <td className="pl-4">
                        <Link href={`/dashboard/articles/${article.id}`} className="font-medium hover:underline">
                          {article.title}
                        </Link>
                        {isAdmin && <p className="text-xs text-ink-3">{article.author.name}</p>}
                      </td>
                      <td>
                        <StatusPill status={article.status} />
                        {article.status === "SCHEDULED" && article.scheduledFor && (
                          <p className="mt-1 text-xs text-ink-3">{formatDateTime(article.scheduledFor)}</p>
                        )}
                      </td>
                      <td className="text-ink-2">{article.category?.name ?? "—"}</td>
                      <td className="pr-4 text-ink-3">{formatRelative(article.updatedAt, now)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section aria-labelledby="week-heading" className="card px-5 py-4">
            <h2 id="week-heading" className="font-semibold">
              This week
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-ink-3">{isAdmin ? "Article views" : "Views of your stories"}</p>
                <p className="figure mt-1 text-[30px] leading-none">{weekTotal.toLocaleString("en-GB")}</p>
                <p className={`mt-1 text-xs font-semibold ${change === null ? "text-ink-3" : change >= 0 ? "text-ok" : "text-danger"}`}>
                  {change === null ? "No previous week to compare" : `${change >= 0 ? "▲" : "▼"} ${Math.abs(change)}% vs last week`}
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-3">Comments waiting</p>
                <p className="figure mt-1 text-[30px] leading-none">{pendingComments.toLocaleString("en-GB")}</p>
                <p className="mt-1 text-xs font-semibold text-ink-3">
                  {oldestPending ? `Oldest ${formatRelative(oldestPending.createdAt, now)}` : "Queue clear"}
                </p>
              </div>
            </div>
            <Sparkline points={points} />
            <div className="flex justify-between text-[11px] text-ink-3">
              <span>{formatDate(weekStart)}</span>
              <span>Today</span>
            </div>
            <Link href="/dashboard/analytics" className="text-link mt-4 inline-flex items-center gap-1 text-sm">
              Full analytics <ArrowRightIcon size={14} />
            </Link>
          </section>
        </div>
      </PageBody>
    </main>
  );
}
