import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth/config";
import { isCrossOriginRequest } from "@/lib/csrf";
import { endpointHash, pushEnabled } from "@/lib/push";
import { pushSubscribeLimiter } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/request";

/**
 * POST   /api/push/subscribe — store this browser's push subscription.
 * DELETE /api/push/subscribe — forget it.
 *
 * Open to anonymous readers: breaking-news alerts are the feature most
 * worth having without an account. A signed-in reader's subscription is
 * attached to them so replies to their comments can reach the device too,
 * and so it is removed with their account.
 *
 * Guards are shape and origin — a strict schema, same-origin only, an
 * https endpoint, a rate limit — because there is no secret a browser
 * could present here. The worst an abuser can do is register endpoints
 * that will fail; those are deleted on the first failed delivery.
 */
const subscriptionSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(2048)
    .refine((u) => u.startsWith("https://"), "Push endpoints are https."),
  keys: z.object({
    p256dh: z.string().min(16).max(255),
    auth: z.string().min(8).max(255),
  }),
});

const unsubscribeSchema = z.object({ endpoint: z.string().url().max(2048) });

async function readJson(request: Request): Promise<unknown | undefined> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export async function POST(request: Request) {
  if (isCrossOriginRequest(request)) return new NextResponse(null, { status: 403 });
  if (!pushEnabled()) {
    return NextResponse.json({ error: "Push alerts are not configured." }, { status: 503 });
  }

  const { success } = await pushSubscribeLimiter.limit(await getClientIp());
  if (!success) return new NextResponse(null, { status: 429 });

  const parsed = subscriptionSchema.safeParse(await readJson(request));
  if (!parsed.success) return new NextResponse(null, { status: 400 });

  const session = await auth();
  const userId = session?.user?.id ?? null;
  const { endpoint, keys } = parsed.data;
  const hash = endpointHash(endpoint);

  await db.pushSubscription.upsert({
    where: { endpointHash: hash },
    // Re-subscribing from the same browser refreshes the keys and claims
    // the row for whoever is signed in now; a sign-out does not unclaim
    // it, because the alert is about the device, not the session.
    update: { p256dh: keys.p256dh, auth: keys.auth, failedAt: null, ...(userId ? { userId } : {}) },
    create: { endpoint, endpointHash: hash, p256dh: keys.p256dh, auth: keys.auth, userId },
  });

  return new NextResponse(null, { status: 204 });
}

export async function DELETE(request: Request) {
  if (isCrossOriginRequest(request)) return new NextResponse(null, { status: 403 });

  const parsed = unsubscribeSchema.safeParse(await readJson(request));
  if (!parsed.success) return new NextResponse(null, { status: 400 });

  // Anyone who knows the endpoint may remove it: the endpoint is a
  // 2KB unguessable URL that only that browser ever held.
  await db.pushSubscription.deleteMany({ where: { endpointHash: endpointHash(parsed.data.endpoint) } });
  return new NextResponse(null, { status: 204 });
}
