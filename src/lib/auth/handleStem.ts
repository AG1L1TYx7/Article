/**
 * Deriving a public handle for someone who signed up with Google.
 *
 * Registering by email asks for a handle. Google does not supply one, and
 * `User.handle` is required and unique, so one has to be made — and it is
 * a *public* identifier, printed on every comment and at /author/<handle>.
 * That makes this more than a slug function:
 *
 *   - The name is preferred over the email. Deriving from the address
 *     would publish the local part of it — "j.smith@company.com" becoming
 *     @jsmith tells the world a likely work address, which is not what
 *     someone pressing "Continue with Google" has agreed to.
 *   - A name that yields nothing usable (scripts with no ASCII form, an
 *     emoji, a single character) falls back to a neutral "reader" plus
 *     digits rather than to the email.
 *   - Collisions are resolved with a random suffix, not a counter.
 *     Sequential handles would leak how many people have signed up, and
 *     @name2 tells @name that someone else tried to use their name.
 *
 * The result always satisfies the same rule the registration form applies
 * (`/^[a-z0-9_-]{3,30}$/`, see lib/validation/auth.ts), so an account made
 * this way is indistinguishable from one made by hand.
 *
 * Split from lib/auth/handle.ts, which does the database half, so that
 * these rules can be unit-tested without a database — the same pairing as
 * searchQuery/search and analyticsClassify/analyticsCapture.
 */

export const MIN = 3;
export const MAX = 30;
/** Leaves room for "-" plus four digits within MAX. */
const STEM_MAX = MAX - 5;
export const FALLBACK = "reader";

/** Handles nobody should be able to take by signing up with a matching name. */
export const RESERVED = new Set([
  "admin",
  "administrator",
  "moderator",
  "staff",
  "editor",
  "support",
  "help",
  "security",
  "official",
  "system",
  "root",
  "api",
  "www",
  "null",
  "undefined",
  "me",
  "you",
  "new",
  "edit",
  "delete",
  "login",
  "logout",
  "register",
  "account",
  "settings",
  "dashboard",
  "search",
  "saved",
  "notifications",
  "privacy",
  "terms",
  "about",
  "contact",
  "rss",
  "feed",
  "sitemap",
  "media",
  "article",
  "author",
  "category",
  "tag",
]);

/**
 * Name to handle stem: "Ana Sharma" becomes "ana-sharma".
 *
 * NFKD then stripping combining marks folds accented Latin to ASCII, so
 * "Émile Zolá" gives "emile-zola" rather than losing both letters. A name
 * in a script with no ASCII form (Devanagari, Han, Arabic) reduces to
 * nothing, which the caller treats as "no usable stem" — better than
 * publishing mojibake.
 */
export function handleStem(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, STEM_MAX)
    .replace(/-+$/g, "");
}
