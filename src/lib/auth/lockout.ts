// Exponential backoff after repeated failed logins, tracked per account (and
// per IP at the rate-limit layer — see src/lib/rateLimit.ts) so an attacker
// can't dodge the lockout by rotating accounts.
const MAX_ATTEMPTS_BEFORE_LOCK = 5;
const BASE_LOCK_MINUTES = 2;
const MAX_LOCK_MINUTES = 60 * 24;

export function isLocked(lockedUntil: Date | null): boolean {
  return !!lockedUntil && lockedUntil.getTime() > Date.now();
}

/** Given the failure count *after* this attempt, returns a lock expiry or null. */
export function nextLockout(failedCount: number): Date | null {
  if (failedCount < MAX_ATTEMPTS_BEFORE_LOCK) return null;
  const over = failedCount - MAX_ATTEMPTS_BEFORE_LOCK;
  const minutes = Math.min(BASE_LOCK_MINUTES * 2 ** over, MAX_LOCK_MINUTES);
  return new Date(Date.now() + minutes * 60_000);
}
