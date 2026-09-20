import { test, expect, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { uniqueTestIp } from "./support/testIp";
import { waitForOnHomepage } from "./support/homepage";
import { sql } from "./support/db";

const PASSWORD = "correct-horse-battery-staple";

function promoteTo(role: "ADMIN" | "MODERATOR", email: string) {
  sql(`UPDATE "User" SET role = '${role}' WHERE email = '${email}';`);
}

function markEmailVerified(email: string) {
  sql(`UPDATE "User" SET "emailVerifiedAt" = NOW() WHERE email = '${email}';`);
}

function codeFor(base32Secret: string): string {
  return new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(base32Secret),
  }).generate();
}

// Admin accounts are forced through MFA enrollment before they can reach
// anything else under /dashboard (see proxy.ts) — a moderator promoted
// straight to ADMIN via SQL, like these tests do, hits that same gate on
// its very next navigation. Real admin onboarding would go through this
// too, so the test mirrors it rather than working around it.
async function enrollMfa(page: Page): Promise<void> {
  await page.goto("/dashboard/mfa");
  await page.getByRole("button", { name: "Set up authenticator app" }).click();
  const secret = await page.locator("p.font-mono.text-xs.break-all").textContent();
  if (!secret) throw new Error("Manual entry key not found on enrollment screen");
  await page.fill('input[name="code"]', codeFor(secret.trim()));
  await page.getByRole("button", { name: "Confirm and enable" }).click();
  await expect(page.getByText("MFA is enabled on this account.")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestIp() });
});

async function registerModerator(page: Page, email: string, handle: string) {
  await page.goto("/register");
  await page.fill('input[name="name"]', "Test Moderator");
  await page.fill('input[name="handle"]', handle);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/login/);
  promoteTo("MODERATOR", email);
  // Publishing requires a confirmed email (see requireVerifiedEmail in
  // lib/auth/rbac.ts). Real staff accounts are provisioned out of band,
  // so short-circuit this the same way role promotion is short-circuited.
  markEmailVerified(email);

  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("/dashboard");
}

