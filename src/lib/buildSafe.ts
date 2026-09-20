/**
 * Lets a page render when the database cannot be reached.
 *
 * Nothing on this site is prerendered — the root layout forces dynamic
 * rendering, so every page is built per request from the database as it
 * is now. `next build` still evaluates the modules behind the homepage
 * and the site header, and without this it would need a live database:
 * a container image could not be built before the database it will
 * eventually talk to exists, and a build machine would need credentials
 * for a production database it has no business holding.
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
