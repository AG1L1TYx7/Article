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
import { createToken } from "@/lib/auth/tokens";
import { sendEmail } from "@/lib/email";
import { getBaseUrl } from "@/lib/url";
import { SITE_NAME } from "@/lib/siteUrl";
import { emailChangeLimiter, phoneCodeLimiter, phoneVerifyLimiter } from "@/lib/rateLimit";
import { isSixDigitCode, maskPhone, normalisePhone } from "@/lib/phoneFormat";
import {
  PHONE_CODE_MAX_ATTEMPTS,
  PHONE_CODE_TTL_MS,
  encryptPhone,
  generatePhoneCode,
  hashPhoneCode,
  phoneCodeMatches,
  phoneHash,
} from "@/lib/phone";
import { phoneCodeMessage, sendSms } from "@/lib/sms";
import { displayName, profileSchema } from "@/lib/profile";

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

/**
 * Rectification (GDPR Art. 16): first, last and preferred name, and the
 * "about you" text. Every signed-in person can edit their own, whatever
 * their role; nobody can edit anyone else's here.
 *
 * `name`, the one the site shows, is recomputed from these on every save
 * (lib/profile.ts), so a byline can never disagree with the profile.
 * Returns the saved display name so the page can show it without waiting
 * for a refetch.
 */
export async function updateProfile(input: {
  firstName: string;
  lastName: string;
  preferredName: string;
  bio: string;
}): Promise<{ ok: boolean; error?: string; field?: string; name?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You are not signed in." };
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? "Check the details and try again.", field: issue?.path[0]?.toString() };
  }
  const name = displayName(parsed.data);
  await db.user.update({ where: { id: session.user.id }, data: { ...parsed.data, name } });
  await recordAudit({
    actorId: session.user.id,
    action: "user.profile.update",
    targetType: "User",
    targetId: session.user.id,
    ip: await getClientIp(),
  });
  revalidatePath("/account");
  revalidatePath("/account/settings");
  return { ok: true, name };
}

/**
 * Erasure (GDPR Art. 17 / CCPA §1798.105), self-service. The password is
 * required so an unattended signed-in browser cannot be used to destroy
 * an account. On success the person is signed out; the session token
 * would stop validating anyway, since anonymisation bumps sessionVersion.
 */
const EMAIL_CHANGE_TTL_MS = 60 * 60 * 1000;

/**
 * Starts moving the account to a new email address.
 *
 * Password-confirmed, because a browser left signed in must not be
 * enough to redirect every future sign-in link to a stranger. The old
 * address stays in force; nothing changes until the link sent to the
 * new one is opened (verifyEmailChange in app/(auth)/verify-email).
 */
export async function requestEmailChange(input: {
  newEmail: string;
  password: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "You need to be signed in to do that." };

  const parsed = z.object({ newEmail: z.email().max(254), password: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That doesn't look like an email address." };
  const newEmail = parsed.data.newEmail.toLowerCase();

  const { success } = await emailChangeLimiter.limit(session.user.id);
  if (!success) return { ok: false, error: "Too many attempts. Try again in a few minutes." };

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, passwordHash: true },
  });
  if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, parsed.data.password).catch(() => false))) {
    return { ok: false, error: "Incorrect password." };
  }
  if (newEmail === user.email.toLowerCase()) return { ok: false, error: "That is already your address." };

  // Same answer whether or not the address is taken: an "already in use"
  // message would turn this into a way to test which emails have accounts.
  const taken = await db.user.findUnique({ where: { email: newEmail }, select: { id: true } });
  if (!taken) {
    await db.user.update({ where: { id: user.id }, data: { pendingEmail: newEmail } });
    const token = await createToken("email-change", newEmail, EMAIL_CHANGE_TTL_MS);
    const link = `${await getBaseUrl()}/verify-email?change=1&token=${token}&email=${encodeURIComponent(newEmail)}`;
    await sendEmail({
      to: newEmail,
      subject: `Confirm your new ${SITE_NAME} email address`,
      html: `<p>Open this link to make ${newEmail} the address for your ${SITE_NAME} account. It works once and expires in an hour.</p><p><a href="${link}">${link}</a></p><p>If you did not ask for this, ignore it — nothing changes.</p>`,
    });
  }
  await recordAudit({
    actorId: user.id,
    action: "account.email.change_requested",
    targetType: "User",
    targetId: user.id,
    ip: await getClientIp(),
  });
  revalidatePath("/account");
  revalidatePath("/account/settings");
  return { ok: true };
}

