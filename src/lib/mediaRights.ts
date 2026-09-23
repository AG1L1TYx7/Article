/**
 * Who made a file and on what terms it is published.
 *
 * Every image, audio clip and video an article uses carries a credit and
 * a licence, and the person who added it confirms the newsroom has the
 * right to publish it under those terms. The credit line is shown under
 * the file and in the article's credits; the licence is linked to its
 * deed so a reader (or a rights holder) can check it; the confirmation is
 * what lets an article publish at all.
 *
 * Pure functions only, so the rules are unit tested and shared by the
 * editor dialog, the publish gate and the public page.
 */

export type MediaKind = "IMAGE" | "VIDEO" | "AUDIO";

export const MEDIA_LICENSES = [
  "OWN_WORK",
  "PERMISSION",
  "CC0",
  "CC_BY",
  "CC_BY_SA",
  "CC_BY_ND",
  "CC_BY_NC",
  "CC_BY_NC_SA",
  "CC_BY_NC_ND",
  "PUBLIC_DOMAIN",
  "OTHER",
] as const;
export type MediaLicenseCode = (typeof MEDIA_LICENSES)[number];

export interface LicenseInfo {
  code: MediaLicenseCode;
  /** The short name shown in a credit line, e.g. "CC BY 4.0". */
  label: string;
  /** What it means, for the person choosing it. */
  description: string;
  /** The deed a reader can check, or null when there is no public one. */
  url: string | null;
  /** Readers may save a copy: only when the licence itself allows it. */
  allowsDownload: boolean;
  /** Needs the creator's name to be valid at all (attribution licences). */
  requiresCredit: boolean;
  /** Needs a note explaining the basis, e.g. who granted permission and when. */
  requiresNote: boolean;
}

const CC = "https://creativecommons.org/licenses";

export const LICENSES: Record<MediaLicenseCode, LicenseInfo> = {
  OWN_WORK: {
    code: "OWN_WORK",
    label: "All rights reserved",
    description: "Made by this newsroom or its staff. We hold the copyright.",
    url: null,
    allowsDownload: false,
    requiresCredit: false,
    requiresNote: false,
  },
  PERMISSION: {
    code: "PERMISSION",
    label: "Used with permission",
    description: "The rights holder gave us permission or a licence. Say who and when in the note.",
    url: null,
    allowsDownload: false,
    requiresCredit: true,
    requiresNote: true,
  },
  CC0: {
    code: "CC0",
    label: "CC0 1.0",
    description: "The creator waived all rights. No attribution required, but we give it anyway.",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
    allowsDownload: true,
    requiresCredit: false,
    requiresNote: false,
  },
  CC_BY: {
    code: "CC_BY",
    label: "CC BY 4.0",
    description: "Free to use with credit to the creator.",
    url: `${CC}/by/4.0/`,
    allowsDownload: true,
    requiresCredit: true,
    requiresNote: false,
  },
  CC_BY_SA: {
    code: "CC_BY_SA",
    label: "CC BY-SA 4.0",
    description: "Free to use with credit; adaptations must carry the same licence.",
    url: `${CC}/by-sa/4.0/`,
    allowsDownload: true,
    requiresCredit: true,
    requiresNote: false,
  },
  CC_BY_ND: {
    code: "CC_BY_ND",
    label: "CC BY-ND 4.0",
    description: "Free to use unchanged, with credit. Do not crop, trim or edit it.",
    url: `${CC}/by-nd/4.0/`,
    allowsDownload: true,
    requiresCredit: true,
    requiresNote: false,
  },
  CC_BY_NC: {
    code: "CC_BY_NC",
    label: "CC BY-NC 4.0",
    description: "Free for non-commercial use with credit. Check this fits how the site is run.",
    url: `${CC}/by-nc/4.0/`,
    allowsDownload: true,
    requiresCredit: true,
    requiresNote: false,
  },
  CC_BY_NC_SA: {
    code: "CC_BY_NC_SA",
    label: "CC BY-NC-SA 4.0",
    description: "Non-commercial, with credit; adaptations must carry the same licence.",
    url: `${CC}/by-nc-sa/4.0/`,
    allowsDownload: true,
    requiresCredit: true,
    requiresNote: false,
  },
  CC_BY_NC_ND: {
    code: "CC_BY_NC_ND",
    label: "CC BY-NC-ND 4.0",
    description: "Non-commercial, unchanged, with credit.",
    url: `${CC}/by-nc-nd/4.0/`,
    allowsDownload: true,
    requiresCredit: true,
    requiresNote: false,
  },
  PUBLIC_DOMAIN: {
    code: "PUBLIC_DOMAIN",
    label: "Public domain",
    description: "Copyright has expired or never applied (e.g. a government work). Say why in the note.",
    url: "https://creativecommons.org/publicdomain/mark/1.0/",
    allowsDownload: true,
    requiresCredit: false,
    requiresNote: true,
  },
  OTHER: {
    code: "OTHER",
    label: "Other licence",
    description: "A stock licence, an agency contract, or another basis. Name it in the note.",
    url: null,
    allowsDownload: false,
    requiresCredit: true,
    requiresNote: true,
  },
};

