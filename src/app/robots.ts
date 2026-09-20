import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/siteUrl";

// Served per request like everything else here — nothing on this site is
// baked at build time — so a changed NEXTAUTH_URL is reflected at once.
export const dynamic = "force-dynamic";

/**
 * Not a security control — anyone can ignore it, and listing a private
 * path here advertises it. Everything disallowed below is already
 * protected server-side by src/proxy.ts and by the checks in each action;
 * this only keeps crawlers from wasting their budget on pages that will
 * redirect them to a login form, and out of the thin infinite space of
 * search result pages.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/api/", "/saved", "/following", "/notifications", "/search"],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
