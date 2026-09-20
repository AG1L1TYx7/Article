import { createHash } from "node:crypto";
import webpush, { WebPushError, type PushSubscription as WebPushSubscription } from "web-push";
import { db } from "@/lib/db";
import { breakingNewsPayload, serialisePayload, type PushPayload } from "@/lib/pushPayload";

/**
 * Web Push: alerts that reach a phone or desktop while the site is closed.
 *
 * How it fits together
 *   - The browser subscribes through its own push service (Google's,
 *     Apple's or Mozilla's) and hands us an endpoint plus two keys. That
 *     is stored as a PushSubscription row — see /api/push/subscribe.
 *   - When something happens, the server encrypts a small JSON payload to
 *     those keys and POSTs it to the endpoint, signed with our VAPID key
 *     so the push service knows which site is sending.
 *   - public/sw.js receives it and shows the notification.
 *
 * The push service sees an encrypted blob and our origin. It never sees
 * the text, and we never see anything about the device beyond the opaque
 * endpoint it gave us.
 *
 * Configuration is three environment variables, generated once with
 * `npm run push:keys`:
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto: or https:)
 * With none of them set, the whole feature is off: the toggle does not
 * render and the send functions return early. Nothing else breaks.
 */

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || null;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || null;
const SUBJECT =
  process.env.VAPID_SUBJECT ||
  (process.env.LEGAL_CONTACT_EMAIL ? `mailto:${process.env.LEGAL_CONTACT_EMAIL}` : null);

/** Set once per process; web-push holds these as module state. */
let configured = false;
function configure(): boolean {
  if (configured) return true;
  if (!PUBLIC_KEY || !PRIVATE_KEY || !SUBJECT) return false;
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
  configured = true;
  return true;
}

export function pushEnabled(): boolean {
  return !!(PUBLIC_KEY && PRIVATE_KEY && SUBJECT);
}

/** The key the browser needs to subscribe. Public by definition. */
export function vapidPublicKey(): string | null {
  return pushEnabled() ? PUBLIC_KEY : null;
}

/** The unique key for an endpoint: a utf8mb4 index cannot cover a 2KB column. */
export function endpointHash(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

interface StoredSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * How many devices one breaking story reaches in a single publish, and
 * how many deliveries are in flight at once. Every send is an HTTPS
 * request to a push service; at real subscriber numbers this belongs in
 * a queue, but the bound keeps the inline version from running away.
 */
const FANOUT_LIMIT = 10_000;
const CONCURRENCY = 25;
/** How long the push service may hold the message for an offline device. */
const TTL_SECONDS = 60 * 60 * 6;

async function deliver(sub: StoredSubscription, body: string): Promise<"sent" | "gone" | "failed"> {
  const target: WebPushSubscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  };
  try {
    await webpush.sendNotification(target, body, { TTL: TTL_SECONDS, urgency: "high" });
    return "sent";
  } catch (error) {
    // 404 and 410 mean the subscription no longer exists at the push
    // service — the person revoked permission or the browser rotated it.
    // Keeping the row would mean failing at it forever.
    if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
      return "gone";
    }
    return "failed";
  }
}

/**
 * Sends one payload to a set of subscriptions, in bounded parallel, and
 * tidies the table as it goes: gone rows are deleted, delivered rows get
 * a fresh lastUsedAt, and other failures are stamped so the retention
 * purge can remove rows that never recover (lib/retention.ts).
 */
export async function sendToSubscriptions(
  subs: StoredSubscription[],
  payload: PushPayload
): Promise<{ sent: number; gone: number; failed: number }> {
  if (!configure() || subs.length === 0) return { sent: 0, gone: 0, failed: 0 };

  const body = serialisePayload(payload);
  const now = new Date();
  const outcome = { sent: [] as string[], gone: [] as string[], failed: [] as string[] };

  // A simple worker pool: CONCURRENCY sends at a time, no dependency.
  let next = 0;
  async function worker() {
    while (next < subs.length) {
      const sub = subs[next++]!;
      const result = await deliver(sub, body);
      outcome[result].push(sub.id);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, subs.length) }, worker));

  await Promise.all([
    outcome.sent.length
      ? db.pushSubscription.updateMany({
          where: { id: { in: outcome.sent } },
          data: { lastUsedAt: now, failedAt: null },
        })
      : null,
    outcome.gone.length ? db.pushSubscription.deleteMany({ where: { id: { in: outcome.gone } } }) : null,
    outcome.failed.length
      ? db.pushSubscription.updateMany({
          where: { id: { in: outcome.failed }, failedAt: null },
          data: { failedAt: now },
        })
      : null,
  ]);

  return { sent: outcome.sent.length, gone: outcome.gone.length, failed: outcome.failed.length };
}

/**
 * A breaking story, to every device that opted in. Unlike the in-app
 * alert, which goes only to followers of the author or section, push
 * subscribers have explicitly asked for breaking news and nothing else —
 * that is the whole promise of the toggle — so all of them get it.
 *
 * Re-checks the article's state itself: this is the one place that
 * decides a story is worth waking a phone for.
 */
export async function pushBreakingNews(articleId: string): Promise<void> {
  if (!pushEnabled()) return;
  const article = await db.article.findUnique({
    where: { id: articleId },
    select: { slug: true, title: true, dek: true, status: true, isBreaking: true },
  });
  if (!article || article.status !== "PUBLISHED" || !article.isBreaking) return;

  const subs = await db.pushSubscription.findMany({
    select: { id: true, endpoint: true, p256dh: true, auth: true },
    orderBy: { createdAt: "asc" },
    take: FANOUT_LIMIT,
  });
  await sendToSubscriptions(subs, breakingNewsPayload(article));
}

/** One person's devices, for something that concerns only them. */
export async function pushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!pushEnabled()) return;
  const subs = await db.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  await sendToSubscriptions(subs, payload);
}
