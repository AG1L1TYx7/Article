import { randomBytes } from "node:crypto";

/**
 * How a reported issue is identified in public: its reference and its URL.
 *
 * Both are read aloud, written down and quoted to officials, so they are
 * shaped for a person rather than for a database. Split from lib/issues.ts
 * — which needs the database — so these rules can be tested without one,
 * the same pairing as searchQuery/search and issueVisibility/issues.
 */

/** Human-quotable, unambiguous, and not guessable in order. */
const REFERENCE_ALPHABET = "ACDEFGHJKLMNPQRTUVWXY349";

/**
 * A reference somebody can read down a phone to an official.
 *
 * Deliberately not sequential. A running number would publish how many
 * reports the platform has received and let anybody enumerate them; it
 * would also tell the subject of report #41 that theirs was the
 * forty-first, which in a small district is close to a date.
 *
 * The alphabet drops characters that are misread aloud or in handwriting:
 * no O/0, I/1, S/5, B/8, Z/2.
 */
export function newReference(): string {
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += REFERENCE_ALPHABET[bytes[i]! % REFERENCE_ALPHABET.length];
    if (i === 3) out += "-";
  }
  return `NP-${out}`;
}

/** URL slug from a title, falling back to the reference for a title with no ASCII. */
export function issueSlug(title: string, reference: string): string {
  const stem = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  // The reference's own separator is stripped before it is appended, or
  // the slug ends in a stray dash: "NP-XWK4-9TGW" sliced naively gives
  // "xwk4-" and the URL reads as though it were cut off.
  const tail = reference.replace(/[^A-Za-z0-9]/g, "").slice(2, 6).toLowerCase();
  // A Nepali title reduces to nothing here, which is common and fine —
  // the reference is unique and readable either way.
  return stem ? `${stem}-${tail}` : reference.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}
