import { sanitizeArticleHtml } from "@/lib/sanitize";

/**
 * Sanitized article HTML, memoised per (article, revision).
 *
 * Article bodies are sanitized on save *and* on render — deliberately, so
 * a bad row that somehow reaches the database still can't execute script
 * in a reader's browser. But re-parsing ~20KB of HTML through DOMPurify
 * for every visitor to every article is pure repeated work: the input is
 * identical until the article is edited.
 *
 * Keying on updatedAt means an edit invalidates the entry for free, with
 * no explicit busting to forget. The cache is per server process, so it
 * warms independently on each instance and holds nothing that needs to
 * be shared or persisted.
 */
const MAX_ENTRIES = 500;
const cache = new Map<string, string>();

export function sanitizedArticleHtml(articleId: string, updatedAt: Date, rawHtml: string): string {
  const key = `${articleId}:${updatedAt.getTime()}`;

  const hit = cache.get(key);
  if (hit !== undefined) {
    // Re-insert so the most recently read entries are the last to be
    // evicted — Map preserves insertion order, which is all the LRU
    // behaviour this needs.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  const clean = sanitizeArticleHtml(rawHtml);

  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, clean);
  return clean;
}
