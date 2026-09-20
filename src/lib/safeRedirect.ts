/**
 * Deciding where a redirect parameter is allowed to send someone.
 *
 * `?from=` and friends are attacker-controlled. The attack is not subtle:
 * send a victim to /login?from=<attacker site>, let them log in for real
 * on the genuine site, and land them on a cloned page asking them to log
 * in "again". The credentials go to the attacker, and the victim never
 * saw a suspicious domain until after they had trusted the first one.
 *
 * The obvious check — "does it start with a slash" — is wrong, and was
 * wrong in this codebase:
 *
 *   "//evil.com"    starts with "/" and resolves to https://evil.com
 *   "/\\evil.com"   the same, because browsers normalise the backslash
 *
 * So rather than pattern-matching, this resolves the value the way a
 * browser would and checks the origin did not move. The parser that
 * decides is then the same one the browser uses.
 */

/** Any origin; only used as a fixed point to detect the value escaping it. */
const SENTINEL = "https://this-origin.invalid";

export function safeRedirectPath(from: string | null | undefined, fallback = "/"): string {
  if (!from) return fallback;

  let resolved: URL;
  try {
    resolved = new URL(from, SENTINEL);
  } catch {
    return fallback;
  }

  // Anything that changed the origin was absolute, protocol-relative, or
  // used a scheme of its own — none of which may be followed.
  if (resolved.origin !== SENTINEL) return fallback;

  // Rebuilt from the parsed parts rather than returned as given, so an
  // encoded oddity that survived parsing cannot be passed along intact.
  const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;
  return path.startsWith("/") ? path : fallback;
}
