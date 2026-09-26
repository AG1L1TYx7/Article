import { test, expect, type Page } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { uniqueTestIp } from "./support/testIp";
import { sql, scalar } from "./support/db";

/**
 * The emailed six-digit code, as a second factor for members.
 *
 * Exercised against the dev email outbox, the same way email-flows.spec.ts
 * does: RESEND_API_KEY is unset locally and in CI, so sent mail lands in
 * .email-dev-outbox.log rather than an inbox.
 *
 * What is actually being proved here is that the code is *required* — that
 * a correct password alone does not get in once the method is on. The
 * rules around the code itself (single use, five guesses then destroyed,
 * ten-minute expiry, sixty-second resend cooldown) live in
 * lib/auth/emailOtp.ts.
 */

const OUTBOX_PATH = join(process.cwd(), ".email-dev-outbox.log");
const PASSWORD = "correct-horse-battery-staple";

interface OutboxEntry {
  to: string;
  subject: string;
  html: string;
  sentAt: string;
}

function emailsTo(email: string): OutboxEntry[] {
  if (!existsSync(OUTBOX_PATH)) return [];
  return readFileSync(OUTBOX_PATH, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as OutboxEntry)
    .filter((entry) => entry.to === email);
}

/** The code out of the most recent sign-in email, which carries it in the subject. */
function latestSignInCode(email: string): string {
  const signInEmails = emailsTo(email).filter((e) => /is your sign-in code$/.test(e.subject));
  const last = signInEmails.at(-1);
  if (!last) throw new Error(`No sign-in code emailed to ${email}`);
  const code = last.subject.match(/^(\d{6})/)?.[1];
  if (!code) throw new Error(`No six-digit code in subject: ${last.subject}`);
  return code;
}

async function register(page: Page, email: string, handle: string) {
  await page.goto("/register");
  await page.fill('input[name="name"]', "Email OTP Tester");
  await page.fill('input[name="handle"]', handle);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.check('input[name="consent"]');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/login/);
}

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
}

/**
 * Turns the method on directly.
 *
 * The account page does this behind a button, but that button needs a
 * verified address and a signed-in session; this test is about what the
 * *sign-in* does afterwards, so the switch is flipped the short way.
 */
function enableEmailOtp(email: string) {
  sql(
    `UPDATE \`User\` SET mfaEnabled = 1, mfaMethod = 'EMAIL', emailVerifiedAt = UTC_TIMESTAMP(3) WHERE email = '${email}';`
  );
}

test.describe("Emailed sign-in code", () => {
  test.use({ extraHTTPHeaders: { "x-forwarded-for": uniqueTestIp() } });

  test("a member with the emailed method must produce the code to get in", async ({ page }) => {
    const email = `otp+${Date.now()}@example.com`;
    await register(page, email, `otp${Date.now()}`.slice(0, 20));
    enableEmailOtp(email);

    const before = emailsTo(email).length;
    await signIn(page, email);

    // The correct password is not enough any more: the page asks for a
    // code rather than signing them in.
    await expect(page.getByText(/emailed a six-digit code/i)).toBeVisible();
    expect(emailsTo(email).length).toBe(before + 1);

    // A wrong code is refused.
    await page.fill('input[name="totp"]', "000000");
    await page.click('button[type="submit"]');
    await expect(page.getByText(/incorrect code/i)).toBeVisible();

    // The real one gets in.
    await page.fill('input[name="totp"]', latestSignInCode(email));
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
    await expect(page.getByRole("link", { name: /account/i }).first()).toBeVisible();
  });

  test("no code is emailed to somebody who got the password wrong", async ({ page }) => {
    // The send sits behind the password check on purpose — otherwise the
    // sign-in form is a way to post mail to any address on demand.
    const email = `otpnomail+${Date.now()}@example.com`;
    await register(page, email, `otpn${Date.now()}`.slice(0, 20));
    enableEmailOtp(email);

    const before = emailsTo(email).length;
    await page.goto("/login");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', "not-the-right-password");
    await page.click('button[type="submit"]');

    await expect(page.getByText(/incorrect email or password/i)).toBeVisible();
    expect(emailsTo(email).length).toBe(before);
  });

  test("an administrator cannot be left on the emailed method", async ({ page }) => {
    // proxy.ts requires an authenticator app for administrators, so an
    // account promoted while using the emailed code is sent to enrol one
    // instead of reaching the dashboard.
    const email = `otpadmin+${Date.now()}@example.com`;
    await register(page, email, `otpa${Date.now()}`.slice(0, 20));
    enableEmailOtp(email);
    sql(
      `UPDATE \`User\` u JOIN \`UserRole\` r ON r.\`key\` = 'admin' SET u.role = 'ADMIN', u.roleId = r.id WHERE u.email = '${email}';`
    );

    await signIn(page, email);
    // Wait for the code page before reading the outbox: latestSignInCode()
    // is evaluated as an argument, so without this it runs before the
    // server has finished writing the email.
    await expect(page.getByText(/emailed a six-digit code/i)).toBeVisible();
    await page.fill('input[name="totp"]', latestSignInCode(email));
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));

    await page.goto("/dashboard");
    await page.waitForURL(/\/dashboard\/mfa/);
    expect(scalar(`SELECT mfaMethod FROM \`User\` WHERE email = '${email}';`)).toBe("EMAIL");
  });
});
