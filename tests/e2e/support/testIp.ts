import { randomInt } from "node:crypto";

/**
 * A unique synthetic client IP per test.
 *
 * The app rate limits per IP, so tests that share one exhaust each
 * other's budget — registration is only 5 per 10 minutes. A module-level
 * counter isn't enough: Playwright runs each spec file in its own worker
 * process, so every worker restarts the counter and collides with the
 * others. Randomness plus the worker index avoids that, and keeps the
 * real limiter in play rather than disabling it for tests.
 */
export function uniqueTestIp(): string {
  const worker = Number(process.env.TEST_PARALLEL_INDEX ?? 0);
  return `10.${100 + (worker % 100)}.${randomInt(1, 255)}.${randomInt(1, 255)}`;
}
