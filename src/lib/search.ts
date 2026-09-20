import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";

export const SEARCH_PAGE_SIZE = 20;
/**
 * Longer than any real query. Postgres will happily parse a megabyte of
 * text into a tsquery; nobody searching a news site needs to.
 */
const MAX_QUERY_LENGTH = 200;

export interface SearchFilters {
  q: string;
  categorySlug?: string;
  authorHandle?: string;
  /** Only articles published on or after this date. */
  since?: Date;
  page?: number;
}

export interface SearchHit {
  id: string;
  slug: string;
  title: string;
  dek: string | null;
  isBreaking: boolean;
  publishedAt: Date | null;
  author: { name: string; handle: string };
  category: { name: string; slug: string } | null;
}

export interface SearchResults {
  hits: SearchHit[];
  total: number;
  page: number;
  pageCount: number;
}

const EMPTY: SearchResults = { hits: [], total: 0, page: 1, pageCount: 0 };

/** Row shape of the raw query below. */
interface SearchRow {
  id: string;
  slug: string;
  title: string;
  dek: string | null;
  isBreaking: boolean;
  publishedAt: Date | null;
  authorName: string;
  authorHandle: string;
  categoryName: string | null;
  categorySlug: string | null;
  total: bigint;
}

export function normalizeQuery(raw: string | undefined | null): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
}

/**
 * Full-text search over published articles.
 *
 * Uses `websearch_to_tsquery`, not `to_tsquery`: it accepts what people
 * actually type — quoted phrases, OR, a leading minus to exclude — and,
 * critically, never raises a syntax error on input like `a & | b`. With
 * `to_tsquery` a stray punctuation mark would turn into a 500.
 *
 * Title, dek and body are weighted A/B/C, so an article whose *headline*
 * matches outranks one that merely mentions the words halfway down.
 *
 * Written as raw SQL because Prisma's query API has no tsvector support.
 * Every user value is a bound parameter — none of this is string-built.
 *
 * Scaling note: there is deliberately no GIN index yet. Postgres computes
 * the tsvector per row on each search, which is fine into the low tens of
 * thousands of articles. The fix when that stops being true is a stored
 * tsvector column plus a GIN index, added in a hand-written migration —
 * `@@index(type: Gin)` in schema.prisma cannot express a weighted
 * expression index, so it has to live in SQL. See docs/.
 */
export async function searchArticles(filters: SearchFilters): Promise<SearchResults> {
  const q = normalizeQuery(filters.q);
  if (!q) return EMPTY;

  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const offset = (page - 1) * SEARCH_PAGE_SIZE;

  // Optional filters are folded into one WHERE via `param IS NULL OR ...`
  // so the SQL stays a single static statement.
  const categorySlug = filters.categorySlug || null;
  const authorHandle = filters.authorHandle || null;
  const since = filters.since ?? null;

  const rows = await db.$queryRaw<SearchRow[]>(Prisma.sql`
    WITH matches AS (
      SELECT
        a.id,
        a.slug,
        a.title,
        a.dek,
        a."isBreaking",
        a."publishedAt",
        u.name   AS "authorName",
        u.handle AS "authorHandle",
        c.name   AS "categoryName",
        c.slug   AS "categorySlug",
        ts_rank_cd(
          setweight(to_tsvector('english', coalesce(a.title, '')), 'A')
            || setweight(to_tsvector('english', coalesce(a.dek, '')), 'B')
            || setweight(to_tsvector('english', coalesce(a."searchText", '')), 'C'),
          websearch_to_tsquery('english', ${q})
        ) AS rank
      FROM "Article" a
      JOIN "User" u ON u.id = a."authorId"
      LEFT JOIN "Category" c ON c.id = a."categoryId"
      WHERE a.status = 'PUBLISHED'
        AND a."publishedAt" IS NOT NULL
        -- "AT TIME ZONE 'UTC'" on both date comparisons is load-bearing.
        -- Prisma stores DateTime as "timestamp without time zone" holding a
        -- UTC instant, but now() and a bound Date parameter are
        -- timestamptz. Comparing the two makes Postgres reinterpret the
        -- stored value in the *session's* time zone, so on a server set to
        -- anything but UTC every article silently shifts by the offset —
        -- which hid everything published in the last few hours.
        AND a."publishedAt" <= (now() AT TIME ZONE 'UTC')
        AND (${categorySlug}::text IS NULL OR c.slug = ${categorySlug})
        AND (${authorHandle}::text IS NULL OR u.handle = ${authorHandle})
        AND (
          ${since}::timestamptz IS NULL
          OR a."publishedAt" >= (${since}::timestamptz AT TIME ZONE 'UTC')
        )
        AND (
          setweight(to_tsvector('english', coalesce(a.title, '')), 'A')
            || setweight(to_tsvector('english', coalesce(a.dek, '')), 'B')
            || setweight(to_tsvector('english', coalesce(a."searchText", '')), 'C')
        ) @@ websearch_to_tsquery('english', ${q})
    )
    SELECT *, count(*) OVER () AS total
    FROM matches
    -- Rank first, then recency: two equally relevant stories should show
    -- the newer one first, which is what a news reader expects.
    ORDER BY rank DESC, "publishedAt" DESC
    LIMIT ${SEARCH_PAGE_SIZE} OFFSET ${offset}
  `);

  // count(*) OVER () rides along on the same scan, so the total costs no
  // extra query — but it is only present when at least one row came back.
  const total = rows.length > 0 ? Number(rows[0].total) : 0;

  return {
    hits: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      dek: r.dek,
      isBreaking: r.isBreaking,
      publishedAt: r.publishedAt,
      author: { name: r.authorName, handle: r.authorHandle },
      category: r.categorySlug ? { name: r.categoryName ?? "", slug: r.categorySlug } : null,
    })),
    total,
    page,
    pageCount: Math.ceil(total / SEARCH_PAGE_SIZE),
  };
}
