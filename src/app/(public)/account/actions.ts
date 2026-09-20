"use server";

import { cookies } from "next/headers";
import { auth } from "@/lib/auth/config";
import { TRUST_COOKIE } from "@/lib/auth/trustedDevice";
import { recordAuthEvent } from "@/lib/audit";
import { getClientIp } from "@/lib/request";

/**
 * Clears the "remember this device" cookie for two-factor authentication,
 * so the next login on this browser asks for a code again. Only this
 * browser: the token is a cookie, not a server record, so there is
 * nothing else to revoke. Re-enrolling MFA forgets every device at once.
 */
export async function forgetThisDevice(): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false };
  (await cookies()).delete(TRUST_COOKIE);
  await recordAuthEvent({ userId: session.user.id, action: "auth.mfa.device_forgotten", ip: await getClientIp() });
  return { ok: true };
}
