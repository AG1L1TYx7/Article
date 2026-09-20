import { z } from "zod";
import { db } from "@/lib/db";
import { assessComment } from "@/lib/spam";

/**
 * Site-wide settings, changed by admins on /dashboard/settings.
 *
 * Stored as one JSON row per key in SiteSetting, read through here with
 * defaults and a short in-process cache, so a page never pays a query for
 * a value that changes a few times a year. Sixty seconds is the most a
 * change can take to reach every process.
 */

export const COMMENT_MODERATION_MODES = ["trusted", "new_accounts", "all"] as const;
export type CommentModerationMode = (typeof COMMENT_MODERATION_MODES)[number];

export const settingsSchema = z.object({
  /**
   * trusted       — comments go live at once; only content the spam
   *                 heuristics flag is held. Readers can still report.
   * new_accounts  — an account's first few comments are held until a
   *                 moderator approves them, then it is trusted.
   * all           — every comment from a reader is held.
   * Staff (moderators and admins) are never held in any mode.
   */
  commentModeration: z.enum(COMMENT_MODERATION_MODES),
  /** How many approved comments earn trust, in new_accounts mode. */
  trustedAfterApprovedComments: z.number().int().min(1).max(20),
});
export type SiteSettings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: SiteSettings = {
  commentModeration: "new_accounts",
  trustedAfterApprovedComments: 3,
};

const CACHE_MS = 60_000;
let cache: { at: number; value: SiteSettings } | null = null;

export async function getSettings(): Promise<SiteSettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const rows = await db.siteSetting.findMany();
  const raw: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) raw[row.key] = row.value;
  // A row written by an older version with a value this version no
  // longer accepts falls back to the default for that key alone.
  const parsed = settingsSchema.safeParse(raw);
  const value = parsed.success
    ? parsed.data
    : settingsSchema.parse(
        Object.fromEntries(
          Object.entries(DEFAULT_SETTINGS).map(([k, d]) => {
            const single = settingsSchema.shape[k as keyof SiteSettings].safeParse(raw[k]);
            return [k, single.success ? single.data : d];
          })
        )
      );
  cache = { at: Date.now(), value };
  return value;
}

export async function saveSettings(next: SiteSettings, updatedBy: string): Promise<void> {
  await db.$transaction(
    Object.entries(next).map(([key, value]) =>
      db.siteSetting.upsert({
        where: { key },
        create: { key, value, updatedBy },
        update: { value, updatedBy },
      })
    )
  );
  cache = { at: Date.now(), value: next };
}

/** Forgets the cache — for tests and for right after a save. */
export function resetSettingsCache() {
  cache = null;
}

/**
 * Whether a comment goes live or waits for a moderator.
 *
 * One function for both posting and editing, so an edit cannot become a
 * moderation bypass. Staff always post live: a moderator's own comment
 * queued for a moderator is the review step reviewing itself.
 */
export async function decideCommentStatus(
  user: { id: string; role: string },
  body: string
): Promise<{ status: "APPROVED" | "PENDING"; reason: "staff" | "trusted" | "mode" | "spam" | "new_account" }> {
  if (user.role === "MODERATOR" || user.role === "ADMIN") return { status: "APPROVED", reason: "staff" };

  const settings = await getSettings();
  if (assessComment(body).needsReview) return { status: "PENDING", reason: "spam" };

  if (settings.commentModeration === "all") return { status: "PENDING", reason: "mode" };
  if (settings.commentModeration === "trusted") return { status: "APPROVED", reason: "mode" };

  const approvedSoFar = await db.comment.count({ where: { userId: user.id, status: "APPROVED" } });
  return approvedSoFar >= settings.trustedAfterApprovedComments
    ? { status: "APPROVED", reason: "trusted" }
    : { status: "PENDING", reason: "new_account" };
}
