import { test, expect, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { uniqueTestIp } from "./support/testIp";
import { sql } from "./support/db";

const PASSWORD = "correct-horse-battery-staple";

function promoteTo(role: "ADMIN" | "MODERATOR", email: string) {
  sql(`UPDATE \`User\` SET role = '${role}' WHERE email = '${email}';`);
}
const promoteToAdmin = (email: string) => promoteTo("ADMIN", email);

function codeFor(base32Secret: string): string {
  return new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(base32Secret),
  }).generate();
}

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestIp() });
});

async function register(page: Page, email: string, handle: string) {
  await page.goto("/register");
  await page.fill('input[name="name"]', "Test User");
  await page.fill('input[name="handle"]', handle);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/login/);
}

async function login(page: Page, email: string, password = PASSWORD) {
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
}

async function enrollMfa(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Set up authenticator app" }).click();
  const secret = await page.locator("p.font-mono.text-xs.break-all").textContent();
  if (!secret) throw new Error("Manual entry key not found on enrollment screen");
  await page.fill('input[name="code"]', codeFor(secret.trim()));
  await page.getByRole("button", { name: "Confirm and enable" }).click();
  await expect(page.getByText("MFA is enabled on this account.")).toBeVisible();
  return secret.trim();
}

test.describe("Mandatory admin MFA", () => {
  test("an admin without MFA is forced to the setup page before anything else in the dashboard", async ({
    page,
  }) => {
    const email = `admin+${Date.now()}@example.com`;
    await register(page, email, `admin${Date.now()}`);
    promoteToAdmin(email);

    await login(page, email);
    await page.waitForURL(/\/dashboard\/mfa/);
    await expect(page.getByText(/required to enable this/)).toBeVisible();

    // Trying to skip straight to the dashboard bounces right back.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard\/mfa/);

    // Admin-only pages are equally out of reach.
    await page.goto("/dashboard/users");
    await expect(page).toHaveURL(/\/dashboard\/mfa/);
  });
});

test.describe("MFA enrollment and TOTP login", () => {
  test("enrolling lets an admin reach the dashboard, and future logins require a TOTP code", async ({
    page,
  }) => {
    // The longest journey in the suite: register, log in, enrol, navigate,
    // log out, log back in, then verify a code — a dozen round trips
    // inside one timeout. It passes comfortably on its own and has been
    // seen to run out of time when the whole suite is competing for the
    // machine, so it gets a longer budget rather than a retry.
    test.slow();
    const email = `admin-mfa+${Date.now()}@example.com`;
    await register(page, email, `adminmfa${Date.now()}`);
    promoteToAdmin(email);
    await login(page, email);
    await page.waitForURL(/\/dashboard\/mfa/);

    const secret = await enrollMfa(page);

    // Now unblocked.
    await page.goto("/dashboard");
    await expect(page).toHaveURL("/dashboard");

    // Log out, log back in — password alone should no longer be enough.
    await page.getByRole("button", { name: "Log out" }).click();
    await page.waitForURL(/\/login/);
    await login(page, email);
    await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();

    await page.fill('input[name="totp"]', codeFor(secret));
    await page.getByRole("button", { name: "Verify" }).click();
    await page.waitForURL("/dashboard");
  });

  test("a remembered device skips the code for later logins, and can be forgotten", async ({ page }) => {
    test.slow();
    const email = `admin-trust+${Date.now()}@example.com`;
    await register(page, email, `admintrust${Date.now()}`);
    promoteToAdmin(email);
    await login(page, email);
    await page.waitForURL(/\/dashboard\/mfa/);
    const secret = await enrollMfa(page);

    // First login after enrolment: code required, "remember" is ticked by default.
    await page.getByRole("button", { name: "Log out" }).click();
    await page.waitForURL(/\/login/);
    await login(page, email);
    await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
    await expect(page.getByRole("checkbox")).toBeChecked();
    await page.fill('input[name="totp"]', codeFor(secret));
    await page.getByRole("button", { name: "Verify" }).click();
    await page.waitForURL("/dashboard");

    // Second login on the same browser: password only.
    await page.getByRole("button", { name: "Log out" }).click();
    await page.waitForURL(/\/login/);
    await login(page, email);
    await page.waitForURL("/dashboard");
    await expect(page.getByRole("heading", { name: "Enter your code" })).toHaveCount(0);

    // The account page knows, and can undo it.
    await page.goto("/account");
    await expect(page.getByText("This browser is remembered")).toBeVisible();
    await page.getByRole("button", { name: "Forget this device" }).click();
    await expect(page.getByText("This browser is not remembered.")).toBeVisible();

    // Third login: the code is back.
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Log out" }).click();
    await page.waitForURL(/\/login/);
    await login(page, email);
    await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
  });

  test("a wrong TOTP code is rejected at login", async ({ page }) => {
    // Same long enrol-then-re-login journey as the test above.
    test.slow();
    const email = `admin-badcode+${Date.now()}@example.com`;
    await register(page, email, `adminbadcode${Date.now()}`);
    promoteToAdmin(email);
    await login(page, email);
    await page.waitForURL(/\/dashboard\/mfa/);
    await enrollMfa(page);

    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Log out" }).click();
    await page.waitForURL(/\/login/);
    await login(page, email);
    await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();

    await page.fill('input[name="totp"]', "000000");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByText("Incorrect code.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("MFA is optional for a moderator — no forced setup, no TOTP prompt at login", async ({ page }) => {
    const email = `mod-nomf+${Date.now()}@example.com`;
    await register(page, email, `modnomfa${Date.now()}`);
    promoteTo("MODERATOR", email);

    await login(page, email);
    await page.waitForURL("/dashboard");
    await expect(page.getByText("Set up two-factor authentication")).toBeVisible();
  });
});
