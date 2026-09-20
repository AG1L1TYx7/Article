import { test, expect, type Page } from "@playwright/test";
import { uniqueTestIp } from "./support/testIp";
import { scalar, sql } from "./support/db";
import { commentInThread } from "./support/comments";

const PASSWORD = "correct-horse-battery-staple";

const promoteTo = (role: string, email: string) =>
  sql(`UPDATE "User" SET role = '${role}' WHERE email = '${email}';`);
const markEmailVerified = (email: string) =>
  sql(`UPDATE "User" SET "emailVerifiedAt" = NOW() WHERE email = '${email}';`);
/** Fakes an established account, so its next comment skips the new-account queue. */
const grantCommentTrust = (email: string) =>
  sql(
    `UPDATE "Comment" SET status = 'APPROVED' WHERE "userId" = (SELECT id FROM "User" WHERE email = '${email}');`
  );

/**
 * Reads an article's slug straight from the database.
 *
 * Tests used to reach an article by loading the homepage and clicking its
 * headline, but the homepage is statically cached: right after
 * publishing, the next request can still serve the previous version, so
 * the headline isn't there yet and the click times out. Going directly to
 * /article/<slug> tests the article page without depending on cache
 * revalidation timing.
 */
function articleSlug(title: string): string {
  return scalar(`SELECT slug FROM "Article" WHERE title = '${title}' LIMIT 1;`);
}

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestIp() });
});

async function register(page: Page, email: string, handle: string, name = "Commenter") {
  await page.goto("/register");
  await page.fill('input[name="name"]', name);
  await page.fill('input[name="handle"]', handle);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/login/);
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

/** Publishes an article as a throwaway moderator and returns its public URL. */
async function publishArticle(page: Page, title: string): Promise<string> {
  const email = `cmod+${Date.now()}@example.com`;
  await register(page, email, `cmod${Date.now()}`, "Comment Test Author");
  promoteTo("MODERATOR", email);
  markEmailVerified(email);
  await login(page, email);

  await page.goto("/dashboard/articles/new");
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.locator('[contenteditable="true"]').click();
  await page.keyboard.type("Article body for the comment tests.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.waitForURL("/dashboard/articles");
  await page.locator("tr", { hasText: title }).getByRole("button", { name: "Publish" }).click();
  await page.waitForLoadState("networkidle");

  await page.context().clearCookies();
  return `/article/${articleSlug(title)}`;
}

test.describe("Comments", () => {
  test("a signed-out reader is invited to log in, not given a comment box", async ({ page }) => {
    const articleUrl = await publishArticle(page, `Comments Signed Out ${Date.now()}`);
    await page.goto(articleUrl);
    await expect(page.getByText("to join the discussion.")).toBeVisible();
    await expect(page.getByPlaceholder("Join the discussion…")).toHaveCount(0);
  });

  test("an unverified reader is told to verify before commenting", async ({ page }) => {
    const articleUrl = await publishArticle(page, `Comments Unverified ${Date.now()}`);

    const email = `cunverified+${Date.now()}@example.com`;
    await register(page, email, `cunverified${Date.now()}`);
    await login(page, email);

    await page.goto(articleUrl);
    await expect(page.getByText("Verify your email address to comment.")).toBeVisible();
    await expect(page.getByPlaceholder("Join the discussion…")).toHaveCount(0);
  });

  test("a new account's first comment waits for a moderator, then appears once approved", async ({ page }) => {
    const articleUrl = await publishArticle(page, `Comments Moderated ${Date.now()}`);

    const email = `cnew+${Date.now()}@example.com`;
    await register(page, email, `cnew${Date.now()}`, "New Reader");
    markEmailVerified(email);
    await login(page, email);

    const body = `First post from a brand new account ${Date.now()}`;
    await page.goto(articleUrl);
    await page.getByPlaceholder("Join the discussion…").fill(body);
    await page.getByRole("button", { name: "Post comment" }).click();

    // Told plainly that it is held, rather than silently vanishing.
    await expect(page.getByText("a moderator will review it")).toBeVisible();

    // And it is genuinely not public yet.
    await page.reload();
    await expect(commentInThread(page, body)).toHaveCount(0);

    // A moderator approves it.
    const modEmail = `cmoderator+${Date.now()}@example.com`;
    await page.context().clearCookies();
    await register(page, modEmail, `cmoderator${Date.now()}`);
    promoteTo("MODERATOR", modEmail);
    markEmailVerified(modEmail);
    await login(page, modEmail);

    await page.goto("/dashboard/comments");
    await expect(page.getByText(body)).toBeVisible();
    await page.locator("li", { hasText: body }).getByRole("button", { name: "Approve" }).click();
    await page.waitForLoadState("networkidle");

    // Now it is visible to everyone, including signed-out readers.
    await page.context().clearCookies();
    await page.goto(articleUrl);
    await expect(commentInThread(page, body)).toBeVisible();
  });

  test("an established account's comment posts immediately", async ({ page }) => {
    const articleUrl = await publishArticle(page, `Comments Trusted ${Date.now()}`);

    const email = `ctrusted+${Date.now()}@example.com`;
    await register(page, email, `ctrusted${Date.now()}`, "Regular Reader");
    markEmailVerified(email);
    await login(page, email);

    await page.goto(articleUrl);
    for (let i = 0; i < 3; i++) {
      await page.getByPlaceholder("Join the discussion…").fill(`Warm up comment ${i} ${Date.now()}`);
      await page.getByRole("button", { name: "Post comment" }).click();
      await expect(page.getByText("a moderator will review it")).toBeVisible();
    }
    grantCommentTrust(email);

    const body = `This one should appear straight away ${Date.now()}`;
    await page.reload();
    await page.getByPlaceholder("Join the discussion…").fill(body);
    await page.getByRole("button", { name: "Post comment" }).click();

    await expect(commentInThread(page, body)).toBeVisible();
  });

  test("a link-stuffed comment is held even from an established account", async ({ page }) => {
    const articleUrl = await publishArticle(page, `Comments Spam ${Date.now()}`);

    const email = `cspam+${Date.now()}@example.com`;
    await register(page, email, `cspam${Date.now()}`, "Spammy Reader");
    markEmailVerified(email);
    await login(page, email);

    await page.goto(articleUrl);
    await page.getByPlaceholder("Join the discussion…").fill("warm up comment here");
    await page.getByRole("button", { name: "Post comment" }).click();
    await expect(page.getByText("a moderator will review it")).toBeVisible();
    grantCommentTrust(email);

    const spam = "https://a.example https://b.example https://c.example https://d.example";
    await page.reload();
    await page.getByPlaceholder("Join the discussion…").fill(spam);
    await page.getByRole("button", { name: "Post comment" }).click();

    // Trusted account, but the content itself trips the heuristic.
    await expect(page.getByText("a moderator will review it")).toBeVisible();
  });
});
