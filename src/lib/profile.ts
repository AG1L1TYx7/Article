import { z } from "zod";

/**
 * A person's own account of who they are, and the one name the site shows.
 *
 * Pure: no database, no request, so the rules are unit-tested and the
 * server action, the account page and registration cannot disagree.
 */

export const PROFILE_LIMITS = { name: 80, bio: 600 } as const;

/**
 * Trims, collapses runs of whitespace, and turns "" into null.
 *
 * Collapsing matters because the display name is built from these: two
 * spaces typed by accident would otherwise show on every byline. It also
 * strips control characters (a pasted tab, a stray bidi override), which
 * have no place in a name and can make one render as something else.
 */
function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim();
  return cleaned === "" ? null : cleaned;
}

/** Bio: keeps line breaks (people write paragraphs), drops other control characters. */
function cleanBio(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "")
    // Three or more line breaks is layout, not writing.
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned === "" ? null : cleaned;
}

const nameField = (label: string) =>
  z.preprocess(cleanName, z.string().max(PROFILE_LIMITS.name, `${label} can be at most ${PROFILE_LIMITS.name} characters.`).nullable());

export const profileSchema = z
  .object({
    firstName: nameField("First name"),
    lastName: nameField("Last name"),
    preferredName: nameField("Preferred name"),
    bio: z.preprocess(cleanBio, z.string().max(PROFILE_LIMITS.bio, `About you can be at most ${PROFILE_LIMITS.bio} characters.`).nullable()),
  })
  // Something has to be shown on a byline or beside a comment.
  .refine((p) => p.firstName !== null || p.preferredName !== null, {
    message: "Enter a first name or a preferred name.",
    path: ["firstName"],
  });

export type Profile = z.infer<typeof profileSchema>;

/**
 * The name the site shows: the preferred name if there is one, otherwise
 * first and last together. A preferred name is what someone asked to be
 * called, so it wins even over a full legal name.
 */
export function displayName(p: Pick<Profile, "firstName" | "lastName" | "preferredName">): string {
  if (p.preferredName) return p.preferredName;
  return [p.firstName, p.lastName].filter(Boolean).join(" ");
}

/**
 * A starting point for accounts that only ever had one `name` field:
 * everything before the first space is the first name, the rest the last.
 * Only ever used to pre-fill the form; the person corrects it, which is
 * why it is not written to the database behind their back. Names do not
 * split reliably (many cultures put the family name first, many people
 * have one name), so a guess stored silently would be wrong for them.
 */
export function suggestNameParts(name: string): { firstName: string; lastName: string } {
  const cleaned = cleanName(name) ?? "";
  const space = cleaned.indexOf(" ");
  if (space === -1) return { firstName: cleaned, lastName: "" };
  return { firstName: cleaned.slice(0, space), lastName: cleaned.slice(space + 1) };
}
