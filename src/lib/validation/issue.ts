import { z } from "zod";

/**
 * What a member may submit when reporting something.
 *
 * The limits are set for the people this platform is for, not for a
 * database: a report from a ward office may be three sentences typed on a
 * phone, and a report about a year of obstruction may be pages. The floor
 * is high enough that "the road is bad" alone cannot be verified, and the
 * ceiling high enough that nobody is truncated mid-account.
 */

export const issueSchema = z.object({
  title: z
    .string()
    .trim()
    .min(10, "Give the report a title of at least 10 characters.")
    .max(180, "Keep the title under 180 characters — the detail goes below."),
  body: z
    .string()
    .trim()
    .min(60, "Describe what happened in at least 60 characters, so it can be checked.")
    .max(20_000),
  /** A district id from lib/nepal.ts. Required: it decides who is alerted. */
  districtId: z.string().trim().min(1, "Choose the district this concerns."),
  municipalityId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null)),
  /**
   * Ward numbers run from 1. Nepal's largest local level has 32 wards, so
   * 40 is comfortably above anything real while still refusing a typo.
   */
  ward: z
    .union([z.number().int(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === "" || v === null) return null;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    })
    .refine((n) => n === null || (n >= 1 && n <= 40), "Ward number looks wrong."),
  categoryId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null)),
  /**
   * Publish without my name.
   *
   * A safety choice, not a preference — see the note on Issue.anonymous in
   * the schema. Defaulted off rather than on, because a report with a name
   * behind it carries more weight with an official, and somebody who needs
   * anonymity knows they need it.
   */
  anonymous: z.boolean(),
  /** Ids from /api/issues/evidence. Ownership is checked server-side. */
  mediaIds: z.array(z.string().min(1)).max(8).optional().default([]),
});

export type IssueInput = z.infer<typeof issueSchema>;

/** What a verifier writes when rejecting or resolving. */
export const reviewNoteSchema = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((v) => (v ? v : null));
