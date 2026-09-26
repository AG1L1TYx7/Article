import { test, expect, type Page } from "@playwright/test";
import { uniqueTestIp } from "./support/testIp";
import { sql } from "./support/db";
import { answerMfaIfPrompted, mfaColumnsSql } from "./support/staff";

// Regression gate for the security blueprint's RBAC guarantee: a role claim
// is never trusted from the client, and every dashboard route re-checks the
// current role against the database. These tests exercise that end to end
// through the real login flow — not by calling requireRole() in isolation —
// because the bug this class of test is meant to catch is exactly a gap
// between proxy.ts and the server-side check (see auth.config.ts's
// session callback, which was once missing from the edge config and let a
// promoted MODERATOR silently fall back to READER-level routing).
const PASSWORD = "correct-horse-battery-staple";

function promoteToModerator(email: string) {
  sql(`UPDATE \`User\` u JOIN \`UserRole\` r ON r.\`key\` = LOWER('MODERATOR') SET u.role = 'MODERATOR', u.roleId = r.id, ${mfaColumnsSql()} WHERE u.email = '${email}';`);
}

function bumpSessionVersion(email: string) {
  sql(`UPDATE \`User\` SET \`sessionVersion\` = \`sessionVersion\` + 1 WHERE email = '${email}';`);
}

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

async function login(page: Page, email: string) {
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await answerMfaIfPrompted(page);
}

// Each test gets its own synthetic source IP so the real per-IP rate
// limiters (see src/lib/rateLimit.ts) don't let one test's registrations
// exhaust another test's budget when the suite runs from a single machine.
test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestIp() });
});

test.describe("Auth & RBAC", () => {
  test("a plain reader cannot reach the newsroom dashboard", async ({ page }) => {
    const email = `reader+${Date.now()}@example.com`;
    await register(page, email, `reader${Date.now()}`);
    await login(page, email);
    await page.waitForURL((u) => u.pathname !== "/login");
    await expect(page).toHaveURL("/");

    await page.goto("/dashboard");
    await expect(page).toHaveURL("/");
  });

  test("an anonymous request to the dashboard is sent to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("a moderator reaches the dashboard but not admin-only pages", async ({ page }) => {
    const email = `mod+${Date.now()}@example.com`;
    await register(page, email, `mod${Date.now()}`);
    promoteToModerator(email);

    await page.goto("/login");
    await login(page, email);
    await page.waitForURL(/\/dashboard/);
    await expect(page.locator("body")).toContainText("MODERATOR");

    await page.goto("/dashboard/users");
    await expect(page).toHaveURL("/dashboard");
  });

  test("wrong password is rejected without revealing account existence", async ({ page }) => {
    const email = `wrongpw+${Date.now()}@example.com`;
    await register(page, email, `wrongpw${Date.now()}`);

    await page.goto("/login");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', "not-the-right-password");
    await page.click('button[type="submit"]');
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("bumping sessionVersion invalidates an already-issued session", async ({ page }) => {
    const email = `revoke+${Date.now()}@example.com`;
    await register(page, email, `revoke${Date.now()}`);
    promoteToModerator(email);

    await page.goto("/login");
    await login(page, email);
    await page.waitForURL(/\/dashboard/);

    bumpSessionVersion(email);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});
