"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth, revokeAllSessions, signIn, signOut } from "@/lib/auth/config";
import { CONNECT_COOKIE, issueConnectToken } from "@/lib/auth/oauthFlow";
import { verifyPassword } from "@/lib/auth/password";
import { TRUST_COOKIE } from "@/lib/auth/trustedDevice";
import { anonymiseAccount } from "@/lib/accountDeletion";
import { recordAudit, recordAuthEvent } from "@/lib/audit";
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

/** Rectification (GDPR Art. 16): the one profile field a reader shows. */
export async function updateProfile(input: { name: string }): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You are not signed in." };
  const parsed = z.string().trim().min(1, "Enter a name.").max(120).safeParse(input.name);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid name" };
  await db.user.update({ where: { id: session.user.id }, data: { name: parsed.data } });
  await recordAudit({
    actorId: session.user.id,
    action: "user.profile.update",
    targetType: "User",
    targetId: session.user.id,
    ip: await getClientIp(),
  });
  return { ok: true };
}

/**
 * Erasure (GDPR Art. 17 / CCPA §1798.105), self-service. The password is
 * required so an unattended signed-in browser cannot be used to destroy
 * an account. On success the person is signed out; the session token
 * would stop validating anyway, since anonymisation bumps sessionVersion.
 */
export async function deleteMyAccount(input: { password: string }): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You are not signed in." };

  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { id: true, passwordHash: true } });
  if (!user?.passwordHash) return { ok: false, error: "This account cannot be deleted from here." };
  const valid = await verifyPassword(user.passwordHash, input.password).catch(() => false);
  if (!valid) return { ok: false, error: "That isn't your password." };

  const result = await anonymiseAccount(user.id, { actorId: user.id, reason: "self" });
  if (!result.ok) return result;

  (await cookies()).delete(TRUST_COOKIE);
  await signOut({ redirect: false });
  return { ok: true };
}

/**
 * Starts "Connect Google" for somebody who is already signed in.
 *
 * The intent is carried to Google and back in a signed, short-lived
 * cookie naming this account, which the signIn callback in
 * lib/auth/config.ts reads — see lib/auth/oauthFlow.ts for why it is an
 * explicit token rather than something inferred from the session on the
 * way back.
 *
 * signIn() ends by throwing a redirect, so nothing after it runs.
 */
export async function connectGoogle(): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?from=/account");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, sessionVersion: true },
  });
  if (!user) redirect("/login");

  (await cookies()).set(CONNECT_COOKIE, issueConnectToken(user), {
    httpOnly: true,
    sameSite: "lax", // must survive the top-level redirect back from Google
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });

  await signIn("google", { redirectTo: "/account?google=connected" });
}

/**
 * Disconnects Google from this account.
 *
 * Refused when it would leave no way back in. Somebody who signed up with
 * Google has no password — `passwordHash` is null — so removing the only
 * Account row would lock them out of an account they could still see in
 * front of them. They are sent to set a password first.
 *
 * Note what this does *not* do: it does not revoke this site's access at
 * Google. That is the person's to do, at their Google account page, and
 * saying so is more honest than implying we can do it for them.
 */
export async function disconnectGoogle(): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not signed in." };

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, passwordHash: true, accounts: { select: { id: true, provider: true } } },
  });
  if (!user) return { ok: false, error: "Not signed in." };

  const google = user.accounts.filter((a) => a.provider === "google");
  if (!google.length) return { ok: true };

  const otherProviders = user.accounts.length - google.length;
  if (!user.passwordHash && otherProviders === 0) {
    return {
      ok: false,
      error:
        "Set a password before disconnecting Google — otherwise you would have no way left to sign in.",
    };
  }

  await db.account.deleteMany({ where: { userId: user.id, provider: "google" } });
  await recordAudit({
    actorId: user.id,
    action: "auth.google.unlinked",
    targetType: "User",
    targetId: user.id,
    metadata: { provider: "google" },
    ip: await getClientIp(),
  });

  revalidatePath("/account");
  return { ok: true };
}

/**
 * Ends every session for this account, including this one.
 *
 * The control `revokeAllSessions()` was written for, which until now had
 * no caller anywhere. It matters most right after a password change: the
 * password stops an attacker signing in again, but it does nothing about
 * the session they already hold, which renews on activity and so never
 * expires while they keep using it.
 *
 * This signs the current browser out too, and says so on the button. That
 * is a consequence of how sessionVersion works — it is one number per
 * account, not per device — and pretending otherwise would mean claiming
 * to end sessions this cannot distinguish.
 */
export async function signOutEverywhere(): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You are not signed in." };

  await revokeAllSessions(session.user.id);
  await recordAuthEvent({
    userId: session.user.id,
    action: "auth.sessions.revoked",
    ip: await getClientIp(),
  });

  // The trusted-device cookie is bound to sessionVersion, so it is already
  // void; clearing it saves the browser presenting something dead.
  (await cookies()).delete(TRUST_COOKIE);
  await signOut({ redirect: false });
  return { ok: true };
}
