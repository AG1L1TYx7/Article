import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import { requireVerifiedEmail, ForbiddenError, UnauthorizedError } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { storeObject } from "@/lib/storage";
import { mediaUploadLimiter } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/request";

// This route intentionally lives under /api/, which src/proxy.ts's matcher
// already excludes — both to keep the RBAC check here (not duplicated at
// the proxy layer, consistent with how every other mutation in this app
// works) and, more importantly, because Next.js buffers any request body
// that passes through Proxy at a 10MB cap by default and *silently
// truncates* anything larger with no error to the client (see
// proxyClientMaxBodySize in the Next.js docs) — which would have corrupted
// every image over 10MB and effectively every video. A Server Action
// wasn't an option either: those cap request bodies at 1MB by default.
// Route Handlers under /api have neither limit.

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10MB
const VIDEO_MAX_BYTES = 200 * 1024 * 1024; // 200MB — the plan's target ceiling is higher (500MB) once this runs against real object storage with true direct-to-S3 uploads instead of proxying through this server; see lib/storage.ts.
const IMAGE_MAX_DIMENSION = 4000; // px, longest edge, after re-encode

export async function POST(request: Request) {
  let session;
  try {
    session = await requireVerifiedEmail("MODERATOR");
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const ip = await getClientIp();
  const { success } = await mediaUploadLimiter.limit(ip);
  if (!success) return NextResponse.json({ error: "Too many uploads, slow down." }, { status: 429 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // Check the declared size *before* reading the bytes. The per-type
  // limits below are the real enforcement (they run against the buffer we
  // actually hold), but reading a multi-gigabyte upload into memory just
  // to then reject it is its own denial-of-service — so refuse anything
  // over the largest limit we'd ever accept before materializing it.
  if (file.size > VIDEO_MAX_BYTES) {
    return NextResponse.json({ error: "File is too large." }, { status: 413 });
  }

  const rawBuffer = Buffer.from(await file.arrayBuffer());

  // Type is verified by magic bytes, never by filename/extension or the
  // client-supplied Content-Type — see security blueprint, File upload
  // attack surface.
  const detected = await fileTypeFromBuffer(rawBuffer);
  const mime = detected?.mime;

  if (mime && IMAGE_TYPES.has(mime)) {
    return handleImage(rawBuffer, session.user.id);
  }
  if (mime && VIDEO_TYPES.has(mime)) {
    return handleVideo(rawBuffer, mime, detected!.ext, session.user.id);
  }

  return NextResponse.json(
    { error: "Unsupported file type. Allowed: JPEG, PNG, WEBP, GIF, MP4, WEBM, MOV." },
    { status: 400 }
  );
}

async function handleImage(rawBuffer: Buffer, uploadedById: string) {
  if (rawBuffer.byteLength > IMAGE_MAX_BYTES) {
    return NextResponse.json({ error: "Image exceeds the 10MB limit." }, { status: 413 });
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
    const pipeline = sharp(rawBuffer)
      .rotate() // apply EXIF orientation before it gets stripped
      .resize({ width: IMAGE_MAX_DIMENSION, height: IMAGE_MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 });
    webp = await pipeline.toBuffer();
    const meta = await sharp(webp).metadata();
    width = meta.width;
    height = meta.height;
  } catch {
    return NextResponse.json({ error: "Could not process image — the file may be corrupt." }, { status: 400 });
  }

  const checksum = createHash("sha256").update(webp).digest("hex");
  const stored = await storeObject(webp, "image/webp", "webp");

  const media = await db.media.create({
    data: {
      type: "IMAGE",
      storageKey: stored.storageKey,
      url: stored.url,
      contentType: "image/webp",
      width,
      height,
      checksum,
      // Re-encoding through sharp is itself the sanitization step for
      // images (see comment above), so this is safe to mark CLEAN
      // immediately rather than PENDING.
      scanStatus: "CLEAN",
      uploadedById,
    },
  });

  return NextResponse.json({ id: media.id, url: media.url, width, height }, { status: 201 });
}

async function handleVideo(rawBuffer: Buffer, mime: string, ext: string, uploadedById: string) {
  if (rawBuffer.byteLength > VIDEO_MAX_BYTES) {
    return NextResponse.json({ error: "Video exceeds the 200MB limit." }, { status: 413 });
  }

  // Honest limitation: unlike images, video is stored as-is — there's no
  // ffmpeg (or equivalent transcoding service) available in this
  // environment to re-encode it the way sharp re-encodes images, and no
  // malware-scanning service is wired up either. scanStatus stays PENDING,
  // which means readLocalObject/the public media route refuse to serve it
  // (see security blueprint: uploads aren't public until scanStatus =
  // CLEAN). Before shipping video to production, wire a real transcode +
  // scan step — e.g. an S3 event triggering AWS MediaConvert plus a
  // malware-scanning Lambda or third-party API — and only then flip this
  // to CLEAN.
  const checksum = createHash("sha256").update(rawBuffer).digest("hex");
  const stored = await storeObject(rawBuffer, mime, ext);

  const media = await db.media.create({
    data: {
      type: "VIDEO",
      storageKey: stored.storageKey,
      url: stored.url,
      contentType: mime,
      checksum,
      scanStatus: "PENDING",
      uploadedById,
    },
  });

  return NextResponse.json(
    {
      id: media.id,
      url: media.url,
      pending: true,
      message: "Video uploaded but not yet published — video scanning isn't wired up in this environment.",
    },
    { status: 202 }
  );
}
