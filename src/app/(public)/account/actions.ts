"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth, signOut } from "@/lib/auth/config";
import { verifyPassword } from "@/lib/auth/password";
import { TRUST_COOKIE } from "@/lib/auth/trustedDevice";
import { anonymiseAccount } from "@/lib/accountDeletion";
import { recordAudit, recordAuthEvent } from "@/lib/audit";
import { getClientIp } from "@/lib/request";
import { revalidatePath } from "next/cache";
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
