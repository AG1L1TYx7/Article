import { test, expect, type Page } from "@playwright/test";
import { uniqueTestIp } from "./support/testIp";
import { scalar, sql } from "./support/db";
import { waitForOnHomepage } from "./support/homepage";

const PASSWORD = "correct-horse-battery-staple";

const promoteTo = (role: string, email: string) =>
  sql(`UPDATE "User" SET role = '${role}' WHERE email = '${email}';`);
const markEmailVerified = (email: string) =>
  sql(`UPDATE "User" SET "emailVerifiedAt" = NOW() WHERE email = '${email}';`);
const articleSlug = (title: string) =>
  scalar(`SELECT slug FROM "Article" WHERE title = '${title}' LIMIT 1;`);

const setCategory = (title: string, categorySlug: string) =>
  sql(
    `UPDATE "Article" SET "categoryId" = (SELECT id FROM "Category" WHERE slug = '${categorySlug}') WHERE title = '${title}';`
  );

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestIp() });
});

async function register(page: Page, email: string, handle: string, name: string) {
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

/** Publishes an article and returns the author's handle plus the article title. */
async function publishAs(page: Page, authorName: string, title: string, categorySlug?: string) {
  const stamp = Date.now();
  const email = `navauthor+${stamp}@example.com`;
  const handle = `navauthor${stamp}`;
  await register(page, email, handle, authorName);
  promoteTo("MODERATOR", email);
  markEmailVerified(email);
  await login(page, email);

  await page.goto("/dashboard/articles/new");
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.locator('[contenteditable="true"]').click();
  await page.keyboard.type("Body for navigation tests.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.waitForURL("/dashboard/articles");
  if (categorySlug) setCategory(title, categorySlug);
  await page.locator("tr", { hasText: title }).getByRole("button", { name: "Publish" }).click();
  await page.waitForLoadState("networkidle");
  await page.context().clearCookies();

  return { handle, email, title };
}

test.describe("Public navigation", () => {
  test("an author page lists that author's published work", async ({ page }) => {
    const title = `Nav Author Article ${Date.now()}`;
    const { handle } = await publishAs(page, "Nav Test Author", title);

    await page.goto(`/author/${handle}`);
    await expect(page.getByRole("heading", { name: "Nav Test Author", level: 1 })).toBeVisible();
    await expect(page.getByText(title)).toBeVisible();
    await expect(page.getByText("1 article")).toBeVisible();
  });

  test("an article links to its author page", async ({ page }) => {
    const title = `Nav Link Article ${Date.now()}`;
    const { handle } = await publishAs(page, "Nav Link Author", title);

    // Straight to the article: the link under test is the byline on the
    // article page, and routing through the statically cached homepage to
    // reach it only added a race. The homepage's own listing is covered
    // by its own test below.
    await page.goto(`/article/${articleSlug(title)}`);

    await page.getByRole("link", { name: "Nav Link Author" }).first().click();
    await expect(page).toHaveURL(new RegExp(`/author/${handle}`));
    await expect(page.getByText(title)).toBeVisible();
  });

  test("a published article reaches the homepage", async ({ page }) => {
    // The homepage listing, tested deliberately rather than as an
    // incidental step on the way somewhere else.
    const title = `Nav Homepage Article ${Date.now()}`;
    await publishAs(page, "Nav Homepage Author", title);

    await waitForOnHomepage(page, title);
    await page.getByRole("link", { name: title }).click();
    await expect(page).toHaveURL(/\/article\//);
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  });

  test("a category page lists only that section, and the header links to it", async ({ page }) => {
    const title = `Nav Category Article ${Date.now()}`;
    await publishAs(page, "Nav Category Author", title, "technology");

    await page.goto("/category/technology");
    await expect(page.getByRole("heading", { name: "Technology", level: 1 })).toBeVisible();
    await expect(page.getByText(title)).toBeVisible();

    // A section with published work appears in the masthead. Scoped to
    // the nav: the same section also appears as a label on every article
    // card in that section.
    await page.goto("/");
    await expect(
      page.getByRole("navigation").getByRole("link", { name: "Technology" })
    ).toBeVisible();
  });

  test("an unknown author or category is a 404, not a blank page", async ({ page }) => {
    const missingAuthor = await page.goto("/author/definitely-not-a-real-handle");
    expect(missingAuthor?.status()).toBe(404);

    const missingCategory = await page.goto("/category/definitely-not-a-real-category");
    expect(missingCategory?.status()).toBe(404);
  });

  test("a reader account has no public author page", async ({ page }) => {
    // Author pages are for people who write; a reader's would be empty
    // and would leak that the account exists.
    const stamp = Date.now();
    const email = `navreader+${stamp}@example.com`;
    const handle = `navreader${stamp}`;
    await register(page, email, handle, "Just A Reader");

    const response = await page.goto(`/author/${handle}`);
    expect(response?.status()).toBe(404);
  });

  test("the header offers login to signed-out visitors and Saved once signed in", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();

    const stamp = Date.now();
    const email = `navheader+${stamp}@example.com`;
    await register(page, email, `navheader${stamp}`, "Header Reader");
    await login(page, email);

    await page.goto("/");
    await expect(page.getByRole("link", { name: "Saved" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Log in" })).toHaveCount(0);
  });
});
