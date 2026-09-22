import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";

/**
 * Two-factor authentication for test staff accounts.
 *
 * Every newsroom account — moderators as well as admins — must have
 * two-factor enabled before the dashboard opens (src/proxy.ts). The
 * suite promotes accounts by SQL, so it enrols them the same way: a
 * fixed authenticator secret, encrypted exactly as the application
 * encrypts it (mirrors src/lib/auth/crypto.ts: AES-256-GCM under a key
 * derived from AUTH_SECRET). Going through the enrolment screen for every
 * test would add several seconds each; the screen has its own tests in
 * mfa.spec.ts.
 *
 * Needs AUTH_SECRET in the test process — playwright.config.ts loads .env
 * for local runs, and CI sets it directly.
 */
export const TEST_MFA_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

function encryptLikeTheApp(plain: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set in the test process; the suite needs it to enrol staff in MFA.");
  const key = createHash("sha256").update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((b) => b.toString("base64url")).join(".");
}

/** The SQL fragment that enrols an account in MFA with the shared test secret. */
export function mfaColumnsSql(): string {
  return `\`mfaEnabled\` = 1, \`mfaSecret\` = '${encryptLikeTheApp(TEST_MFA_SECRET)}'`;
}

export function currentTestCode(): string {
  return new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(TEST_MFA_SECRET),
  }).generate();
}

/**
 * For login helpers that only submit the password form and leave the
 * caller to decide what happens next (a wrong-password test expects to
 * stay on /login, for instance): answers the second-factor prompt if it
 * shows up, and otherwise does nothing. Gives up quietly once the page
 * has moved on or shown an error.
 */
export async function answerMfaIfPrompted(page: Page) {
  const totp = page.locator("#totp");
  const outcome = await Promise.race([
    totp.waitFor({ state: "visible", timeout: 10000 }).then(() => "totp" as const),
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 10000 }).then(() => "left" as const),
    // With text: Next.js keeps an empty role="alert" route announcer on
    // every page, which must not count as an error.
    page
      .getByRole("alert")
      .filter({ hasText: /\S/ })
      .waitFor({ state: "visible", timeout: 10000 })
      .then(() => "error" as const),
  ]).catch(() => "none" as const);
  if (outcome === "totp") {
    await totp.fill(currentTestCode());
    await page.getByRole("button", { name: /^(Verify|जाँच गर्नुहोस्)$/ }).click();
  }
}

/**
 * Completes a login after the password form has been submitted: if the
 * second-factor prompt appears, answers it with the shared test secret;
 * either way, waits to leave /login.
 */
export async function finishLogin(page: Page) {
  const totp = page.locator("#totp");
  const left = page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 }).then(() => "left" as const);
  const prompted = totp.waitFor({ state: "visible", timeout: 15000 }).then(() => "totp" as const);
  const first = await Promise.race([left, prompted]).catch(() => "left" as const);
  if (first === "totp") {
    await totp.fill(currentTestCode());
    await page.getByRole("button", { name: /^(Verify|जाँच गर्नुहोस्)$/ }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  } else {
    await expect(page).not.toHaveURL(/\/login/);
  }
}
