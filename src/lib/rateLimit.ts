import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Sliding-window rate limits, keyed per endpoint + identifier (IP, or
// IP+email for auth endpoints — see security blueprint's Rate limiting &
// abuse prevention section). Backed by Upstash Redis when credentials are
// configured; falls back to an in-process sliding window for local dev so
// the limits are exercised even before a Redis instance is provisioned.
//
// The in-memory fallback is NOT safe for a multi-instance deployment (each
// instance would have its own counters) — it exists only so `npm run dev`
// enforces the same limits as production without requiring Upstash to be
// set up first. Set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
// before deploying anywhere with more than one server process.
const hasUpstash = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

const redis = hasUpstash
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  : null;

interface Window {
  count: number;
  resetAt: number;
}
const memoryStore = new Map<string, Window>();

function memoryLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const existing = memoryStore.get(key);

  if (!existing || existing.resetAt <= now) {
    memoryStore.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true, remaining: limit - 1 };
  }

  existing.count += 1;
  const success = existing.count <= limit;
  return { success, remaining: Math.max(0, limit - existing.count) };
}

// Periodically drop expired entries so the in-memory map doesn't grow
// unbounded across a long-running dev session.
setInterval(() => {
  const now = Date.now();
  for (const [key, w] of memoryStore) {
    if (w.resetAt <= now) memoryStore.delete(key);
  }
}, 60_000).unref?.();

function makeLimiter(limit: number, windowSeconds: number, prefix: string) {
  const upstash = redis
    ? new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
        prefix,
      })
    : null;

  return {
    async limit(identifier: string) {
      if (upstash) return upstash.limit(identifier);
      return memoryLimit(`${prefix}:${identifier}`, limit, windowSeconds * 1000);
    },
  };
}

// Tuned per the security blueprint: generous enough not to lock out a
// legitimate user fumbling their password, tight enough to blunt scripted
// abuse. All are per (endpoint, identifier) — identifier is usually
// `ip` or `ip:email` from the caller.
export const loginLimiter = makeLimiter(10, 60, "ratelimit:login");
// Its own bucket, not loginLimiter's. The login form calls the MFA
// pre-check and then the real sign-in for a single user action, so
// sharing one bucket silently halved the documented login allowance.
export const mfaCheckLimiter = makeLimiter(10, 60, "ratelimit:mfa-check");
export const registerLimiter = makeLimiter(5, 60 * 10, "ratelimit:register");
export const passwordResetLimiter = makeLimiter(3, 60 * 15, "ratelimit:pwreset");
export const commentLimiter = makeLimiter(5, 60, "ratelimit:comment");
export const mediaUploadLimiter = makeLimiter(20, 60, "ratelimit:media-upload");
// Likes/bookmarks/follows are cheap and legitimately clicked in bursts
// while reading, so this is generous — it exists to stop a script
// hammering the endpoint, not to pace an actual reader.
export const engagementLimiter = makeLimiter(60, 60, "ratelimit:engagement");
// Link previews make the *server* fetch a URL an author supplied, so this
// limit is about our own outbound traffic as much as about abuse: without
// it, one account could point the server at a list of hosts as fast as it
// can submit a form.
// Subscribing to push alerts happens once per device, so anything
// resembling a burst from one address is a script.
export const pushSubscribeLimiter = makeLimiter(10, 60 * 10, "ratelimit:push-subscribe");
// Every SMS costs money and every code is a guessable secret: three
// sends per account per quarter hour, and a small budget of guesses.
export const phoneCodeLimiter = makeLimiter(3, 60 * 15, "ratelimit:phone-code");
export const phoneVerifyLimiter = makeLimiter(10, 60 * 15, "ratelimit:phone-verify");
export const emailChangeLimiter = makeLimiter(3, 60 * 15, "ratelimit:email-change");
export const linkPreviewLimiter = makeLimiter(10, 60, "ratelimit:link-preview");
