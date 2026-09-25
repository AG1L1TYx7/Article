import { test, expect, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { uniqueTestIp } from "./support/testIp";
import { sql } from "./support/db";

const PASSWORD = "correct-horse-battery-staple";

function promoteTo(role: "ADMIN" | "MODERATOR", email: string) {
  sql(`UPDATE \`User\` u JOIN \`UserRole\` r ON r.\`key\` = LOWER('${role}') SET u.role = '${role}', u.roleId = r.id WHERE u.email = '${email}';`);
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
  await page.check('input[name="consent"]');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/login/);
}

async function login(page: Page, email: string, password = PASSWORD) {
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
}

/**
 * Enrols through the real screen and returns the authenticator secret and
 * the one-time recovery codes the page shows exactly once.
 */
async function enrollMfaWithCodes(page: Page): Promise<{ secret: string; codes: string[] }> {
  await page.getByRole("button", { name: "Set up authenticator app" }).click();
  const secret = await page.locator("p.font-mono.text-xs.break-all").textContent();
  if (!secret) throw new Error("Manual entry key not found on enrollment screen");
  await page.fill('input[name="code"]', codeFor(secret.trim()));
  await page.getByRole("button", { name: "Confirm and enable" }).click();
  await expect(page.getByText("MFA is enabled on this account.")).toBeVisible();
  const codes = await page.locator("[data-recovery-codes] li").allTextContents();
  expect(codes).toHaveLength(10);
  await page.getByRole("button", { name: "I've saved them" }).click();
  return { secret: secret.trim(), codes: codes.map((c) => c.trim()) };
}

async function enrollMfa(page: Page): Promise<string> {
  return (await enrollMfaWithCodes(page)).secret;
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

  test("a moderator is held at the setup page too — every newsroom account needs MFA", async ({ page }) => {
    const email = `mod-nomf+${Date.now()}@example.com`;
    await register(page, email, `modnomfa${Date.now()}`);
    promoteTo("MODERATOR", email);

    await login(page, email);
    await page.waitForURL(/\/dashboard\/mfa/);
    await expect(page.getByText(/Newsroom accounts are required/)).toBeVisible();
    await page.goto("/dashboard/articles");
    await expect(page).toHaveURL(/\/dashboard\/mfa/);

    // Enrolling unlocks it.
    await enrollMfa(page);
    await page.goto("/dashboard/articles");
    await expect(page).toHaveURL(/\/dashboard\/articles$/);
  });
});

test.describe("Recovery", () => {
  test("a recovery code signs in when the authenticator is gone, and works only once", async ({ page }) => {
    test.slow();
    const email = `admin-recover+${Date.now()}@example.com`;
    await register(page, email, `adminrecover${Date.now()}`);
    promoteToAdmin(email);
    await login(page, email);
    await page.waitForURL(/\/dashboard\/mfa/);
    const { codes } = await enrollMfaWithCodes(page);

    // Ten unused, shown on the security page.
    await page.goto("/dashboard/mfa");
    await expect(page.locator("[data-recovery-remaining]")).toHaveAttribute("data-recovery-remaining", "10");

    // Sign out; sign back in with a recovery code instead of the app.
    await page.getByRole("button", { name: "Log out" }).click();
    await page.waitForURL(/\/login/);
    await login(page, email);
    await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
    // Not a remembered device: the code must be typed again next time.
    await page.getByRole("checkbox").uncheck();
    await page.fill('input[name="totp"]', codes[0]!);
    await page.getByRole("button", { name: "Verify" }).click();
    await page.waitForURL("/dashboard");

    // One fewer left, and the use is in the audit trail.
    await page.goto("/dashboard/mfa");
    await expect(page.locator("[data-recovery-remaining]")).toHaveAttribute("data-recovery-remaining", "9");
    await page.goto("/dashboard/audit-log");
    await expect(page.getByText("auth.mfa.recovery_used").first()).toBeVisible();

    // The same code again is refused.
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Log out" }).click();
    await page.waitForURL(/\/login/);
    await login(page, email);
    await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
    await page.fill('input[name="totp"]', codes[0]!);
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByText("Incorrect code.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("an admin can reset another account's two-factor, which forces a fresh enrolment", async ({ browser, page }) => {
    test.slow();
    const stamp = Date.now();
    const modEmail = `mod-reset+${stamp}@example.com`;
    await register(page, modEmail, `modreset${stamp}`);
    promoteTo("MODERATOR", modEmail);
    await login(page, modEmail);
    await page.waitForURL(/\/dashboard\/mfa/);
    await enrollMfa(page);
    await page.goto("/dashboard");
    await expect(page).toHaveURL("/dashboard");

    // A separate browser for the admin.
    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await admin.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestIp() });
    const adminEmail = `admin-resetter+${stamp}@example.com`;
    await register(admin, adminEmail, `adminresetter${stamp}`);
    promoteToAdmin(adminEmail);
    await admin.goto("/login");
    await login(admin, adminEmail);
    await admin.waitForURL(/\/dashboard\/mfa/);
    await enrollMfa(admin);

    admin.on("dialog", (d) => d.accept());
    await admin.goto(`/dashboard/users?q=${encodeURIComponent(modEmail)}`);
    const row = admin.locator("tr", { hasText: modEmail });
    await row.getByRole("button", { name: "Reset 2FA" }).click();
    // The 2FA pill goes only once the action has completed and the row
    // has re-rendered — waiting on the button would pass while it is
    // still pending, because its label changes to "Resetting…".
    await expect(row.getByText("2FA", { exact: true })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Reset 2FA" })).toHaveCount(0);

    // The moderator is signed out everywhere and, on returning, must enrol again.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await login(page, modEmail);
    await page.waitForURL(/\/dashboard\/mfa/);
    await expect(page.getByRole("button", { name: "Set up authenticator app" })).toBeVisible();

    await adminContext.close();
  });
});
