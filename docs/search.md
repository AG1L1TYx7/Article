# Search

> **This page described the PostgreSQL implementation.** The project now
> runs on MySQL, and search was rewritten with it — `MATCH ... AGAINST`
> over four FULLTEXT indexes rather than a `tsvector`, and a query
> sanitiser in place of `websearch_to_tsquery`.
>
> See **[database.md](database.md)** for the current design, including
> the `innodb_ft_min_token_size` setting that search will not work
> correctly without.

The original PostgreSQL notes are kept below, because the reasoning
behind the ranking and the query-safety requirements carried over even
though the implementation did not.

---

Full-text search over published articles, backed by Postgres. No external
search service, no extra infrastructure to run or secure.

## How it works

| Piece | Where |
| --- | --- |
| Query + ranking | [src/lib/search.ts](../src/lib/search.ts) |
| Query-string parsing | [src/lib/searchParams.ts](../src/lib/searchParams.ts) |
| Body text extraction | [src/lib/searchText.ts](../src/lib/searchText.ts) |
| Results page | [src/app/search/page.tsx](../src/app/search/page.tsx) |
| Filter form | [src/components/search/SearchForm.tsx](../src/components/search/SearchForm.tsx) |

Articles store a `searchText` column: the article body with its HTML
stripped, written at save time by `createArticle` / `updateArticle`.
Indexing `bodyHtml` directly would match on markup — a search for "div" or
"href" would return everything.

Queries run through `websearch_to_tsquery`, which accepts what readers
actually type: quoted phrases, `OR`, and a leading `-` to exclude a word.
It also never raises a syntax error, so a stray `&` or `(` in the search
box cannot turn into a 500. `to_tsquery` would.

Results are weighted: title `A`, dek `B`, body `C`. An article whose
headline matches outranks one that mentions the words in passing. Ties
break by recency.

Search reads only `status = 'PUBLISHED'`. Drafts, scheduled and archived
articles are never returned, for anyone — there is no author-visible
"search my drafts" path.

Result pages are `noindex`: they are infinite in number and thin in
content, and indexing them buries the articles themselves.

## Two rules for anyone editing the SQL

**1. Timestamps must be compared in UTC.** Prisma stores `DateTime` as
`timestamp without time zone` holding a UTC instant, while `now()` and any
bound `Date` parameter are `timestamptz`. Comparing them directly makes
Postgres reinterpret the stored value in the database session's time zone,
shifting every article by that offset. This is not theoretical — it shipped
and hid everything published in the previous four hours on a server set to
`America/New_York`. Always write:

```sql
a."publishedAt" <= (now() AT TIME ZONE 'UTC')
a."publishedAt" >= ($1::timestamptz AT TIME ZONE 'UTC')
```

Verified by running the same search under `PGTZ` set to `UTC`,
`America/New_York`, `Asia/Tokyo` and `Pacific/Kiritimati` (UTC-4 through
UTC+14) and getting identical results.

**2. Every user value is a bound parameter.** The query is built with
`Prisma.sql`, so the search string and all three filters are parameters,
never concatenated text. Keep it that way; this is the one raw SQL
statement in the application.

## Scaling: when to add a GIN index

There is deliberately **no** index on the tsvector today. Postgres computes
it per row on each search, which is fine into roughly the low tens of
thousands of articles — at 400 articles a search runs in about 5ms.

Add the index when search latency becomes noticeable, not before. It has an
operational cost: Prisma's schema language cannot express a weighted
expression index, so the index lives only in a hand-written migration, and
`prisma migrate dev` will try to generate a `DROP INDEX` for it the next
time the schema changes. The way around that is a stored column Prisma does
know about.

The migration to write when the time comes:

```sql
ALTER TABLE "Article"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A')
      || setweight(to_tsvector('english', coalesce(dek, '')), 'B')
      || setweight(to_tsvector('english', coalesce("searchText", '')), 'C')
  ) STORED;

CREATE INDEX "Article_searchVector_idx" ON "Article" USING GIN ("searchVector");
```

Then add `searchVector Unsupported("tsvector")?` to the `Article` model in
`schema.prisma` so Prisma knows the column exists and leaves it alone, and
replace the inline `setweight(...)` expressions in `search.ts` with
`a."searchVector"`.

Generating the column rather than maintaining it in application code means
it cannot drift out of sync with the row, including for writes that bypass
the Next.js app entirely.

## Backfill

`searchText` was added after articles already existed, so
`prisma/migrations/20260920031500_backfill_article_search_text` populates it
with the SQL equivalent of `extractSearchText`. HTML entities are left
encoded by the backfill; any affected article gets a clean value the next
time an author saves it. New and edited articles always go through the
TypeScript path.

## Browsing without words

A section, author or date range with an empty search box is a browse,
not a search: `searchArticles()` lists every published article that fits
the filters, newest first, through ordinary Prisma rather than the
`MATCH` query (there are no words for it to rank). The page reads the
filters back in words — "4 articles in Sport from the past week, newest
first" — so it is clear what narrowed the list. Changing a dropdown
submits the form at once when JavaScript is on
(`components/search/SubmitOnChange.tsx`); the Search button still works
without it.
