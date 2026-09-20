/**
 * Uploading a file from the browser.
 *
 * Tries the direct route first: ask the server for a pre-signed URL, PUT
 * the bytes straight to object storage, then ask the server to process
 * them. That keeps a large video out of the app server's memory entirely.
 *
 * Falls back to posting the file through the server when direct upload is
 * not available, which is the case on local disk — there is nothing to
 * pre-sign. Both routes end in the same validate, re-encode and scan
 * pipeline, so the fallback is not a weaker path, just a slower one.
 */

export interface UploadedMedia {
  id: string;
  url: string;
  width?: number;
  height?: number;
}

export type UploadOutcome =
  | { ok: true; media: UploadedMedia }
  | { ok: false; error: string };

function extensionOf(file: File): string {
  const match = /\.([a-z0-9]{1,8})$/i.exec(file.name);
  return match ? match[1].toLowerCase() : "bin";
}

async function uploadThroughServer(file: File): Promise<UploadOutcome> {
  const body = new FormData();
  body.append("file", file);

  const response = await fetch("/api/media/upload", { method: "POST", body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: data.error ?? "Upload failed." };
  return { ok: true, media: data as UploadedMedia };
}

export async function uploadFile(file: File): Promise<UploadOutcome> {
  try {
    const ticket = await fetch("/api/media/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extension: extensionOf(file), size: file.size }),
    });

    // 501 means object storage is not configured, so there is nothing to
    // pre-sign. Anything else that is not OK is a real error, and posting
    // the same file through the server would only fail again — except for
    // 501, which is the documented fallback.
    if (ticket.status === 501) return uploadThroughServer(file);

    const issued = await ticket.json().catch(() => ({}));
    if (!ticket.ok) return { ok: false, error: issued.error ?? "Upload failed." };

    const put = await fetch(issued.uploadUrl, { method: "PUT", body: file });
    if (!put.ok) return { ok: false, error: "Upload failed while sending the file." };

    const finalize = await fetch("/api/media/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storageKey: issued.storageKey, token: issued.token }),
    });
    const data = await finalize.json().catch(() => ({}));
    if (!finalize.ok) return { ok: false, error: data.error ?? "Upload failed." };

    return { ok: true, media: data as UploadedMedia };
  } catch {
    return { ok: false, error: "Upload failed. Check your connection and try again." };
  }
}
