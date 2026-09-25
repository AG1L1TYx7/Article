import { randomInt } from "node:crypto";
import { db } from "@/lib/db";
import { FALLBACK, MAX, MIN, RESERVED, handleStem } from "@/lib/auth/handleStem";

/**
 * The database half of choosing a handle: taking the stem the rules in
 * lib/auth/handleStem.ts produce and finding one nobody else holds.
 */

/** Four digits, uniform, from the CSPRNG — not Math.random. */
function suffix(): string {
  return String(randomInt(1000, 10000));
}

/**
 * A handle no other account holds.
 *
 * The unique index on User.handle is the real guarantee; this only avoids
 * provoking it. `createUser` still runs inside Prisma's own error
 * handling, and a collision between the check and the insert would surface
 * as a failed sign-in the person can simply retry — vanishingly unlikely
 * with a random suffix drawn from ten thousand.
 */
export async function uniqueHandle(name: string | null | undefined): Promise<string> {
  let stem = handleStem(name);

  // Too short to stand on its own ("Jo" gives "jo"): keep it, but it will
  // always carry a suffix, which takes it over the minimum.
  if (stem.length === 0 || RESERVED.has(stem)) stem = FALLBACK;

  if (stem.length >= MIN && !RESERVED.has(stem)) {
    const taken = await db.user.findUnique({ where: { handle: stem }, select: { id: true } });
    if (!taken) return stem;
  }

  // Ten attempts at stem-NNNN. Each draws from 9000 values, so exhausting
  // them means thousands of people share a name — at which point a longer
  // random tail is the honest answer rather than looping forever.
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = `${stem}-${suffix()}`.slice(0, MAX);
    const taken = await db.user.findUnique({ where: { handle: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }

  const wide = `${stem}-${suffix()}${suffix()}`.slice(0, MAX);
  return wide;
}
