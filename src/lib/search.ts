import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { toBooleanQuery } from "@/lib/searchQuery";

export const SEARCH_PAGE_SIZE = 20;
/**
 * Longer than any real query. Nobody searching a news site types more
 * than this, and an unbounded one is free work for the database.
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
  anonymous: boolean | number;
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
 * Reader input is sanitised into boolean-mode syntax by
 * lib/searchQuery.ts before it reaches MySQL. Quoted phrases and a
 * leading minus to exclude are honoured; every other operator character
 * is stripped, because MySQL boolean mode assigns meaning to
 * `+ - > < ( ) ~ * " @` and a stray one is a syntax error rather than a
 * search for that character.
 *
 * Title, dek and body are weighted 3/2/1, so an article whose *headline*
 * matches outranks one that merely mentions the words halfway down.
 *
 * Written as raw SQL because Prisma's query API cannot express MATCH ...
 * AGAINST.
 * Every user value is a bound parameter — none of this is string-built.
 *
 * Four FULLTEXT indexes back this, declared in schema.prisma: one over
 * all three columns to decide what matches, and one per column so
 * relevance can be weighted. MySQL cannot compute a full-text index at
 * query time the way Postgres computes a tsvector, so they have to exist
 * up front — and MATCH must name exactly the columns some index covers.
 *
 * Words shorter than innodb_ft_min_token_size are not indexed at all.
 * This deployment sets it to 2 rather than the default 3, or "AI", "EU"
 * and "US" would silently match nothing. That setting lives in the
 * server's my.ini, not in this repository — see docs/database.md.
 */
export async function searchArticles(filters: SearchFilters): Promise<SearchResults> {
  const q = normalizeQuery(filters.q);
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const offset = (page - 1) * SEARCH_PAGE_SIZE;

  // No words, but a section, author or date range: that is browsing, not
  // searching, and a reader who picked "Sport, past week" and got a blank
  // page would reasonably conclude the filters are broken. Newest first,
  // since there is no relevance to rank by.
  if (!q) {
    if (!filters.categorySlug && !filters.authorHandle && !filters.since) return EMPTY;
    return browseArticles(filters, page, offset);
  }

  // Optional filters are folded into one WHERE via `param IS NULL OR ...`
  // so the SQL stays a single static statement.
  const categorySlug = filters.categorySlug || null;
  const authorHandle = filters.authorHandle || null;
  const since = filters.since ?? null;

  // Sanitised into boolean-mode syntax. MySQL has no equivalent of
  // websearch_to_tsquery, which accepted anything and never errored — so
  // a stray operator character has to be stripped here instead of
  // becoming a syntax error. See lib/searchQuery.ts.
  const booleanQuery = toBooleanQuery(q);
  if (!booleanQuery) return EMPTY;

  const rows = await db.$queryRaw<SearchRow[]>(Prisma.sql`
    SELECT
      a.id,
      a.slug,
      a.title,
      a.dek,
      a.isBreaking,
      a.anonymous,
      a.publishedAt,
      u.name   AS authorName,
      u.handle AS authorHandle,
      c.name   AS categoryName,
      c.slug   AS categorySlug,
      -- Weighted by column, which MySQL will not do on its own. Postgres
      -- expressed this as setweight() on one tsvector; here it is three
      -- separate MATCH scores against three single-column indexes, so a
      -- headline match still outranks a passing mention in the body.
      (
        MATCH(a.title) AGAINST(${booleanQuery} IN BOOLEAN MODE) * 3
        + MATCH(a.dek) AGAINST(${booleanQuery} IN BOOLEAN MODE) * 2
        + MATCH(a.searchText) AGAINST(${booleanQuery} IN BOOLEAN MODE)
      ) AS rank,
      COUNT(*) OVER () AS total
    FROM Article a
    JOIN User u ON u.id = a.authorId
    LEFT JOIN Category c ON c.id = a.categoryId
    WHERE a.status = 'PUBLISHED'
      AND a.publishedAt IS NOT NULL
      -- UTC_TIMESTAMP(), not NOW(): Prisma stores DateTime as a UTC
      -- instant in a DATETIME column, while NOW() returns the server's
      -- local time. Comparing the two shifts every article by the
      -- server's offset — the same bug this had on Postgres, where it
      -- hid everything published in the last few hours.
      AND a.publishedAt <= UTC_TIMESTAMP()
      AND (${categorySlug} IS NULL OR c.slug = ${categorySlug})
      -- Filtering by author must not surface what they published without
      -- a byline: that would name them.
      AND (${authorHandle} IS NULL OR (u.handle = ${authorHandle} AND a.anonymous = 0))
      AND (${since} IS NULL OR a.publishedAt >= ${since})
      -- Whether a row matches at all is decided by the combined index;
      -- the per-column scores above only order what this admits.
      AND MATCH(a.title, a.dek, a.searchText)
          AGAINST(${booleanQuery} IN BOOLEAN MODE)
    -- Rank first, then recency: two equally relevant stories should show
    -- the newer one first, which is what a news reader expects.
    ORDER BY rank DESC, a.publishedAt DESC
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
      anonymous: !!r.anonymous,
      publishedAt: r.publishedAt,
      author: { name: r.authorName, handle: r.authorHandle },
      category: r.categorySlug ? { name: r.categoryName ?? "", slug: r.categorySlug } : null,
    })),
    total,
    page,
    pageCount: Math.ceil(total / SEARCH_PAGE_SIZE),
  };
}

/**
 * The filter-only path: every published article that fits the section,
 * author and date range, newest first. Ordinary Prisma rather than raw
 * SQL, because with no words there is nothing for MATCH to do.
 */
async function browseArticles(filters: SearchFilters, page: number, offset: number): Promise<SearchResults> {
  const where = {
    status: "PUBLISHED" as const,
    publishedAt: { not: null, lte: new Date(), ...(filters.since ? { gte: filters.since } : {}) },
    ...(filters.categorySlug ? { category: { slug: filters.categorySlug } } : {}),
    ...(filters.authorHandle ? { author: { handle: filters.authorHandle }, anonymous: false as const } : {}),
  };

  const [rows, total] = await Promise.all([
    db.article.findMany({
      where,
      orderBy: { publishedAt: "desc" },
      skip: offset,
      take: SEARCH_PAGE_SIZE,
      select: {
        id: true,
        slug: true,
        title: true,
        dek: true,
        isBreaking: true,
        anonymous: true,
        publishedAt: true,
        author: { select: { name: true, handle: true } },
        category: { select: { name: true, slug: true } },
      },
    }),
    db.article.count({ where }),
  ]);

  return { hits: rows, total, page, pageCount: Math.ceil(total / SEARCH_PAGE_SIZE) };
}
