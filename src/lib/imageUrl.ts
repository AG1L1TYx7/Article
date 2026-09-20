/**
 * Responsive variants of an uploaded image.
 *
 * Uploads are stored once at full size (up to 1600px after re-encoding).
 * Sending that to a 96px thumbnail on a phone is the single largest
 * avoidable cost on the front page, so the local media route can resize
 * on request: `/media/<key>?w=480`. Only the widths listed here are
 * honoured — an arbitrary `w` would let anyone fill the disk with
 * variants — and the route caches each one it makes.
 *
 * When object storage is configured, Media.url points at the bucket or
 * CDN directly and this site never sees the request, so no `srcset` is
 * produced; put an image-resizing CDN in front of the bucket for the
 * same effect. See docs/deployment.md.
 */
export const IMAGE_WIDTHS = [160, 320, 480, 800, 1200, 1600] as const;
export type ImageWidth = (typeof IMAGE_WIDTHS)[number];

export function isLocalMediaUrl(url: string): boolean {
  return url.startsWith("/media/");
}

export function imageVariantUrl(url: string, width: ImageWidth): string {
  return isLocalMediaUrl(url) ? `${url}?w=${width}` : url;
}

/** A `srcset` attribute value, or undefined when variants aren't available. */
export function imageSrcSet(url: string, widths: readonly ImageWidth[] = IMAGE_WIDTHS): string | undefined {
  if (!isLocalMediaUrl(url)) return undefined;
  return widths.map((w) => `${url}?w=${w} ${w}w`).join(", ");
}

export function parseImageWidth(raw: string | null): ImageWidth | null {
  if (!raw) return null;
  const n = Number(raw);
  return (IMAGE_WIDTHS as readonly number[]).includes(n) ? (n as ImageWidth) : null;
}
