import { test, expect, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { uniqueTestIp } from "./support/testIp";
import { scalar, sql } from "./support/db";

/**
 * Site settings: an admin chooses how much comment moderation the
 * newsroom wants to do, and staff never queue behind themselves.
 *
 * The setting is global, so this file runs in its own Playwright project
 * after all the others (see playwright.config.ts) and puts the default
 * back through the same UI it used to change it — which also clears the
 * in-process settings cache, so the next spec run starts clean.
 */
test.describe.configure({ mode: "serial" });

const PASSWORD = "correct-horse-battery-staple";

const codeFor = (secret: string) =>
  new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) }).generate();

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestIp() });
});

async function register(page: Page, prefix: string) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `${prefix}+${stamp}@example.com`;
  await page.goto("/register");
  await page.fill('input[name="name"]', "Settings Tester");
  await page.fill('input[name="handle"]', `${prefix}${stamp}`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.check('input[name="consent"]');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/login/);
  sql(`UPDATE \`User\` SET \`emailVerifiedAt\` = NOW() WHERE email = '${email}';`);
  return email;
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function signInAsAdmin(page: Page, prefix: string) {
  const email = await register(page, prefix);
  sql(`UPDATE \`User\` SET role = 'ADMIN' WHERE email = '${email}';`);
  await login(page, email);
  await page.waitForURL(/\/dashboard\/mfa/);
  await page.getByRole("button", { name: "Set up authenticator app" }).click();
  const secret = (await page.locator("p.font-mono.text-xs.break-all").textContent())!.trim();
  await page.fill('input[name="code"]', codeFor(secret));
  await page.getByRole("button", { name: "Confirm and enable" }).click();
  await expect(page.getByText("MFA is enabled on this account.")).toBeVisible();
  return email;
}

async function chooseMode(page: Page, label: RegExp) {
  await page.goto("/dashboard/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await page.getByLabel(label).check();
  const save = page.getByRole("button", { name: "Save settings" });
  if (await save.isEnabled()) {
    await save.click();
    await expect(page.getByText("Saved.")).toBeVisible();
  }
}

/** Publishes an article as a fresh moderator and returns its slug and author. */
async function publishArticle(page: Page, title: string) {
  const email = await register(page, "setwriter");
  sql(`UPDATE \`User\` SET role = 'MODERATOR' WHERE email = '${email}';`);
  await login(page, email);
  await page.goto("/dashboard/articles/new");
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.locator('[contenteditable="true"]').click();
  await page.keyboard.type("Body for the settings tests.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.waitForURL("/dashboard/articles");
  await page.locator("tr", { hasText: title }).getByRole("button", { name: "Publish" }).click();
  await page.waitForLoadState("networkidle");
  await page.context().clearCookies();
  return { slug: scalar(`SELECT slug FROM \`Article\` WHERE title = '${title}' LIMIT 1;`), email };
}

async function postAsNewReader(page: Page, slug: string, prefix: string) {
  await page.context().clearCookies();
  const reader = await register(page, prefix);
  await login(page, reader);
  await page.goto(`/article/${slug}`);
  const body = `${prefix} comment ${Date.now()}`;
  await page.getByPlaceholder("Join the discussion…").fill(body);
  await page.getByRole("button", { name: "Post comment" }).click();
  return body;
}

test("a moderator's own comment never waits for review", async ({ page }) => {
  const { slug, email } = await publishArticle(page, `Settings Staff ${Date.now()}`);
  await login(page, email);
  await page.goto(`/article/${slug}`);
  const body = `Staff comment ${Date.now()}`;
  await page.getByPlaceholder("Join the discussion…").fill(body);
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(page.locator("[data-comment-body]", { hasText: body })).toBeVisible();
  expect(scalar(`SELECT status FROM \`Comment\` WHERE body = '${body}';`)).toBe("APPROVED");
});

test("switching to 'post immediately' puts a brand-new reader's comment live; switching back holds it", async ({ page, browser }) => {
  test.slow();
  const { slug } = await publishArticle(page, `Settings Live ${Date.now()}`);

  // The admin stays signed in on `page` throughout; readers use their own
  // browser contexts, so nobody has to log in twice through MFA.
  await signInAsAdmin(page, "setadmin");
  await chooseMode(page, /Post immediately/);
  expect(scalar(`SELECT \`value\` FROM \`SiteSetting\` WHERE \`key\` = 'commentModeration';`)).toContain("trusted");

  // The moderation page describes the mode.
  await page.goto("/dashboard/comments");
  await expect(page.getByText(/post immediately/)).toBeVisible();

  // A reader with no history posts live.
  const readerA = await browser.newContext();
  const pageA = await readerA.newPage();
  await pageA.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestIp() });
  const live = await postAsNewReader(pageA, slug, "setlive");
  await expect(pageA.locator("[data-comment-body]", { hasText: live })).toBeVisible();
  expect(scalar(`SELECT status FROM \`Comment\` WHERE body = '${live}';`)).toBe("APPROVED");
  await readerA.close();

  // Back to the default, through the UI so the cache is cleared too.
  await chooseMode(page, /Review new accounts only/);
  expect(scalar(`SELECT \`value\` FROM \`SiteSetting\` WHERE \`key\` = 'commentModeration';`)).toContain("new_accounts");

  // And a fresh reader waits again.
  const readerB = await browser.newContext();
  const pageB = await readerB.newPage();
  await pageB.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestIp() });
  const held = await postAsNewReader(pageB, slug, "setheld");
  await expect(pageB.getByText("a moderator will review it")).toBeVisible();
  expect(scalar(`SELECT status FROM \`Comment\` WHERE body = '${held}';`)).toBe("PENDING");
  await readerB.close();
});
