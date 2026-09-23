import { createHash } from "node:crypto";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import { db } from "@/lib/db";
import { storeObject } from "@/lib/storage";
import { isScanningConfigured, scanBuffer, type ScanResult } from "@/lib/scan";
import { isTranscodingConfigured, transcodeAudio, transcodeVideo, type TranscodeResult } from "@/lib/transcode";

/**
 * Turning uploaded bytes into something safe to serve.
 *
 * Extracted so the two ways a file can arrive — proxied through this
 * server as multipart, or uploaded straight to object storage and
 * processed afterwards — run the identical validate, re-encode and scan
 * sequence. Two copies of this would drift, and the copy that drifted
 * would be the one serving unchecked files.
 *
 * The rule for every kind is the same: what is served is never what was
 * uploaded. Images are re-encoded by sharp, video and audio by ffmpeg.
 * The malware scanner, when one is configured, is a second opinion on
 * the re-encoded bytes; when none is, the re-encode is the control, and
 * a video or audio file that could not be re-encoded is refused rather
 * than stored.
 */

export const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
export const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
// What file-type reports for the common containers. "audio/x-m4a" is an
// AAC file from Apple software; "audio/mp4" the same thing from others.
export const AUDIO_TYPES = new Set(["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/ogg", "audio/wav", "audio/vnd.wave", "audio/flac", "audio/x-flac"]);
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 200 * 1024 * 1024;
export const AUDIO_MAX_BYTES = 100 * 1024 * 1024;
/** The largest anything can be; routes refuse bigger bodies before reading them. */
export const UPLOAD_MAX_BYTES = VIDEO_MAX_BYTES;
const IMAGE_MAX_DIMENSION = 4000;

export type MediaKind = "image" | "video" | "audio";

export interface ProcessedMedia {
  id: string;
  url: string;
  type: "IMAGE" | "VIDEO" | "AUDIO";
  width?: number;
  height?: number;
  durationSecs?: number | null;
}

export type ProcessResult =
  | { ok: true; media: ProcessedMedia }
  | { ok: false; status: number; error: string };

/**
 * Identifies a file by its magic bytes.
 *
 * Never by filename, extension or the client's Content-Type — all three
 * are attacker-controlled. See the security plan's file upload section.
 */
export async function detectType(
  buffer: Buffer
): Promise<{ kind: MediaKind; mime: string; ext: string } | null> {
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected) return null;
  if (IMAGE_TYPES.has(detected.mime)) return { kind: "image", mime: detected.mime, ext: detected.ext };
  if (VIDEO_TYPES.has(detected.mime)) return { kind: "video", mime: detected.mime, ext: detected.ext };
  if (AUDIO_TYPES.has(detected.mime)) return { kind: "audio", mime: detected.mime, ext: detected.ext };
  return null;
}

export const UNSUPPORTED_TYPE_ERROR =
  "Unsupported file type. Allowed: JPEG, PNG, WEBP, GIF; MP4, WEBM, MOV; MP3, M4A, OGG, WAV, FLAC.";

/** Validates, re-encodes, scans and stores. The single path for both routes. */
export async function processUpload(rawBuffer: Buffer, uploadedById: string): Promise<ProcessResult> {
  const detected = await detectType(rawBuffer);
  if (!detected) return { ok: false, status: 400, error: UNSUPPORTED_TYPE_ERROR };

  switch (detected.kind) {
    case "image":
      return processImage(rawBuffer, uploadedById);
    case "video":
      return processEncoded(rawBuffer, detected, uploadedById, {
        type: "VIDEO",
        maxBytes: VIDEO_MAX_BYTES,
        limitError: "Video exceeds the 200MB limit.",
        transcode: transcodeVideo,
        word: "video",
      });
    case "audio":
      return processEncoded(rawBuffer, detected, uploadedById, {
        type: "AUDIO",
        maxBytes: AUDIO_MAX_BYTES,
        limitError: "Audio exceeds the 100MB limit.",
        transcode: transcodeAudio,
        word: "audio",
      });
  }
}

