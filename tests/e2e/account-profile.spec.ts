import { test, expect, type Page } from "@playwright/test";
import { uniqueTestIp } from "./support/testIp";
import { sql } from "./support/db";
import { finishLogin, mfaColumnsSql } from "./support/staff";

/**
 * /account is the signed-in person's profile; every setting lives on
 * /account/settings. Staff reach the profile from the newsroom by
 * clicking their own name.
 */

const PASSWORD = "correct-horse-battery-staple";

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestIp() });
});

async function signIn(page: Page, prefix: string, role: "READER" | "ADMIN" = "READER") {
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const email = `${prefix}+${stamp}@example.com`;
  await page.goto("/register");
  await page.fill('input[name="name"]', "Profile Person");
  await page.fill('input[name="handle"]', `${prefix}${stamp}`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.check('input[name="consent"]');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/login/);
  const staff = role === "ADMIN" ? `, role = 'ADMIN', ${mfaColumnsSql()}` : "";
  sql(`UPDATE \`User\` SET \`emailVerifiedAt\` = NOW()${staff} WHERE email = '${email}';`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await finishLogin(page);
  return { email, handle: `${prefix}${stamp}` };
}

test("the profile shows the person, their numbers and their activity, not settings", async ({ page }, testInfo) => {
  const { email, handle } = await signIn(page, "prof");
  sql(`UPDATE \`User\` SET bio = 'Reads the budget annexes so you do not have to.' WHERE email = '${email}';`);
  await page.goto("/account");

  await expect(page.getByRole("heading", { name: "Profile Person", level: 1 })).toBeVisible();
  await expect(page.getByText(`@${handle}`)).toBeVisible();
  await expect(page.getByText("Reads the budget annexes so you do not have to.")).toBeVisible();
  await expect(page.locator("#main-content").getByText("Reader", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("profile.png"), fullPage: true });

  // Settings are not on this page any more.
  await expect(page.getByRole("heading", { name: "Two-factor authentication" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete account" })).toHaveCount(0);

  // Tabs are links, so each has its own address and works without JavaScript.
  await page.locator("#main-content nav").getByRole("link", { name: /^Saved/ }).click();
  await expect(page).toHaveURL(/\/account\?tab=saved$/);
  await expect(page.getByText(/Nothing saved yet/)).toBeVisible();
  await page.locator("#main-content nav").getByRole("link", { name: /^Following/ }).click();
  await expect(page.getByText(/not following any writers or sections/)).toBeVisible();

  // The checklist points at the part of settings that fixes each item.
  await expect(page.getByRole("link", { name: "Turn on two-factor authentication" })).toHaveAttribute("href", "/account/settings#security");
});

test("Edit profile and Settings lead to the settings page, which has every section", async ({ page }, testInfo) => {
  await signIn(page, "profset");
  await page.goto("/account");
  await page.getByRole("link", { name: "Edit profile" }).click();
  await expect(page).toHaveURL(/\/account\/settings#personal$/);
  await expect(page.getByRole("region", { name: "Personal information" })).toBeVisible();

  for (const section of ["Account", "Security", "Preferences", "Privacy and data"]) {
    await expect(page.getByRole("heading", { name: section, level: 2 })).toBeVisible();
  }
  await page.screenshot({ path: testInfo.outputPath("settings.png") });
  await page.getByRole("link", { name: "Back to your profile" }).click();
  await expect(page).toHaveURL(/\/account$/);
});

test("staff open their profile by clicking their name in the newsroom", async ({ page }) => {
  await signIn(page, "profstaff", "ADMIN");
  await page.goto("/dashboard");
  await page.getByRole("link", { name: /Profile Person/ }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "Profile Person", level: 1 })).toBeVisible();
  await expect(page.locator("#main-content").getByText("Administrator", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Your author page" })).toBeVisible();
});
