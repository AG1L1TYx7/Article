"use server";

import { db } from "@/lib/db";
import { guardAction, requireRole } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request";
import { mediaRightsInputSchema, type MediaRightsInput } from "@/lib/validation/media";
import { rightsProblem } from "@/lib/mediaRights";

export interface MediaRightsResult {
  ok: boolean;
  error?: string;
  /** The stored values, so the editor shows what the server kept. */
  media?: {
    id: string;
    type: "IMAGE" | "VIDEO" | "AUDIO";
    title: string | null;
    caption: string | null;
    altText: string | null;
    credit: string | null;
    sourceName: string | null;
    sourceUrl: string | null;
    license: string | null;
    rightsNote: string | null;
    transcript: string | null;
    rightsConfirmedAt: Date | null;
    /** Why it still cannot be published, or null. */
    problem: string | null;
  };
}

/**
 * Records who made a file and under what terms it is published.
 *
 * Only the person who uploaded the file, or an admin, may change this:
 * the confirmation is a personal statement ("we have the right to
 * publish this"), and it should not be possible to make it on someone
 * else's behalf. The audit log keeps who confirmed what and when, which
 * is the record a rights query would ask for.
 */
export async function setMediaRights(input: MediaRightsInput): Promise<MediaRightsResult> {
  return guardAction(async () => {
    const session = await requireRole("MODERATOR");

    const parsed = mediaRightsInputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const data = parsed.data;

    const existing = await db.media.findUnique({
      where: { id: data.mediaId },
      select: { id: true, type: true, uploadedById: true, rightsConfirmedAt: true },
    });
    if (!existing) return { ok: false, error: "That file no longer exists." };
    if (session.user.role !== "ADMIN" && existing.uploadedById !== session.user.id) {
      return { ok: false, error: "Only the person who uploaded a file, or an admin, can set its credit and licence." };
    }

    const rights = {
      license: data.license,
      credit: data.credit,
      sourceName: data.sourceName,
      sourceUrl: data.sourceUrl,
      rightsNote: data.rightsNote,
      // A confirmation is only meaningful for the terms it was made
      // under: changing anything re-asks for it.
      rightsConfirmedAt: data.confirmed ? new Date() : null,
    };

    const media = await db.media.update({
      where: { id: data.mediaId },
      data: {
        ...rights,
        title: data.title,
        caption: data.caption,
        altText: existing.type === "IMAGE" ? data.altText : null,
        transcript: existing.type === "IMAGE" ? null : data.transcript,
      },
      select: {
        id: true,
        type: true,
        title: true,
        caption: true,
        altText: true,
        credit: true,
        sourceName: true,
        sourceUrl: true,
        license: true,
        rightsNote: true,
        transcript: true,
        rightsConfirmedAt: true,
      },
    });

    if (data.confirmed) {
      await recordAudit({
        actorId: session.user.id,
        action: "media.rights.confirmed",
        targetType: "Media",
        targetId: media.id,
        ip: await getClientIp(),
        metadata: { license: data.license, credit: data.credit, sourceName: data.sourceName },
      });
    }

    return { ok: true, media: { ...media, problem: rightsProblem(media) } };
  });
}

/** What is stored for a file, for the details dialog to prefill. */
export async function getMediaDetails(mediaId: string): Promise<MediaRightsResult> {
  return guardAction(async () => {
    await requireRole("MODERATOR");
    const media = await db.media.findUnique({
      where: { id: mediaId },
      select: {
        id: true,
        type: true,
        title: true,
        caption: true,
        altText: true,
        credit: true,
        sourceName: true,
        sourceUrl: true,
        license: true,
        rightsNote: true,
        transcript: true,
        rightsConfirmedAt: true,
      },
    });
    if (!media) return { ok: false, error: "That file no longer exists." };
    return { ok: true, media: { ...media, problem: rightsProblem(media) } };
  });
}
