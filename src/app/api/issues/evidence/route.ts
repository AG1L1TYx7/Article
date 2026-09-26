import { NextResponse } from "next/server";
import { isCrossOriginRequest } from "@/lib/csrf";
import { requireVerifiedPermission, ForbiddenError, UnauthorizedError } from "@/lib/auth/rbac";
import { mediaUploadLimiter } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/request";
import { detectType, processUpload, IMAGE_MAX_BYTES } from "@/lib/mediaPipeline";

/**
 * Evidence attached to a reported issue.
 *
 * A separate route from /api/media/upload rather than a loosened version
 * of it, because the two have almost nothing in common but the pipeline.
 * That one is for newsroom staff publishing articles and takes video up to
 * 200MB; this one is for any verified member, which is a far wider group,
 * so it is narrower in every other respect:
 *
 *   - **Images only.** Video needs a ClamAV daemon to be servable at all
 *     (see docs/cpanel.md), so on most deployments an uploaded video would
 *     be accepted and then never shown — which looks like the platform
 *     losing somebody's evidence. Refusing it outright is honest.
 *   - **Gated on `issue.submit` and a verified address**, not on a staff
 *     role.
 *
 * Under /api for the same reason the other route is: Proxy buffers request
 * bodies at 10MB and silently truncates beyond it.
 *
 * The pipeline does the security work, and one part of it matters more
 * here than anywhere else on the site: sharp re-encodes every image, which
 * strips EXIF. A photograph of something somebody was not supposed to
 * photograph usually carries the coordinates of where they stood to take
 * it, and publishing that would locate the reporter far more precisely
 * than a byline ever could.
 */
export async function POST(request: Request) {
  if (isCrossOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-origin request refused." }, { status: 403 });
  }

  let session;
  try {
    session = await requireVerifiedPermission("issue.submit");
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
  if (file.size > IMAGE_MAX_BYTES) {
    return NextResponse.json({ error: "That photo is larger than 10MB." }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Typed by magic bytes before anything else touches it — never by the
  // filename or the Content-Type the browser claimed.
  const detected = await detectType(buffer);
  if (!detected || detected.kind !== "image") {
    return NextResponse.json(
      { error: "Photos only for now — JPEG, PNG, WEBP or GIF." },
      { status: 400 }
    );
  }

  const result = await processUpload(buffer, session.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.media, { status: 201 });
}
