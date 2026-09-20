import { z } from "zod";

const slug = z
  .string()
  .min(3)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens only");

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
});
export type ArticleInput = z.infer<typeof articleInputSchema>;

export const articleLinkSchema = z.object({
  url: z.url().max(2000),
  label: z.string().max(200).optional(),
});

export const categoryInputSchema = z.object({
  name: z.string().min(1).max(80),
  slug,
  description: z.string().max(300).optional(),
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
