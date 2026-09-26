import { db } from "@/lib/db";
import { processUpload, IMAGE_MAX_BYTES } from "@/lib/mediaPipeline";

/**
 * Bringing a Google profile picture here, once, instead of pointing at it.
 *
 * Storing the `googleusercontent.com` URL and rendering it would be two
 * lines. It would also mean that every time anybody loads a page showing
 * that avatar — a comment thread, an author page — their browser makes a
 * request to Google carrying their IP address and the page they are on.
 * That is a transfer of the *reader's* personal data to a third party,
 * about readers who never signed in and never agreed to anything, and it
 * would have to be disclosed in the privacy policy and defended under
 * Art. 6. It would also mean widening img-src in the CSP.
 *
 * So the picture is fetched once, at sign-in, and re-hosted. After that
 * the image is an ordinary upload: re-encoded to WebP by sharp — which
 * strips the EXIF the original may carry — stored where every other image
 * is stored, and served from this origin.
 *
 * Failure is not an error. An avatar is decoration; if Google is slow, the
 * URL 404s, or the bytes are not an image, the account simply has no
 * picture and the person can upload one. Nothing about a sign-in should
 * depend on it, which is why every path here returns rather than throws.
 */

/** Google's picture URLs are always on this host. Anything else is refused. */
const ALLOWED_HOSTS = new Set(["lh3.googleusercontent.com", "lh4.googleusercontent.com", "lh5.googleusercontent.com", "lh6.googleusercontent.com"]);

/** Generous for a 96px avatar; a smaller cap than uploads allow. */
const MAX_BYTES = Math.min(2 * 1024 * 1024, IMAGE_MAX_BYTES);
const FETCH_TIMEOUT_MS = 5000;

/**
 * Fetches the picture and sets it as the account's avatar.
 *
 * Only ever called for an account that has none — a picture the person
 * uploaded here, or one imported on a previous sign-in, is never replaced.
 * Google changes these URLs when somebody changes their Google picture,
 * and silently overwriting an avatar somebody chose here would be wrong.
 */
export async function importGoogleAvatar(userId: string, pictureUrl: string | null | undefined): Promise<void> {
  if (!pictureUrl) return;

  const current = await db.user.findUnique({ where: { id: userId }, select: { avatarUrl: true } });
  if (!current || current.avatarUrl) return;

  const buffer = await fetchPicture(pictureUrl);
  if (!buffer) return;

  // The same pipeline every uploaded image goes through: magic-byte type
  // detection, sharp re-encode, malware scan where one is configured,
  // stored object plus Media row. Attributed to the account itself, which
  // is true — it is their picture.
  const result = await processUpload(buffer, userId).catch(() => null);
  if (!result || !result.ok) return;

  await db.user
    .update({ where: { id: userId }, data: { avatarUrl: result.media.url } })
    .catch(() => {});
}

/**
 * The bytes, or null.
 *
 * The URL comes from Google's ID token rather than from a person, so this
 * is not the open server-side request forgery surface that link previews
 * are (see docs/link-previews.md). It is still pinned to Google's own
 * hosts, given a timeout and a size cap, and refused if it redirects
 * somewhere else — an unchecked fetch of a URL from an external system is
 * how that class of bug starts, whoever supplied the URL.
 */
async function fetchPicture(rawUrl: string): Promise<Buffer | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) return null;

  try {
    const res = await fetch(url, {
      // A redirect off Google's hosts is the thing being guarded against,
      // and there is no legitimate reason for one here.
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BYTES) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    // Checked again after reading: Content-Length is a claim, not a fact.
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) return null;
    return buffer;
  } catch {
    return null;
  }
}
