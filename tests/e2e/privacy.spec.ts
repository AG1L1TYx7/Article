import { test, expect, type Page } from "@playwright/test";
import { uniqueTestIp } from "./support/testIp";
import { scalar, sql } from "./support/db";
import { finishLogin } from "./support/staff";

/**
 * The data-protection rights a reader exercises without asking anyone:
 * consent at registration, access/portability, rectification, erasure.
 * Each is a promise the privacy policy makes; these make sure the code
 * keeps them.
 */

const PASSWORD = "correct-horse-battery-staple";

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestIp() });
});

async function fillRegistration(page: Page, prefix: string) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `${prefix}+${stamp}@example.com`;
  await page.goto("/register");
  await page.fill('input[name="name"]', "Privacy Tester");
  await page.fill('input[name="handle"]', `${prefix}${stamp}`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  return email;
}

async function register(page: Page, prefix: string) {
  const email = await fillRegistration(page, prefix);
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
  await finishLogin(page);
}

test.describe("Consent", () => {
  test("registration is refused without agreeing to the terms, and records when you did", async ({ page }) => {
    const email = await fillRegistration(page, "prconsent");
    // The browser's `required` is bypassed the way a hostile client would.
    await page.evaluate(() => document.querySelector<HTMLInputElement>('input[name="consent"]')!.removeAttribute("required"));
    await page.click('button[type="submit"]');
    await expect(page.getByText(/agree to the terms and privacy policy/)).toBeVisible();
    expect(scalar(`SELECT coalesce(id, '') FROM \`User\` WHERE email = '${email}';`)).toBeFalsy();

    await page.check('input[name="consent"]');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/login/);
    expect(scalar(`SELECT CAST(\`termsAcceptedAt\` AS CHAR) FROM \`User\` WHERE email = '${email}';`)).toBeTruthy();
  });

  test("the legal pages exist and the footer links to them", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Privacy", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Privacy policy", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: /your privacy choices/i })).toBeVisible();
    await page.goto("/terms");
    await expect(page.getByRole("heading", { name: "Terms of use", level: 1 })).toBeVisible();
  });
});

test.describe("Access and rectification", () => {
  test("a reader can download everything held about them", async ({ page }) => {
    const email = await register(page, "prexport");
    await login(page, email);

    const response = await page.request.get("/account/data");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-disposition"]).toContain("attachment");
    const data = await response.json();
    expect(data.account.email).toBe(email);
    expect(data.account).not.toHaveProperty("passwordHash");
    expect(data.account).not.toHaveProperty("mfaSecret");
    expect(Array.isArray(data.comments)).toBe(true);
    expect(Array.isArray(data.securityLog)).toBe(true);
  });

  test("a reader can set their first, last and preferred name and an about text", async ({ page }) => {
    const email = await register(page, "prname");
    await login(page, email);
    await page.goto("/account/settings");

    const section = page.getByRole("region", { name: "Personal information" });
    await section.getByRole("button", { name: "Edit details" }).click();
    await section.getByLabel("First name").fill("Augusta");
    await section.getByLabel(/^Last name/).fill("King");
    await section.getByLabel(/^About you/).fill("Reads everything.\nWrites to the editor.");
    // Without a preferred name, first + last is what the site shows.
    await expect(section.getByText("Augusta King", { exact: true })).toBeVisible();
    await section.getByLabel(/^Preferred name/).fill("Ada");
    await section.getByRole("button", { name: "Save", exact: true }).click();

    await expect(section.getByRole("status")).toContainText("Saved");
    const row = scalar(
      `SELECT CONCAT_WS('|', name, firstName, lastName, preferredName, REPLACE(bio, '\\n', '/')) FROM \`User\` WHERE email = '${email}';`
    );
    expect(row).toBe("Ada|Augusta|King|Ada|Reads everything./Writes to the editor.");
    // The preferred name is what the site uses, including the header.
    await expect(section.getByText("Ada", { exact: true }).first()).toBeVisible();

    // And it is in the personal-data download.
    const exported = await (await page.request.get("/account/data")).json();
    expect(exported.account).toMatchObject({ name: "Ada", firstName: "Augusta", lastName: "King", preferredName: "Ada" });
    expect(exported.account.about).toBe("Reads everything.\nWrites to the editor.");
  });

  test("a profile needs a first name or a preferred name", async ({ page }) => {
    const email = await register(page, "prnoname");
    await login(page, email);
    await page.goto("/account/settings");
    const section = page.getByRole("region", { name: "Personal information" });
    await section.getByRole("button", { name: "Edit details" }).click();
    await section.getByLabel("First name").fill("");
    await section.getByLabel(/^Last name/).fill("OnlyASurname");
    await section.getByLabel(/^Preferred name/).fill("");
    await section.getByRole("button", { name: "Save", exact: true }).click();
    await expect(section.getByRole("alert")).toContainText("first name or a preferred name");
    // Nothing was saved.
    expect(scalar(`SELECT COALESCE(lastName, '') FROM \`User\` WHERE email = '${email}';`)).toBe("");
  });
});

test.describe("Erasure", () => {
  test("deleting the account erases personal data and ends the session", async ({ page }) => {
    const email = await register(page, "prdelete");
    await login(page, email);
    const id = scalar(`SELECT id FROM \`User\` WHERE email = '${email}';`);
    // Personal details on the row, so erasure has something to erase.
    sql(`UPDATE \`User\` SET firstName = 'Erase', lastName = 'Me', preferredName = 'EM', bio = 'about' WHERE id = '${id}';`);

    await page.goto("/account/settings");
    await page.getByRole("button", { name: "Delete account" }).click();
    await page.getByLabel(/Type/).fill("delete my account");
    await page.getByLabel("Your password").fill(PASSWORD);
    await page.getByRole("button", { name: "Delete my account" }).click();
    await page.waitForURL(/\/\?deleted=1/);

    // Signed out, and nothing personal left on the row.
    await page.goto("/account/settings");
    await expect(page).toHaveURL(/\/login/);
    expect(scalar(`SELECT coalesce(id, '') FROM \`User\` WHERE email = '${email}';`)).toBeFalsy();
    expect(
      scalar(
        `SELECT CONCAT_WS('|', name, COALESCE(firstName, '-'), COALESCE(lastName, '-'), COALESCE(preferredName, '-'), COALESCE(bio, '-')) FROM \`User\` WHERE id = '${id}';`
      )
    ).toBe("Deleted user|-|-|-|-");

    // And the old credentials are dead.
    await page.goto("/login");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
  });

  test("deletion needs the password", async ({ page }) => {
    const email = await register(page, "prdelpw");
    await login(page, email);
    await page.goto("/account/settings");
    await page.getByRole("button", { name: "Delete account" }).click();
    await page.getByLabel(/Type/).fill("delete my account");
    await page.getByLabel("Your password").fill("not-the-password-at-all");
    await page.getByRole("button", { name: "Delete my account" }).click();
    await expect(page.getByText("That isn't your password.")).toBeVisible();
    expect(scalar(`SELECT name FROM \`User\` WHERE email = '${email}';`)).toBe("Privacy Tester");
  });
});