async function processImage(rawBuffer: Buffer, uploadedById: string): Promise<ProcessResult> {
  if (rawBuffer.byteLength > IMAGE_MAX_BYTES) {
    return { ok: false, status: 413, error: "Image exceeds the 10MB limit." };
  }

  // Re-encoding through sharp — rather than storing the uploaded bytes
  // as-is — strips embedded scripts/EXIF and neutralizes polyglot-file
  // attacks (a file that's simultaneously a valid image and, say, valid
  // HTML/JS to a browser that sniffs content rather than trusting
  // Content-Type). Always normalized to WebP so there's exactly one
  // output format to reason about, and capped in dimensions so a
  // pathological 40000x40000px source can't be used for a decompression-
  // bomb-style resource exhaustion attack.
  let webp: Buffer;
  let width: number | undefined;
  let height: number | undefined;
  try {
    webp = await sharp(rawBuffer)
      .rotate() // apply EXIF orientation before it gets stripped
      .resize({
        width: IMAGE_MAX_DIMENSION,
        height: IMAGE_MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .toBuffer();
    const meta = await sharp(webp).metadata();
    width = meta.width;
    height = meta.height;
  } catch {
    return { ok: false, status: 400, error: "Could not process image — the file may be corrupt." };
  }

  // Scanned after re-encoding, not instead of it. Re-encoding is what
  // actually neutralises an image; the scanner is a second opinion on the
  // bytes that will really be served.
  const refusal = scannerRefusal(await scanBuffer(webp));
  if (refusal) return refusal;

  const stored = await storeObject(webp, "image/webp", "webp");
  const media = await db.media.create({
    data: {
      type: "IMAGE",
      storageKey: stored.storageKey,
      url: stored.url,
      contentType: "image/webp",
      width,
      height,
      sizeBytes: webp.byteLength,
      checksum: createHash("sha256").update(webp).digest("hex"),
      // CLEAN without a scanner: the sharp re-encode is the control the
      // security plan relies on, and it has already happened above.
      scanStatus: "CLEAN",
      uploadedById,
    },
  });

  return { ok: true, media: { id: media.id, url: media.url, type: "IMAGE", width, height } };
}

/**
 * Video and audio share one path: re-encode with ffmpeg, scan the result
 * if a scanner exists, store only what passed.
 */
async function processEncoded(
  rawBuffer: Buffer,
  detected: { mime: string; ext: string },
  uploadedById: string,
  opts: {
    type: "VIDEO" | "AUDIO";
    maxBytes: number;
    limitError: string;
    transcode: (input: Buffer, ext: string) => Promise<TranscodeResult>;
    word: string;
  }
): Promise<ProcessResult> {
  if (rawBuffer.byteLength > opts.maxBytes) {
    return { ok: false, status: 413, error: opts.limitError };
  }

  // Re-encoded first, where ffmpeg is available: the counterpart to what
  // sharp does for images. Normalises whatever container and codec the
  // author's phone produced, and drops the source metadata — including
  // the coordinates a phone writes into a video.
  const transcoded = await opts.transcode(rawBuffer, detected.ext);
  if (transcoded.status === "error") {
    return {
      ok: false,
      status: 400,
      error: `Could not process that ${opts.word} — the file may be corrupt or in an unsupported format.`,
    };
  }

  const reencoded = transcoded.status === "ok";
  const servedBuffer = reencoded ? transcoded.data : rawBuffer;
  const servedMime = reencoded ? transcoded.contentType : detected.mime;
  const servedExt = reencoded ? transcoded.ext : detected.ext;
  const durationSecs = reencoded ? transcoded.durationSecs : null;

  // Scanned last, on the bytes that will actually be served. Scanning the
  // upload and then serving something else would be checking the wrong
  // file.
  const scan = await scanBuffer(servedBuffer);
  const refusal = scannerRefusal(scan);
  if (refusal) return refusal;

  // Nothing unconfirmed is ever written to storage.
  //
  // "Confirmed" means re-encoded by ffmpeg, or passed by a configured
  // scanner. Without either there is nothing standing between the
  // uploaded bytes and every reader, and on S3 Media.url points straight
  // at the bucket, so a stored-but-hidden file is not hidden at all.
  // Refusing here is the only version of this that is true on both
  // backends, and it leaves no unchecked bytes lying in a bucket.
  if (!reencoded && scan.status !== "clean") {
    return {
      ok: false,
      status: 503,
      error: isTranscodingConfigured()
        ? `Uploads are temporarily unavailable. Please try again shortly.`
        : `${capitalise(opts.word)} uploads are unavailable: neither ffmpeg nor a malware scanner is configured. Images still work. See FFMPEG_PATH and CLAMAV_HOST.`,
    };
  }

  const stored = await storeObject(servedBuffer, servedMime, servedExt);
  const media = await db.media.create({
    data: {
      type: opts.type,
      storageKey: stored.storageKey,
      url: stored.url,
      contentType: servedMime,
      durationSecs,
      sizeBytes: servedBuffer.byteLength,
      checksum: createHash("sha256").update(servedBuffer).digest("hex"),
      // Reached only when ffmpeg wrote the file, or the scanner said clean.
      scanStatus: "CLEAN",
      uploadedById,
    },
  });

  return { ok: true, media: { id: media.id, url: media.url, type: opts.type, durationSecs } };
}

/**
 * A scanner that is configured and did not say "clean" is final: a
 * positive is refused, and an unreachable or confused scanner refuses
 * too, because a scanner that fails open is not a scanner. With no
 * scanner configured there is nothing to refuse on; the re-encode rules
 * above decide.
 */
function scannerRefusal(scan: ScanResult): ProcessResult | null {
  if (scan.status === "infected") {
    return { ok: false, status: 422, error: "That file was rejected by the malware scanner." };
  }
  if (scan.status === "error" && isScanningConfigured()) {
    return { ok: false, status: 503, error: "Uploads are temporarily unavailable. Please try again shortly." };
  }
  return null;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
