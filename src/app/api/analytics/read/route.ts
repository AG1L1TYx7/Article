import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { recordRead } from "@/lib/analyticsCapture";
import { isCrossOriginRequest } from "@/lib/csrf";

/**
 * POST /api/analytics/read — one reader's reading session for one
 * article, sent by components/articles/ReadingBeacon.tsx as the page is
 * left. Aggregated into the day's row; nothing about the sender is kept.
 *
 * No authentication (readers are mostly anonymous), so the guards are
 * shape and origin: a strict schema with hard ceilings, same-origin only,
 * and the article must be a real published one. Anyone determined to
 * inflate a number can still do so from a browser — which is the
 * honest limit of analytics without tracking, and why the dashboard
 * calls these "raw" figures.
 */
const sampleSchema = z.object({
  articleId: z.string().min(1).max(64),
  activeSeconds: z.number().min(0).max(3600),
  scrollDepth: z.number().min(0).max(100),
});

export async function POST(request: Request) {
  if (isCrossOriginRequest(request)) return new NextResponse(null, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const parsed = sampleSchema.safeParse(body);
  if (!parsed.success) return new NextResponse(null, { status: 400 });

  const article = await db.article.findFirst({
    where: { id: parsed.data.articleId, status: "PUBLISHED" },
    select: { id: true },
  });
  if (!article) return new NextResponse(null, { status: 204 });

  await recordRead(article.id, parsed.data);
  return new NextResponse(null, { status: 204 });
}
