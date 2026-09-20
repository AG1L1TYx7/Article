"use server";

import { db } from "@/lib/db";
import { hashPassword, isPasswordBreached } from "@/lib/auth/password";
import { registerSchema } from "@/lib/validation/auth";
import { registerLimiter } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/request";
import { createToken } from "@/lib/auth/tokens";
import { sendEmail, verificationEmail } from "@/lib/email";
import { getBaseUrl } from "@/lib/url";
import { verifyTurnstile } from "@/lib/turnstile";

export interface RegisterResult {
  ok: boolean;
  error?: string;
}

const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

export async function registerUser(formData: FormData): Promise<RegisterResult> {
  const ip = await getClientIp();
  const { success } = await registerLimiter.limit(ip);
  if (!success) {
    return { ok: false, error: "Too many attempts. Please try again in a few minutes." };
  }

  // Bot check before any expensive work (argon2 hashing, the breached-
  // password lookup, a database write). No-ops when Turnstile is not
  // configured — see lib/turnstile.ts.
  const passedBotCheck = await verifyTurnstile(formData.get("cf-turnstile-response") as string | null, ip);
  if (!passedBotCheck) {
    return { ok: false, error: "Anti-spam check failed. Please try again." };
  }

  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    handle: formData.get("handle"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // Consent is a server-side fact, not a checkbox the browser enforces:
  // the account is only created with a timestamp recording that the terms
  // and privacy policy were accepted (GDPR Art. 7(1) — the controller must
  // be able to demonstrate consent).
  if (formData.get("consent") !== "on") {
    return { ok: false, error: "Please confirm you are 16 or older and agree to the terms and privacy policy." };
  }

  const { name, handle, email, password } = parsed.data;

  // Every input above was already validated server-side by registerSchema —
  // client-side validation is UX sugar only, per the security blueprint.
  if (await isPasswordBreached(password)) {
    return {
      ok: false,
      error: "That password has appeared in a known data breach. Please choose another.",
    };
  }

  const existing = await db.user.findFirst({
    where: { OR: [{ email }, { handle }] },
    select: { id: true },
  });
  if (existing) {
    // Deliberately generic — don't reveal which field collided.
    return { ok: false, error: "An account with that email or handle already exists." };
  }

  const passwordHash = await hashPassword(password);

  await db.user.create({
    data: { name, handle, email, passwordHash, termsAcceptedAt: new Date() },
  });

  const token = await createToken("email-verify", email, EMAIL_VERIFY_TTL_MS);
  const link = `${await getBaseUrl()}/verify-email?token=${token}&email=${encodeURIComponent(email)}`;
  await sendEmail({ to: email, ...verificationEmail(link) });

  return { ok: true };
}
