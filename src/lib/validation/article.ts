import { z } from "zod";
import { LOCALES } from "@/i18n/config";

// Two characters, not three: "ai", "eu" and "us" are real section names,
// and search already indexes two-letter words for the same reason.
const slug = z
  .string()
  .min(2, "The slug needs at least 2 characters.")
  .max(160, "The slug can be at most 160 characters.")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens only, e.g. artificial-intelligence.");

export const articleInputSchema = z.object({
  title: z.string().min(1).max(200),
  dek: z.string().max(300).optional(),
  slug,
  // Tiptap's JSON document. Only checked to be an object here — the
  // rendered `bodyHtml` below is what actually reaches readers, and that
  // goes through the sanitizer plus a hard size cap. Must not be
  // `z.unknown()`: that accepts `undefined`, which then hits Prisma as a
  // missing value on a required column and throws instead of returning a
  // clean validation error.
  bodyJson: z.custom<object>(
    (v) => typeof v === "object" && v !== null,
    "Article body is missing or malformed"
  ),
  bodyHtml: z.string().max(200_000),
  excerpt: z.string().max(500).optional(),
  categoryId: z.string().min(1).optional(),
  tagSlugs: z.array(z.string().min(1).max(50)).max(10).optional(),
  isBreaking: z.boolean().optional(),
  coverImageId: z.string().min(1).optional(),
  // Describes the cover for readers who cannot see it; stored on the
  // Media row, so it is only meaningful alongside coverImageId.
  coverAltText: z.string().max(200).optional(),
  // Search-result title and description. Google truncates around 60 and
  // 160 characters; the limits leave a little room rather than enforcing
  // the exact cut-off, which changes.
  // The language the story is written in (its own, not the reader's).
  locale: z.enum(LOCALES).optional(),
  // The slug of the article this one translates, so the two link to each
  // other and search engines see them as one story in two languages.
  // Empty means "not a translation".
  translationOfSlug: z
    .string()
    .max(160)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Enter the other article's slug, e.g. budget-vote-2026.")
    .optional()
    .or(z.literal("")),
  seoTitle: z.string().max(70).optional(),
  seoDescription: z.string().max(170).optional(),
  // ISO timestamp. Set (in the future) to schedule; absent to leave the
  // article as a draft, or to cancel a schedule.
  scheduledFor: z
    .string()
    .datetime({ offset: true })
    .optional()
    .refine((v) => !v || new Date(v).getTime() > Date.now() - 60_000, "The publish time must be in the future."),
});
export type ArticleInput = z.infer<typeof articleInputSchema>;

export const articleLinkSchema = z.object({
  url: z.url().max(2000),
  label: z.string().max(200).optional(),
});

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, "Give the category a name.").max(80, "Keep the name under 80 characters."),
  slug,
  description: z.string().max(300, "Keep the description under 300 characters.").optional(),
});

/**
 * Only http and https. This is not merely tidiness: `z.url()` happily
 * accepts `javascript:alert(1)` and `file:///etc/passwd`, and this URL is
 * rendered straight into an anchor's href for every reader of the
 * article. The scheme check is the thing standing between an author and
 * a stored XSS payload.
 */
function isWebUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export const addArticleLinkSchema = z.object({
  articleId: z.string().min(1),
  // Checked again in lib/linkPreview/fetch.ts before anything is fetched;
  // this catches it early so the author gets a useful message rather than
  // a silent failure.
  url: z
    .url("That doesn't look like a web address.")
    .max(2000)
    .refine(isWebUrl, "Links must start with http:// or https://"),
  label: z.string().max(200).optional(),
});
