import { NextResponse } from "next/server";
import { isCrossOriginRequest } from "@/lib/csrf";
import { requireVerifiedEmail, ForbiddenError, UnauthorizedError } from "@/lib/auth/rbac";
import { mediaUploadLimiter } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/request";
import { processUpload, UPLOAD_MAX_BYTES } from "@/lib/mediaPipeline";

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
//
// This is the proxied path: the bytes come through this server. With S3
// configured the client prefers /api/media/upload-url and uploads
// directly, so this server never holds a large video in memory. Both
// paths run the identical pipeline in lib/mediaPipeline.ts.

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

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // Check the declared size *before* reading the bytes. The per-type
  // limits in the pipeline are the real enforcement (they run against the
  // buffer we actually hold), but reading a multi-gigabyte upload into
  // memory just to then reject it is its own denial-of-service — so refuse
  // anything over the largest limit we'd ever accept before materializing
  // it.
  if (file.size > UPLOAD_MAX_BYTES) {
    return NextResponse.json({ error: "File is too large." }, { status: 413 });
  }

  const rawBuffer = Buffer.from(await file.arrayBuffer());

  const result = await processUpload(rawBuffer, session.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.media, { status: 201 });
}
