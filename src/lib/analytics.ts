import { db } from "@/lib/db";
import type { Point } from "@/components/charts/Charts";

/**
 * Everything the analytics page draws, in one place, so the page is
 * layout and the numbers are testable.
 *
 * Time series are per UTC day, zero-filled across the range so a quiet
 * day is a visible dip rather than a missing point. Totals are compared
 * with the period immediately before, of the same length.
 *
 * Views over time come from ArticleViewDaily, which only exists from the
 * day it was added; the all-time Article.viewCount is still the right
 * number for "most read ever", so both are used and labelled.
 */

export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];

export interface Ranked {
  id: string;
  slug: string;
  title: string;
  value: number;
  detail: string;
}

export interface Analytics {
  days: RangeDays;
  since: Date;
  totals: {
    views: number;
    prevViews: number;
    published: number;
    prevPublished: number;
    newReaders: number;
    prevNewReaders: number;
    comments: number;
    prevComments: number;
    likes: number;
    prevLikes: number;
  };
  viewsByDay: Point[];
  prevViewsByDay: Point[];
  publishedByDay: Point[];
  commentsByDay: Point[];
  readersByDay: Point[];
  viewsBySection: Point[];
  viewsByAuthor: Point[];
  engagementMix: Point[];
  trending: Ranked[];
  mostRead: Ranked[];
  mostDiscussed: Ranked[];
  hasDailyViews: boolean;
  allTime: {
    published: number;
    drafts: number;
    scheduled: number;
    readers: number;
    pendingComments: number;
    openReports: number;
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const dayLabel = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Zero-filled day series from `since` for `days` days, in order. */
function fillDays(since: Date, days: number, rows: { day: string; n: number }[]): Point[] {
  const byDay = new Map(rows.map((r) => [r.day.slice(0, 10), r.n]));
  const out: Point[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getTime() + i * DAY_MS);
    const key = d.toISOString().slice(0, 10);
    out.push({ label: dayLabel.format(d), value: byDay.get(key) ?? 0 });
  }
  return out;
}

// MySQL DATE columns come back as Date objects through the driver, and
// DATE() expressions can come back as strings; both are handled.
type DayRow = { day: string | Date; n: bigint | number };
const num = (v: bigint | number | null | undefined) => Number(v ?? 0);
const dayKey = (v: string | Date) => (v instanceof Date ? v.toISOString() : String(v));

async function countByDay(table: string, column: string, since: Date, until: Date, extraWhere = ""): Promise<{ day: string; n: number }[]> {
  // Table and column names come from this file, never from input.
  const rows = await db.$queryRawUnsafe<DayRow[]>(
    `SELECT DATE(\`${column}\`) AS day, COUNT(*) AS n FROM \`${table}\` WHERE \`${column}\` >= ? AND \`${column}\` < ? ${extraWhere} GROUP BY DATE(\`${column}\`)`,
    since,
    until
  );
  return rows.map((r) => ({ day: dayKey(r.day), n: num(r.n) }));
}

async function viewsByDay(since: Date, until: Date): Promise<{ day: string; n: number }[]> {
  const rows = await db.$queryRaw<DayRow[]>`
    SELECT \`day\`, SUM(\`views\`) AS n FROM \`ArticleViewDaily\`
    WHERE \`day\` >= ${since} AND \`day\` < ${until} GROUP BY \`day\``;
  return rows.map((r) => ({ day: dayKey(r.day), n: num(r.n) }));
}

const sum = (pts: { n: number }[]) => pts.reduce((s, p) => s + p.n, 0);

export async function loadAnalytics(days: RangeDays, now: Date = new Date()): Promise<Analytics> {
  const until = utcDayStart(new Date(now.getTime() + DAY_MS)); // start of tomorrow, UTC
  const since = new Date(until.getTime() - days * DAY_MS);
  const prevSince = new Date(since.getTime() - days * DAY_MS);

  const [
    views,
    prevViews,
    published,
    prevPublished,
    readers,
    prevReaders,
    comments,
    prevComments,
    likes,
    prevLikes,
    saves,
    follows,
    sectionViews,
    authorViews,
    trendingRows,
    mostReadRows,
    mostDiscussedRows,
    allPublished,
    allDrafts,
    allScheduled,
    allReaders,
    pendingComments,
    openReports,
  ] = await Promise.all([
    viewsByDay(since, until),
    viewsByDay(prevSince, since),
    countByDay("Article", "publishedAt", since, until, "AND `status` = 'PUBLISHED'"),
    countByDay("Article", "publishedAt", prevSince, since, "AND `status` = 'PUBLISHED'"),
    countByDay("User", "createdAt", since, until, "AND `role` = 'READER'"),
    countByDay("User", "createdAt", prevSince, since, "AND `role` = 'READER'"),
    countByDay("Comment", "createdAt", since, until, "AND `status` = 'APPROVED'"),
    countByDay("Comment", "createdAt", prevSince, since, "AND `status` = 'APPROVED'"),
    db.reaction.count({ where: { createdAt: { gte: since, lt: until } } }),
    db.reaction.count({ where: { createdAt: { gte: prevSince, lt: since } } }),
    db.bookmark.count({ where: { createdAt: { gte: since, lt: until } } }),
    db.follow.count({ where: { createdAt: { gte: since, lt: until } } }),
    db.$queryRaw<{ name: string | null; n: bigint }[]>`
      SELECT c.\`name\` AS name, SUM(a.\`viewCount\`) AS n
      FROM \`Article\` a LEFT JOIN \`Category\` c ON c.\`id\` = a.\`categoryId\`
      WHERE a.\`status\` = 'PUBLISHED' GROUP BY c.\`name\` ORDER BY n DESC LIMIT 8`,
    db.$queryRaw<{ name: string; n: bigint }[]>`
      SELECT u.\`name\` AS name, SUM(a.\`viewCount\`) AS n
      FROM \`Article\` a JOIN \`User\` u ON u.\`id\` = a.\`authorId\`
      WHERE a.\`status\` = 'PUBLISHED' GROUP BY u.\`id\`, u.\`name\` ORDER BY n DESC LIMIT 8`,
    db.$queryRaw<{ id: string; slug: string; title: string; author: string; n: bigint }[]>`
      SELECT a.\`id\`, a.\`slug\`, a.\`title\`, u.\`name\` AS author, SUM(v.\`views\`) AS n
      FROM \`ArticleViewDaily\` v JOIN \`Article\` a ON a.\`id\` = v.\`articleId\` JOIN \`User\` u ON u.\`id\` = a.\`authorId\`
      WHERE v.\`day\` >= ${since} AND a.\`status\` = 'PUBLISHED'
      GROUP BY a.\`id\`, a.\`slug\`, a.\`title\`, u.\`name\` ORDER BY n DESC LIMIT 10`,
    db.article.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { viewCount: "desc" },
      take: 10,
      select: { id: true, slug: true, title: true, viewCount: true, author: { select: { name: true } } },
    }),
    db.article.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { comments: { _count: "desc" } },
      take: 10,
      select: { id: true, slug: true, title: true, _count: { select: { comments: true, reactions: true } } },
    }),
    db.article.count({ where: { status: "PUBLISHED" } }),
    db.article.count({ where: { status: "DRAFT" } }),
    db.article.count({ where: { status: "SCHEDULED" } }),
    db.user.count({ where: { role: "READER", status: "ACTIVE" } }),
    db.comment.count({ where: { status: "PENDING" } }),
    db.report.count({ where: { status: "OPEN" } }),
  ]);

  const totalComments = sum(comments);

  return {
    days,
    since,
    totals: {
      views: sum(views),
      prevViews: sum(prevViews),
      published: sum(published),
      prevPublished: sum(prevPublished),
      newReaders: sum(readers),
      prevNewReaders: sum(prevReaders),
      comments: totalComments,
      prevComments: sum(prevComments),
      likes,
      prevLikes,
    },
    viewsByDay: fillDays(since, days, views),
    prevViewsByDay: fillDays(prevSince, days, prevViews),
    publishedByDay: fillDays(since, days, published),
    commentsByDay: fillDays(since, days, comments),
    readersByDay: fillDays(since, days, readers),
    viewsBySection: sectionViews.map((r) => ({ label: r.name ?? "No section", value: num(r.n) })),
    viewsByAuthor: authorViews.map((r) => ({ label: r.name, value: num(r.n) })),
    engagementMix: [
      { label: "Likes", value: likes },
      { label: "Saves", value: saves },
      { label: "Comments", value: totalComments },
      { label: "Follows", value: follows },
    ],
    trending: trendingRows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      value: num(r.n),
      detail: `${num(r.n).toLocaleString("en-GB")} views · ${r.author}`,
    })),
    mostRead: mostReadRows.map((a) => ({
      id: a.id,
      slug: a.slug,
      title: a.title,
      value: a.viewCount,
      detail: `${a.viewCount.toLocaleString("en-GB")} views · ${a.author.name}`,
    })),
    mostDiscussed: mostDiscussedRows.map((a) => ({
      id: a.id,
      slug: a.slug,
      title: a.title,
      value: a._count.comments,
      detail: `${a._count.comments} comment${a._count.comments === 1 ? "" : "s"} · ${a._count.reactions} like${a._count.reactions === 1 ? "" : "s"}`,
    })),
    hasDailyViews: views.length > 0 || prevViews.length > 0,
    allTime: {
      published: allPublished,
      drafts: allDrafts,
      scheduled: allScheduled,
      readers: allReaders,
      pendingComments,
      openReports,
    },
  };
}

/** "+12%" / "−8%" / "new" against the previous period. */
export function delta(current: number, previous: number): { text: string; tone: "up" | "down" | "flat" } {
  if (previous === 0 && current === 0) return { text: "—", tone: "flat" };
  if (previous === 0) return { text: "new", tone: "up" };
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { text: "±0%", tone: "flat" };
  return { text: `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`, tone: pct > 0 ? "up" : "down" };
}
