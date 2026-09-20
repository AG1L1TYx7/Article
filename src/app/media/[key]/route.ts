import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readLocalObject, isS3Configured } from "@/lib/storage";

// Local-disk media serving — dev only. When S3 is configured, Media.url
// already points at the bucket/CDN directly (see lib/storage.ts) and this
// route is never linked to; it 404s defensively if reached anyway.
//
// The scanStatus check is the enforcement point for "uploads aren't public
// until clean" (security blueprint) in the local-disk path: a PENDING
// video's storage key exists on disk, but this route refuses to serve it
// regardless of anyone guessing/requesting the URL directly.
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  if (isS3Configured()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { key } = await params;
  const media = await db.media.findUnique({ where: { storageKey: key } });
  if (!media || media.scanStatus !== "CLEAN") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let buffer: Buffer;
  try {
    buffer = await readLocalObject(key);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": media.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
