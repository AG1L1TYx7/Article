import { SITE_NAME } from "@/lib/siteUrl";

/**
 * The logo, on the dark plate it was designed for.
 *
 * The artwork is a white "D" with blue and red type, drawn to sit on
 * black: on the site's paper the white mark would vanish. So it is shown
 * on a fixed near-black plate in both themes — in dark mode the plate is
 * the page and disappears; in light mode it reads as the masthead
 * block. The plate colour is deliberately not the ink token, which
 * flips to light in dark mode.
 *
 * `height` is the logo's rendered height in pixels; the width follows
 * the artwork's own ratio (about 3.2:1).
 */
export function Wordmark({ height = 32, className = "" }: { height?: number; className?: string }) {
  const pad = Math.round(height * 0.3);
  return (
    <span
      className={`inline-flex items-center rounded-md bg-[#0b0d10] ${className}`}
      style={{ padding: `${Math.round(pad * 0.6)}px ${pad}px` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a static brand asset in public/, no optimisation wanted */}
      <img src="/brand/logo.png" alt={SITE_NAME} height={height} style={{ height, width: "auto" }} decoding="async" />
    </span>
  );
}
