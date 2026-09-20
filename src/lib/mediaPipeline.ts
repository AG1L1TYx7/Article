import { createHash } from "node:crypto";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import { db } from "@/lib/db";
import { storeObject } from "@/lib/storage";
import { isSafeToServe, isScanningConfigured, scanBuffer } from "@/lib/scan";
import { transcodeVideo } from "@/lib/transcode";

/**
 * Turning uploaded bytes into something safe to serve.
 *
 * Extracted so the two ways a file can arrive — proxied through this
 * server as multipart, or uploaded straight to object storage and
 * processed afterwards — run the identical validate, re-encode and scan
 * sequence. Two copies of this would drift, and the copy that drifted
 * would be the one serving unchecked files.
 */

export const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
export const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 200 * 1024 * 1024;
const IMAGE_MAX_DIMENSION = 4000;

export interface ProcessedMedia {
  id: string;
  url: string;
  width?: number;
  height?: number;
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
): Promise<{ kind: "image" | "video"; mime: string; ext: string } | null> {
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected) return null;
  if (IMAGE_TYPES.has(detected.mime)) return { kind: "image", mime: detected.mime, ext: detected.ext };
  if (VIDEO_TYPES.has(detected.mime)) return { kind: "video", mime: detected.mime, ext: detected.ext };
  return null;
}

export const UNSUPPORTED_TYPE_ERROR =
  "Unsupported file type. Allowed: JPEG, PNG, WEBP, GIF, MP4, WEBM, MOV.";

/** Validates, re-encodes, scans and stores. The single path for both routes. */
export async function processUpload(rawBuffer: Buffer, uploadedById: string): Promise<ProcessResult> {
  const detected = await detectType(rawBuffer);
  if (!detected) return { ok: false, status: 400, error: UNSUPPORTED_TYPE_ERROR };

  return detected.kind === "image"
    ? processImage(rawBuffer, uploadedById)
    : processVideo(rawBuffer, detected.mime, detected.ext, uploadedById);
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
  const scan = await scanBuffer(webp);
  if (scan.status === "infected") {
    return { ok: false, status: 422, error: "That file was rejected by the malware scanner." };
  }
  if (scan.status === "error") {
    return {
      ok: false,
      status: 503,
      error: "Uploads are temporarily unavailable. Please try again shortly.",
    };
  }

  const stored = await storeObject(webp, "image/webp", "webp");
  const media = await db.media.create({
    data: {
      type: "IMAGE",
      storageKey: stored.storageKey,
      url: stored.url,
      contentType: "image/webp",
      width,
      height,
      checksum: createHash("sha256").update(webp).digest("hex"),
      // Unlike video, an image is CLEAN without a scanner: the sharp
      // re-encode is the control the security plan relies on, and it has
      // already happened above.
      scanStatus: "CLEAN",
      uploadedById,
    },
  });

  return { ok: true, media: { id: media.id, url: media.url, width, height } };
}

async function processVideo(
  rawBuffer: Buffer,
  mime: string,
  ext: string,
  uploadedById: string
): Promise<ProcessResult> {
  if (rawBuffer.byteLength > VIDEO_MAX_BYTES) {
    return { ok: false, status: 413, error: "Video exceeds the 200MB limit." };
  }

  // Re-encoded first, where ffmpeg is available: the counterpart to what
  // sharp does for images. Normalises whatever container and codec the
  // author's phone produced, and drops the source metadata — including
  // the coordinates a phone writes into the file.
  const transcoded = await transcodeVideo(rawBuffer, ext);
  if (transcoded.status === "error") {
    return {
      ok: false,
      status: 400,
      error: "Could not process that video — the file may be corrupt or in an unsupported format.",
    };
  }

  const servedBuffer = transcoded.status === "ok" ? transcoded.data : rawBuffer;
  const servedMime = transcoded.status === "ok" ? transcoded.contentType : mime;
  const servedExt = transcoded.status === "ok" ? transcoded.ext : ext;

  // Scanned last, on the bytes that will actually be served. Scanning the
  // upload and then serving something else would be checking the wrong
  // file.
  const scan = await scanBuffer(servedBuffer);

  // Nothing unconfirmed is ever written to storage.
  //
  // This used to store the video anyway and mark the row PENDING, relying
  // on the /media route to refuse it. That guarantee only ever held for
  // local disk: with S3 configured, Media.url points straight at the
  // bucket and the app's route is not in the path at all — so an unscanned
  // video was publicly readable, and its URL was handed to the client.
  // Refusing here is the only version of this that is true on both
  // backends, and it leaves no unscanned bytes lying in a bucket.
  if (!isSafeToServe(scan)) {
    if (scan.status === "infected") {
      return { ok: false, status: 422, error: "That file was rejected by the malware scanner." };
    }
    if (!isScanningConfigured()) {
      return {
        ok: false,
        status: 503,
        error:
          "Video uploads are unavailable: no malware scanner is configured. Images still work. See CLAMAV_HOST.",
      };
    }
    return {
      ok: false,
      status: 503,
      error: "Uploads are temporarily unavailable. Please try again shortly.",
    };
  }

  const stored = await storeObject(servedBuffer, servedMime, servedExt);
  const media = await db.media.create({
    data: {
      type: "VIDEO",
      storageKey: stored.storageKey,
      url: stored.url,
      contentType: servedMime,
      checksum: createHash("sha256").update(servedBuffer).digest("hex"),
      // Reached only when the scanner said clean.
      scanStatus: "CLEAN",
      uploadedById,
    },
  });

  return { ok: true, media: { id: media.id, url: media.url } };
}
