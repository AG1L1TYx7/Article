import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { encryptSecret, decryptSecret } from "@/lib/auth/crypto";

const ISSUER = "News Platform";

function totpFor(email: string, base32Secret: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(base32Secret),
  });
}

export interface NewMfaEnrollment {
  /** Encrypted — this is what gets stored on User.mfaSecret, never the raw secret. */
  encryptedSecret: string;
  qrCodeDataUrl: string;
  manualEntryKey: string;
}

export async function startMfaEnrollment(email: string): Promise<NewMfaEnrollment> {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = totpFor(email, secret.base32);

  return {
    encryptedSecret: encryptSecret(secret.base32),
    qrCodeDataUrl: await QRCode.toDataURL(totp.toString()),
    manualEntryKey: secret.base32,
  };
}

/** `window: 1` accepts the previous/next 30s step to tolerate clock drift. */
export function verifyTotp(email: string, encryptedSecret: string, code: string): boolean {
  const base32Secret = decryptSecret(encryptedSecret);
  const delta = totpFor(email, base32Secret).validate({ token: code, window: 1 });
  return delta !== null;
}