export function isMediaLicense(value: unknown): value is MediaLicenseCode {
  return typeof value === "string" && (MEDIA_LICENSES as readonly string[]).includes(value);
}

/** The subset of a Media row the rights rules look at. */
export interface MediaRights {
  license: MediaLicenseCode | null;
  credit: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  rightsNote: string | null;
  rightsConfirmedAt: Date | null;
}

/**
 * Why a file is not ready to publish, or null when it is.
 *
 * The rules are deliberately few: a licence, a creator's name where the
 * licence demands one, a note where the basis is not self-evident, and
 * the confirmation. Anything more and people stop filling it in.
 */
export function rightsProblem(media: MediaRights): string | null {
  if (!media.license) return "Choose a licence.";
  const info = LICENSES[media.license];
  if (info.requiresCredit && !media.credit?.trim() && !media.sourceName?.trim()) {
    return "Name the creator or the source.";
  }
  if (info.requiresNote && !media.rightsNote?.trim()) {
    return info.code === "PERMISSION"
      ? "Say who gave permission, and when."
      : info.code === "PUBLIC_DOMAIN"
        ? "Say why it is in the public domain."
        : "Describe the licence.";
  }
  if (!media.rightsConfirmedAt) return "Confirm that we have the right to publish it.";
  return null;
}

export function isRightsComplete(media: MediaRights): boolean {
  return rightsProblem(media) === null;
}

export function allowsDownload(license: MediaLicenseCode | null): boolean {
  return license ? LICENSES[license].allowsDownload : false;
}

const KIND_WORD: Record<MediaKind, string> = { IMAGE: "Photo", VIDEO: "Video", AUDIO: "Audio" };

/**
 * The line under a file: "Photo: Maya Okafor / Reuters · CC BY 4.0".
 *
 * Creator and source are joined with a slash only when both are known;
 * the licence label follows when there is one. Returns null when there
 * is nothing at all to say, so callers can leave the caption alone.
 */
export function creditLine(kind: MediaKind, media: Pick<MediaRights, "credit" | "sourceName" | "license">): string | null {
  const who = [media.credit?.trim(), media.sourceName?.trim()].filter(Boolean).join(" / ");
  const licence = media.license && media.license !== "OWN_WORK" ? LICENSES[media.license].label : null;
  if (!who && !licence) return null;
  const parts = [who ? `${KIND_WORD[kind]}: ${who}` : KIND_WORD[kind], licence].filter(Boolean);
  return parts.join(" · ");
}

/**
 * Every file URL an article body refers to: the src of its images, video
 * and audio, and any nested <source>. Used to link Media rows to the
 * article and to check their rights before publishing. Runs on
 * sanitised HTML, which has already rejected anything but those tags.
 */
export function extractMediaUrls(html: string): string[] {
  const urls = new Set<string>();
  const re = /<(?:img|video|audio|source)\b[^>]*?\ssrc="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1]!.replace(/&amp;/g, "&");
    // A resized variant (?w=) is the same file.
    urls.add(raw.split("?")[0]!);
  }
  return [...urls];
}

/** hh:mm:ss or mm:ss, for a player's time display and the credits. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** ISO 8601 duration, which schema.org wants: 3m21s → "PT3M21S". */
export function isoDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${sec || (!h && !m) ? `${sec}S` : ""}`;
}
