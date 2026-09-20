import { z } from "zod";

export const commentSchema = z.object({
  articleId: z.string().min(1),
  // Comments are plain text, never HTML — they're rendered as text so
  // React escapes them, which is why there's no sanitizer step here the
  // way there is for article bodies.
  body: z.string().trim().min(2, "Say a little more than that.").max(5000, "That comment is too long."),
  parentId: z.string().min(1).optional(),
});
export type CommentInput = z.infer<typeof commentSchema>;

export const reportSchema = z.object({
  commentId: z.string().min(1),
  reason: z.enum(["SPAM", "ABUSE", "MISINFORMATION", "OTHER"]),
  note: z.string().max(500).optional(),
});

export const commentEditSchema = z.object({
  commentId: z.string().min(1),
  body: z
    .string()
    .trim()
    .min(2, "Say a little more than that.")
    .max(5000, "That comment is too long."),
});
