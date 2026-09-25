import { db } from "@/lib/db";
import { extractMediaUrls, rightsProblem, type MediaLicenseCode } from "@/lib/mediaRights";

/**
 * The files an article uses, and whether they may be published.
 *
 * An article refers to its files by URL in the body (figures the editor
 * inserted, or a bare <img> from before figures existed) and by id for
 * the cover. Both are resolved to Media rows here so the relation on the
 * article, the credits under the story and the publish gate all agree
 * on what "the article's media" means.
 */
export const MEDIA_RIGHTS_SELECT = {
  id: true,
  type: true,
  url: true,
  contentType: true,
  title: true,
  caption: true,
  altText: true,
  credit: true,
  sourceName: true,
  sourceUrl: true,
  license: true,
  rightsNote: true,
  rightsConfirmedAt: true,
  transcript: true,
  durationSecs: true,
  sizeBytes: true,
  width: true,
  height: true,
} as const;

export interface ArticleMedia {
  id: string;
  type: "IMAGE" | "VIDEO" | "AUDIO";
  url: string;
  contentType: string;
  title: string | null;
  caption: string | null;
  altText: string | null;
  credit: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  license: MediaLicenseCode | null;
  rightsNote: string | null;
  rightsConfirmedAt: Date | null;
  transcript: string | null;
  durationSecs: number | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
}

/** Media rows for everything the body and cover refer to, body order first. */
export async function mediaReferencedBy(bodyHtml: string, coverImageId: string | null): Promise<ArticleMedia[]> {
  const urls = extractMediaUrls(bodyHtml);
  const rows = await db.media.findMany({
    where: {
      OR: [...(urls.length ? [{ url: { in: urls } }] : []), ...(coverImageId ? [{ id: coverImageId }] : [])],
    },
    select: MEDIA_RIGHTS_SELECT,
  });
  // Keep the order the story uses them in, cover first.
  const byUrl = new Map(rows.map((r) => [r.url, r]));
  const ordered: typeof rows = [];
  const cover = coverImageId ? rows.find((r) => r.id === coverImageId) : undefined;
  if (cover) ordered.push(cover);
  for (const url of urls) {
    const row = byUrl.get(url);
    if (row && !ordered.includes(row)) ordered.push(row);
  }
  return ordered as ArticleMedia[];
}

/** Records the relation so the article knows its files without re-parsing the body. */
export async function linkArticleMedia(articleId: string, media: { id: string }[]): Promise<void> {
  await db.article.update({
    where: { id: articleId },
    data: { media: { set: media.map((m) => ({ id: m.id })) } },
  });
}

/**
 * One line per file that cannot be published yet, or an empty list.
 * The message names the file so the person knows which "Details" to open.
 */
export function rightsBlockers(media: ArticleMedia[]): string[] {
  const out: string[] = [];
  for (const m of media) {
    const problem = rightsProblem(m);
    if (!problem) continue;
    const kind = m.type === "IMAGE" ? "image" : m.type === "VIDEO" ? "video" : "audio";
    const name = m.title || m.caption || m.altText || m.url.split("/").pop() || m.id;
    out.push(`${kind} "${name}": ${problem}`);
  }
  return out;
}

/** The refusal an author sees when publishing with unfinished credits. */
export function rightsBlockersMessage(blockers: string[]): string {
  const list = blockers.slice(0, 3).join("; ");
  const more = blockers.length > 3 ? ` (and ${blockers.length - 3} more)` : "";
  return `Every file needs a credit and licence before this can be published — open Details on each: ${list}${more}.`;
}
