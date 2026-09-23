import { NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { readLocalObject, isS3Configured } from "@/lib/storage";
import { contentRange, parseRange } from "@/lib/httpRange";
import { parseImageWidth } from "@/lib/imageUrl";
import { allowsDownload } from "@/lib/mediaRights";

// Local-disk media serving — dev only. When S3 is configured, Media.url
// already points at the bucket/CDN directly (see lib/storage.ts) and this
// route is never linked to; it 404s defensively if reached anyway.
//
// The scanStatus check is the enforcement point for "uploads aren't public
// until clean" (security blueprint) in the local-disk path: a PENDING
// video's storage key exists on disk, but this route refuses to serve it
// regardless of anyone guessing/requesting the URL directly.

/**
 * Headers for bytes somebody else uploaded.
 *
 * src/proxy.ts sets the site's security headers, but its matcher excludes
 * /media — so without these, user-supplied content is the one thing on
 * this site served with no protection at all. That is exactly backwards.
 *
 * `nosniff` is the important one: it stops a browser second-guessing the
 * Content-Type and deciding a file is HTML, which is the content-sniffing
 * attack that re-encoding images is meant to defend against. The CSP
 * neuters anything that does still manage to execute, and the
 * Content-Disposition keeps a filename from steering the browser.
 */
const MEDIA_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Content-Disposition": "inline",
  "Cache-Control": "public, max-age=31536000, immutable",
};

// Resized copies live beside the originals, one directory down, so
// deleting an upload's directory takes its variants with it.
const VARIANTS_DIR = join(process.cwd(), ".local-uploads", "_variants");

/**
 * A resized copy for `?w=`, made on first request and kept.
 *
 * Only images, only the listed widths (see lib/imageUrl.ts), and never
 * upscaled: asking for 1600 of an 800px original returns the original.
 * The variant keeps the upload's format so the Content-Type stays true.
 */
async function resizedVariant(key: string, width: number, original: () => Promise<Buffer>): Promise<Buffer> {
  const path = join(VARIANTS_DIR, `${key}.w${width}`);
  try {
    return await readFile(path);
  } catch {
    // Not made yet.
  }
  const source = await original();
  const resized = await sharp(source)
    .rotate() // honour EXIF orientation, as the upload pipeline did
    .resize({ width, withoutEnlargement: true })
    .toBuffer();
  await mkdir(VARIANTS_DIR, { recursive: true });
  await writeFile(path, resized);
  return resized;
}

export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  if (isS3Configured()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { key } = await params;
  const media = await db.media.findUnique({ where: { storageKey: key } });
  if (!media || media.scanStatus !== "CLEAN") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const query = new URL(request.url).searchParams;
  const width = parseImageWidth(query.get("w"));
  // "?download=1" offers the file as a download rather than playing it in
  // the tab — and only for a licence that lets readers keep a copy. For
  // anything else the parameter is ignored and the file streams as usual.
  const asDownload = query.get("download") === "1" && allowsDownload(media.license);
  const headers = asDownload
    ? { ...MEDIA_HEADERS, "Content-Disposition": `attachment; filename="${key}"` }
    : MEDIA_HEADERS;

  let buffer: Buffer;
  try {
    buffer =
      width && media.type === "IMAGE"
        ? await resizedVariant(key, width, () => readLocalObject(key))
        : await readLocalObject(key);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const range = parseRange(request.headers.get("range"), buffer.byteLength);

  if (range.kind === "unsatisfiable") {
    return new NextResponse(null, {
      status: 416,
      headers: {
        ...headers,
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${buffer.byteLength}`,
      },
    });
  }

  if (range.kind === "partial") {
    const slice = buffer.subarray(range.start, range.end + 1);
    return new NextResponse(new Uint8Array(slice), {
      status: 206,
      headers: {
        ...headers,
        "Content-Type": media.contentType,
        "Accept-Ranges": "bytes",
        "Content-Range": contentRange(range.start, range.end, buffer.byteLength),
        "Content-Length": String(slice.byteLength),
      },
    });
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      ...headers,
      "Content-Type": media.contentType,
      // Advertised even on a full response: it is how a player learns it
      // may seek at all.
      "Accept-Ranges": "bytes",
      "Content-Length": String(buffer.byteLength),
    },
  });
}
