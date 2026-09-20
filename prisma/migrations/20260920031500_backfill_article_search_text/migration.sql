-- Backfills "searchText" for articles that were written before the column
-- existed. Mirrors extractSearchText() in src/lib/searchText.ts: block-level
-- tags become spaces so words either side stay separate, every other tag is
-- dropped, then whitespace is collapsed.
--
-- HTML entities are left as-is here. Doing them properly in SQL is fiddly and
-- they are rare in body text; any affected article gets a correct value the
-- next time an author saves it.
UPDATE "Article"
SET "searchText" = btrim(
  regexp_replace(
    regexp_replace(
      regexp_replace(
        "bodyHtml",
        '</?(p|div|br|h[1-6]|li|ul|ol|blockquote|figure|figcaption)[^>]*>',
        ' ',
        'gi'
      ),
      '<[^>]+>',
      '',
      'g'
    ),
    '\s+',
    ' ',
    'g'
  )
)
WHERE "searchText" IS NULL;
