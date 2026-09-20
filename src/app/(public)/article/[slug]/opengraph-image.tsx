import { ImageResponse } from "next/og";
import { db } from "@/lib/db";
import { SITE_NAME } from "@/lib/siteUrl";

/**
 * The image that appears when an article is shared.
 *
 * Generated from the headline rather than uploaded per article, so every
 * story has a card without anyone remembering to make one — which is the
 * difference between links that look like a publication and links that
 * look like a broken URL.
 *
 * Deliberately text only. Using the article's own cover image would mean
 * fetching and re-encoding an upload on every crawler request, and the
 * headline is what a reader actually reads in a timeline anyway.
 */
export const alt = "Article headline";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Crawlers request this repeatedly and the answer only changes when the
// article does.
export const revalidate = 3600;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const article = await db.article
    .findFirst({
      where: { slug, status: "PUBLISHED" },
      select: {
        title: true,
        dek: true,
        author: { select: { name: true } },
        category: { select: { name: true } },
      },
    })
    // A card is never worth failing a request over: a crawler that gets an
    // error shows no image at all, so fall back to the site name.
    .catch(() => null);

  const title = article?.title ?? SITE_NAME;
  const kicker = article?.category?.name?.toUpperCase() ?? "";
  const byline = article?.author.name ? `By ${article.author.name}` : SITE_NAME;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          // The site's paper and ink, so a shared link looks like the
          // site it leads to. Timelines are white, so the warm background
          // and the red rule also stop the card bleeding into the page.
          background: "#faf8f4",
          padding: "64px 72px 56px",
          borderLeft: "18px solid #b7271f",
          borderBottom: "6px solid #17140f",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          {kicker && (
            <div
              style={{
                fontSize: 26,
                letterSpacing: 5,
                fontWeight: 700,
                color: "#b7271f",
                marginBottom: 22,
              }}
            >
              {kicker}
            </div>
          )}
          <div
            style={{
              fontSize: title.length > 80 ? 60 : 76,
              lineHeight: 1.1,
              fontWeight: 700,
              letterSpacing: -1,
              color: "#17140f",
              // Long headlines must not overflow the card.
              display: "-webkit-box",
              WebkitLineClamp: 4,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {title}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            fontSize: 30,
            color: "#57524a",
          }}
        >
          <div style={{ display: "flex" }}>{byline}</div>
          <div style={{ display: "flex", color: "#17140f", fontWeight: 700 }}>{SITE_NAME}</div>
        </div>
      </div>
    ),
    size
  );
}
