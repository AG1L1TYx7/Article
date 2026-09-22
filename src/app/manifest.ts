import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/siteUrl";

// Per request, like every other route on this site; nothing is baked at
// build time.
export const dynamic = "force-dynamic";

/**
 * Makes the site installable: "Add to Home Screen" on a phone gives a
 * real icon and a standalone window rather than a browser bookmark.
 * Most readers arrive on a phone, and an installed site is the cheapest
 * form of return visit there is.
 *
 * The icons are static PNGs in public/icons, generated from the
 * wordmark by scripts/make-icons.mjs.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#fafaf7",
    theme_color: "#fafaf7",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
