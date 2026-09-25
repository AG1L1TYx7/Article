import { z } from "zod";
import { MEDIA_LICENSES } from "@/lib/mediaRights";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

/** What the editor's details dialog sends for a file. */
export const mediaRightsInputSchema = z.object({
  mediaId: z.string().min(1),
  title: optionalText(191),
  caption: optionalText(1000),
  // Alt text for images only; ignored for audio and video.
  altText: optionalText(200),
  credit: optionalText(191),
  sourceName: optionalText(191),
  sourceUrl: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^https?:\/\//i.test(v), "The source link must start with http:// or https://."),
  license: z.enum(MEDIA_LICENSES),
  rightsNote: optionalText(2000),
  transcript: optionalText(50_000),
  /** The person ticked the box: we have the right to publish this under that licence. */
  confirmed: z.boolean(),
});

export type MediaRightsInput = z.input<typeof mediaRightsInputSchema>;
