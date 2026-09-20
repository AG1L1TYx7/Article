import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { SiteHeader } from "@/components/SiteHeader";
import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from "@/lib/siteUrl";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Without metadataBase every Open Graph and Twitter URL is emitted
  // relative, and relative URLs in a share card are simply ignored — the
  // link unfurls with no image and often no title. It is the difference
  // between a share card working and not existing.
  metadataBase: siteUrl(),

  title: {
    default: SITE_NAME,
    // Pages set only their own title; the site name is appended here so
    // it can never drift between pages.
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,

  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },

  alternates: {
    canonical: "/",
    // Advertises the feed to readers and to feed readers that look for it
    // in the document head, which is how most subscribe buttons work.
    types: {
      "application/rss+xml": [{ url: "/feed.xml", title: `${SITE_NAME} — latest articles` }],
    },
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>
          <SiteHeader />
          {children}
        </Providers>
      </body>
    </html>
  );
}
