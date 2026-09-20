/**
 * Turns an article's sanitized HTML body into plain text for indexing.
 *
 * Search should match the words a reader actually sees, not the markup
 * around them — without this, a query for "div" or "href" would hit every
 * article. Runs on already-sanitized HTML (see lib/sanitize.ts), so this
 * is an extraction step, not a security boundary.
 */
export function extractSearchText(html: string): string {
  return (
    html
      // Block-level tags become spaces so words either side don't run
      // together: "<p>end</p><p>Start" must not read as "endStart".
      .replace(/<\/?(p|div|br|h[1-6]|li|ul|ol|blockquote|figure|figcaption)[^>]*>/gi, " ")
      .replace(/<[^>]+>/g, "")
      // A handful of entities the sanitizer leaves behind.
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, " ")
      .trim()
      // Bounded so one very long article can't dominate a row's size.
      .slice(0, 100_000)
  );
}
