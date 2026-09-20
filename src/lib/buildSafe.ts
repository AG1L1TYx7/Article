/**
 * Lets a page render when the database cannot be reached.
 *
 * Two pages are statically prerendered at build time and both query the
 * database: the homepage, and the site header that every page's layout
 * includes. Without this, `next build` requires a live database — which
 * means a container image cannot be built before the database it will
 * eventually talk to exists, and a build machine needs credentials for a
 * production database it has no business holding.
 *
 * The runtime benefit is the more important one, though: a momentary
 * database blip should degrade the section list, not return 500 for the
 * entire site.
 *
 * Deliberately narrow. Only "the database is not reachable" is caught —
 * a malformed query, a missing column or a constraint violation still
 * throws, because those are bugs and silently rendering an empty page
 * would hide them. Prisma reports unreachability as P1001.
 */

function isUnreachable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P1001"
  );
}

export async function withDatabaseFallback<T>(
  query: () => Promise<T>,
  fallback: T,
  context: string
): Promise<T> {
  try {
    return await query();
  } catch (error) {
    if (!isUnreachable(error)) throw error;
    // Logged rather than swallowed: at build time this is expected and
    // harmless, at runtime it means the database is down and somebody
    // needs to know.
    console.warn(`[db unreachable] ${context} — rendering without it.`);
    return fallback;
  }
}
