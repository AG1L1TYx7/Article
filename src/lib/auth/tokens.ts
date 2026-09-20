import { randomBytes, createHash } from "node:crypto";
import { db } from "@/lib/db";

// VerificationToken rows store a hash of the token, never the raw value —
// same reasoning as password storage: a database read (backup leak, SQLi,
// insider access) should not hand out usable credentials. The raw token
// only ever exists in the emailed link and this request's memory.
//
// `identifier` is namespaced per purpose (`email-verify:<email>` /
// `password-reset:<email>`) so the two flows can't be confused and so an
// email-verify token can never be replayed to reset a password.
const TOKEN_BYTES = 32;

export type TokenPurpose = "email-verify" | "password-reset";

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function scopedIdentifier(purpose: TokenPurpose, email: string): string {
  return `${purpose}:${email.toLowerCase()}`;
}

export async function createToken(
  purpose: TokenPurpose,
  email: string,
  ttlMs: number
): Promise<string> {
  const identifier = scopedIdentifier(purpose, email);
  const raw = randomBytes(TOKEN_BYTES).toString("base64url");

  // One outstanding token per (purpose, email) at a time — requesting a new
  // link invalidates any previous one instead of letting them pile up.
  await db.verificationToken.deleteMany({ where: { identifier } });
  await db.verificationToken.create({
    data: { identifier, token: hashToken(raw), expires: new Date(Date.now() + ttlMs) },
  });

  return raw;
}

export async function consumeToken(
  purpose: TokenPurpose,
  email: string,
  raw: string
): Promise<boolean> {
  const identifier = scopedIdentifier(purpose, email);
  const hashed = hashToken(raw);

  // `token` is globally unique on its own (32 random bytes, hashed); the
  // identifier check below is defense in depth against a hash collision
  // rather than the primary lookup key.
  const record = await db.verificationToken.findUnique({ where: { token: hashed } });

  // Always delete on a matching lookup, valid or expired, so a token can
  // never be tried twice — single use, whether it worked or not.
  if (record) {
    await db.verificationToken.delete({ where: { token: hashed } });
  }

  return !!record && record.identifier === identifier && record.expires.getTime() > Date.now();
}
