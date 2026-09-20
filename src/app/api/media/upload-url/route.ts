import { NextResponse } from "next/server";
import { isCrossOriginRequest } from "@/lib/csrf";
import { requireVerifiedEmail, ForbiddenError, UnauthorizedError } from "@/lib/auth/rbac";
import { presignUpload } from "@/lib/storage";
import { mediaUploadLimiter } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/request";
import { VIDEO_MAX_BYTES } from "@/lib/mediaPipeline";
import { signUploadKey } from "@/lib/uploadToken";

/**
 * Hands the browser a URL it can upload to directly.
 *
 * The point is video: proxying a 200MB file through this server means
 * holding 200MB in memory per concurrent upload. Uploading straight to
 * object storage means the bytes never touch the app at all until it
 * fetches them back to check them.
 *
 * Returns 501 when S3 is not configured — there is nothing to pre-sign on
 * local disk — and the client falls back to the multipart route.
 *
 * Nothing about this weakens validation. The URL only permits writing to
 * a quarantine key, which the bucket policy must not expose publicly, and
 * the file is not servable until /api/media/finalize has identified,
 * re-encoded and scanned it.
 */
export async function POST(request: Request) {
  if (isCrossOriginRequest(request)) {
    // Same defense Next.js applies to Server Actions automatically —
    // Origin must agree with Host. See lib/csrf.ts.
    return NextResponse.json({ error: "Cross-origin request refused." }, { status: 403 });
  }

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

  let body: { extension?: unknown; size?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // Only used to name the quarantine object. The real type is decided
  // from magic bytes when the file is fetched back, so a lie here buys
  // nothing.
  const extension =
    typeof body.extension === "string" && /^[a-z0-9]{1,8}$/i.test(body.extension)
      ? body.extension.toLowerCase()
      : "bin";

  // Refuse obviously oversized uploads before issuing a URL, rather than
  // after the browser has spent ten minutes sending them.
  if (typeof body.size === "number" && body.size > VIDEO_MAX_BYTES) {
    return NextResponse.json({ error: "File is too large." }, { status: 413 });
  }

  const presigned = await presignUpload(extension);
  if (!presigned) {
    return NextResponse.json(
      { error: "Direct upload is not available.", fallback: "/api/media/upload" },
      { status: 501 }
    );
  }

  return NextResponse.json({
    uploadUrl: presigned.uploadUrl,
    storageKey: presigned.storageKey,
    expiresInSeconds: presigned.expiresInSeconds,
    // Binds the key to this person and this moment, so finalize cannot be
    // pointed at an arbitrary object in the bucket.
    token: signUploadKey(presigned.storageKey, session.user.id),
  });
}
