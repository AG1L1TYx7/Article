import { NextResponse } from "next/server";
import { requireVerifiedEmail, ForbiddenError, UnauthorizedError } from "@/lib/auth/rbac";
import { deleteObject, isQuarantineKey, readObject } from "@/lib/storage";
import { mediaUploadLimiter } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/request";
import { processUpload, VIDEO_MAX_BYTES } from "@/lib/mediaPipeline";
import { verifyUploadKey } from "@/lib/uploadToken";

/**
 * Processes a file the browser uploaded directly.
 *
 * This is where a direct upload becomes as safe as a proxied one: the
 * bytes are fetched back out of quarantine and run through exactly the
 * same identify, re-encode and scan sequence — the same function, not a
 * parallel copy of it.
 *
 * The quarantine object is deleted either way. Leaving unscanned bytes in
 * a bucket after rejecting them would defeat the point of quarantining
 * them in the first place.
 */
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

  let body: { storageKey?: unknown; token?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const storageKey = typeof body.storageKey === "string" ? body.storageKey : "";
  const token = typeof body.token === "string" ? body.token : "";

  // Shape first: this must be a key this server issued, under the
  // quarantine prefix, with nothing that could climb out of it.
  if (!isQuarantineKey(storageKey)) {
    return NextResponse.json({ error: "Unknown upload." }, { status: 400 });
  }
  // Then provenance: issued to this account, recently. Without this,
  // finalize would fetch and process any object named by any moderator.
  if (!verifyUploadKey(token, storageKey, session.user.id)) {
    return NextResponse.json({ error: "Unknown upload." }, { status: 400 });
  }

  let raw: Buffer;
  try {
    raw = await readObject(storageKey);
  } catch {
    // Most often: the browser never completed the PUT.
    return NextResponse.json({ error: "That upload could not be found." }, { status: 404 });
  }

  try {
    if (raw.byteLength > VIDEO_MAX_BYTES) {
      return NextResponse.json({ error: "File is too large." }, { status: 413 });
    }

    const result = await processUpload(raw, session.user.id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.media, { status: 201 });
  } finally {
    // Whatever happened, quarantine does not keep the bytes. A failure
    // here is not worth failing the request over — the object is
    // unreferenced and a lifecycle rule on the prefix is the backstop.
    await deleteObject(storageKey).catch(() => {});
  }
}
