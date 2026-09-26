import { test, expect, type Page } from "@playwright/test";
import { uniqueTestIp } from "./support/testIp";
import { sql } from "./support/db";
import { finishLogin, mfaColumnsSql } from "./support/staff";

/**
 * The admin System health page (/dashboard/health), and the promise that
 * its detail stays off the public /api/health.
 */

const PASSWORD = "correct-horse-battery-staple";

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestIp() });
});

/** A verified account with the given role and a working second factor. */
async function signInAs(page: Page, role: "ADMIN" | "MODERATOR", prefix: string) {
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const email = `${prefix}+${stamp}@example.com`;
  await page.goto("/register");
  await page.fill('input[name="name"]', `${role} Person`);
  await page.fill('input[name="handle"]', `${prefix}${stamp}`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.check('input[name="consent"]');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/login/);
  sql(`UPDATE \`User\` SET role = '${role}', \`emailVerifiedAt\` = NOW(), ${mfaColumnsSql()} WHERE email = '${email}';`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await finishLogin(page);
  return email;
}

test("an admin sees every group of checks, measured live", async ({ page }, testInfo) => {
  await signInAs(page, "ADMIN", "hadmin");
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "System health" }).click();
  await expect(page).toHaveURL(/\/dashboard\/health$/);
  await expect(page.getByRole("heading", { name: "System health", level: 1 })).toBeVisible();

  for (const group of ["Security", "Database", "Configuration", "Application", "Storage"]) {
    await expect(page.getByRole("heading", { name: group, level: 2 })).toBeVisible();
  }

  // Checks whose outcome this test environment fixes: the database is up
  // with every migration applied, and the production build sends the
  // security headers from src/proxy.ts.
  const row = (title: string) => page.getByRole("listitem").filter({ has: page.getByText(title, { exact: true }) });
  for (const title of ["Connection", "Migrations", "Security headers"]) {
    await expect(row(title).locator(".pill")).toHaveText("OK");
  }
  await expect(row("Admin two-factor")).toBeVisible();
  await expect(row("Known vulnerabilities")).toBeVisible();

  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByRole("button", { name: "Check again" })).toBeEnabled();

  await page.screenshot({ path: testInfo.outputPath("system-health.png"), fullPage: true });
});

test("the page is for admins only", async ({ page }) => {
  await signInAs(page, "MODERATOR", "hmod");
  await expect(page.getByRole("link", { name: "System health" })).toHaveCount(0);
  await page.goto("/dashboard/health");
  await expect(page).toHaveURL(/\/dashboard$/);
});

/**
 * The endpoint an uptime monitor watches. Public, unauthenticated, and
 * says nothing about how the site is configured.
 */
test("the health endpoint answers 200 with the database reachable, and is never cached", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  const body = (await response.json()) as { status: string; database: string; uptimeSeconds: number };
  expect(body.status).toBe("ok");
  expect(body.database).toBe("ok");
  expect(typeof body.uptimeSeconds).toBe("number");
  // Nothing about configuration leaks through it, and nothing from the
  // admin page has crept in: exactly these three fields.
  expect(JSON.stringify(body)).not.toMatch(/resend|s3|upstash|secret/i);
  expect(Object.keys(body).sort()).toEqual(["database", "status", "uptimeSeconds"]);
});