/**
 * Attaches a phone number and sends it a code. The number is stored at
 * once — encrypted, with a keyed hash for uniqueness — but marked
 * unverified until the code comes back. See lib/phone.ts.
 */
export async function startPhoneVerification(input: {
  phone: string;
}): Promise<{ ok: boolean; error?: string; masked?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "You need to be signed in to do that." };

  const e164 = normalisePhone(String(input.phone ?? ""));
  if (!e164) return { ok: false, error: "Enter the number in international format, starting with +." };

  const { success } = await phoneCodeLimiter.limit(session.user.id);
  if (!success) return { ok: false, error: "Too many codes requested. Try again in a few minutes." };

  const hash = phoneHash(e164);
  const owner = await db.user.findUnique({ where: { phoneHash: hash }, select: { id: true } });
  if (owner && owner.id !== session.user.id) {
    return { ok: false, error: "That number is already verified on another account." };
  }

  const code = generatePhoneCode();
  await db.user.update({
    where: { id: session.user.id },
    data: {
      phoneEncrypted: encryptPhone(e164),
      phoneHash: hash,
      phoneVerifiedAt: null,
      phoneCodeHash: hashPhoneCode(code, session.user.id),
      phoneCodeExpires: new Date(Date.now() + PHONE_CODE_TTL_MS),
      phoneCodeAttempts: 0,
    },
  });

  try {
    await sendSms({ to: e164, body: phoneCodeMessage(code, SITE_NAME) });
  } catch (error) {
    console.error("[sms] send failed", error);
    return { ok: false, error: "The message could not be sent. Check the number and try again." };
  }

  await recordAudit({
    actorId: session.user.id,
    action: "account.phone.code_sent",
    targetType: "User",
    targetId: session.user.id,
    ip: await getClientIp(),
  });
  revalidatePath("/account");
  revalidatePath("/account/settings");
  return { ok: true, masked: maskPhone(e164) };
}

export async function confirmPhone(input: { code: string }): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "You need to be signed in to do that." };
  if (!isSixDigitCode(String(input.code ?? ""))) return { ok: false, error: "Enter the six-digit code." };

  const { success } = await phoneVerifyLimiter.limit(session.user.id);
  if (!success) return { ok: false, error: "Too many attempts. Request a new code." };

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { phoneCodeHash: true, phoneCodeExpires: true, phoneCodeAttempts: true, phoneEncrypted: true },
  });
  if (!user?.phoneCodeHash || !user.phoneEncrypted) return { ok: false, error: "Request a code first." };
  if (!user.phoneCodeExpires || user.phoneCodeExpires.getTime() < Date.now()) {
    return { ok: false, error: "That code has expired. Request a new one." };
  }
  if (user.phoneCodeAttempts >= PHONE_CODE_MAX_ATTEMPTS) {
    return { ok: false, error: "Too many wrong codes. Request a new one." };
  }

  if (!phoneCodeMatches(user.phoneCodeHash, input.code, session.user.id)) {
    await db.user.update({ where: { id: session.user.id }, data: { phoneCodeAttempts: { increment: 1 } } });
    return { ok: false, error: "That code didn't match." };
  }

  await db.user.update({
    where: { id: session.user.id },
    data: { phoneVerifiedAt: new Date(), phoneCodeHash: null, phoneCodeExpires: null, phoneCodeAttempts: 0 },
  });
  await recordAudit({
    actorId: session.user.id,
    action: "account.phone.verified",
    targetType: "User",
    targetId: session.user.id,
    ip: await getClientIp(),
  });
  revalidatePath("/account");
  revalidatePath("/account/settings");
  return { ok: true };
}

export async function removePhone(): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session?.user) return { ok: false };
  await db.user.update({
    where: { id: session.user.id },
    data: {
      phoneEncrypted: null,
      phoneHash: null,
      phoneVerifiedAt: null,
      phoneCodeHash: null,
      phoneCodeExpires: null,
      phoneCodeAttempts: 0,
    },
  });
  await recordAudit({
    actorId: session.user.id,
    action: "account.phone.removed",
    targetType: "User",
    targetId: session.user.id,
    ip: await getClientIp(),
  });
  revalidatePath("/account");
  revalidatePath("/account/settings");
  return { ok: true };
}

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

  await signIn("google", { redirectTo: "/account/settings?google=connected" });
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
  revalidatePath("/account/settings");
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