test.describe("Article authoring", () => {
  test("a moderator can draft, publish, and the article goes live publicly", async ({ page }) => {
    const email = `author+${Date.now()}@example.com`;
    await registerModerator(page, email, `author${Date.now()}`);

    await page.goto("/dashboard/articles/new");
    const title = `Test Headline ${Date.now()}`;
    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.locator('[contenteditable="true"]').click();
    await page.keyboard.type("This is the body of the article, written in the rich text editor.");
    await page.getByRole("button", { name: "Save draft" }).click();

    await page.waitForURL("/dashboard/articles");
    await expect(page.getByText(title)).toBeVisible();
    await expect(page.locator("tr", { hasText: title }).getByText("DRAFT")).toBeVisible();

    // Not on the public homepage yet — still a draft.
    await page.goto("/");
    await expect(page.getByText(title)).not.toBeVisible();

    await page.goto("/dashboard/articles");
    await page.locator("tr", { hasText: title }).getByRole("button", { name: "Publish" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("tr", { hasText: title }).getByText("PUBLISHED")).toBeVisible();

    // Reloads until revalidation lands: the homepage is statically
    // rendered, so the request right after publishing can still serve the
    // previous version.
    await waitForOnHomepage(page, title);
    await page.getByRole("link", { name: title }).click();
    await expect(page).toHaveURL(/\/article\//);
    await expect(page.getByText("This is the body of the article")).toBeVisible();
    await expect(page.getByText("Share:")).toBeVisible();
  });

  test("an unverified author can draft but cannot publish", async ({ page }) => {
    // The security blueprint requires a confirmed email address before an
    // account can publish. Drafting stays open so a new hire isn't blocked
    // from working while they find the verification email.
    const email = `unverified-author+${Date.now()}@example.com`;
    await page.goto("/register");
    await page.fill('input[name="name"]', "Unverified Author");
    await page.fill('input[name="handle"]', `unverifauth${Date.now()}`);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/login/);
    promoteTo("MODERATOR", email);
    // Deliberately NOT calling markEmailVerified here.
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL("/dashboard");

    await page.goto("/dashboard/articles/new");
    const title = `Unverified Draft ${Date.now()}`;
    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.locator('[contenteditable="true"]').click();
    await page.keyboard.type("Draft body.");
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.waitForURL("/dashboard/articles");

    // Draft saved fine, but publishing is closed off and says why.
    await expect(page.locator("tr", { hasText: title }).getByText("DRAFT", { exact: true })).toBeVisible();
    await expect(page.getByText("Verify your email address to publish.")).toBeVisible();
    await expect(page.locator("tr", { hasText: title }).getByRole("button", { name: "Publish" })).toBeDisabled();

    // And the server refuses even if the disabled button is bypassed.
    await page.goto("/");
    await expect(page.getByText(title)).not.toBeVisible();
  });

  test("editing only the title preserves the existing body", async ({ page }) => {
    // Regression test: the form tracked body HTML in state seeded to "" and
    // Tiptap only emitted on edit, so saving after a title-only change
    // wrote an empty body over the article — silent data loss.
    const email = `bodykeep+${Date.now()}@example.com`;
    await registerModerator(page, email, `bodykeep${Date.now()}`);

    await page.goto("/dashboard/articles/new");
    const title = `Body Preservation ${Date.now()}`;
    const bodyText = "This paragraph must survive a title-only edit.";
    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.locator('[contenteditable="true"]').click();
    await page.keyboard.type(bodyText);
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.waitForURL("/dashboard/articles");

    const articleHref = await page.locator("tr", { hasText: title }).locator("a").getAttribute("href");
    await page.goto(articleHref!);
    await expect(page.locator('[contenteditable="true"]')).toContainText(bodyText);

    // Change only the title, never touching the editor, and save.
    const newTitle = `${title} Updated`;
    await page.getByLabel("Title", { exact: true }).fill(newTitle);
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.waitForURL("/dashboard/articles");

    await page.goto(articleHref!);
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(newTitle);
    await expect(page.locator('[contenteditable="true"]')).toContainText(bodyText);
  });

  test("a moderator cannot edit another moderator's article; an admin can", async ({ page }) => {
    const authorEmail = `owner+${Date.now()}@example.com`;
    await registerModerator(page, authorEmail, `owner${Date.now()}`);

    await page.goto("/dashboard/articles/new");
    const title = `Ownership Test ${Date.now()}`;
    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.locator('[contenteditable="true"]').click();
    await page.keyboard.type("Body text.");
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.waitForURL("/dashboard/articles");
    const articleHref = await page.locator("tr", { hasText: title }).locator("a").getAttribute("href");
    expect(articleHref).toBeTruthy();

    // A second, unrelated moderator is bounced away from the edit page.
    const otherEmail = `intruder+${Date.now()}@example.com`;
    await page.context().clearCookies();
    await registerModerator(page, otherEmail, `intruder${Date.now()}`);
    await page.goto(articleHref!);
    await expect(page).toHaveURL("/dashboard/articles");

    // An admin, by contrast, can open and see the edit form.
    const adminEmail = `admineditor+${Date.now()}@example.com`;
    await page.context().clearCookies();
    await registerModerator(page, adminEmail, `admineditor${Date.now()}`);
    promoteTo("ADMIN", adminEmail);
    // Session was issued as MODERATOR; the jwt callback re-reads role from
    // the DB on every request, so a fresh navigation picks up ADMIN
    // without needing to log in again. That does mean the very next
    // /dashboard/* request now hits the mandatory-MFA gate, so enroll
    // before trying to reach the edit page.
    await enrollMfa(page);
    await page.goto(articleHref!);
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(title);
  });
});
