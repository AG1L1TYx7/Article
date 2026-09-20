import { test, expect, type Page } from "@playwright/test";
import { uniqueTestIp } from "./support/testIp";
import { waitForHydration } from "./support/hydration";
import { scalar, sql } from "./support/db";

const PASSWORD = "correct-horse-battery-staple";

const promoteTo = (role: string, email: string) =>
  sql(`UPDATE \`User\` SET role = '${role}' WHERE email = '${email}';`);
const markEmailVerified = (email: string) =>
  sql(`UPDATE \`User\` SET \`emailVerifiedAt\` = NOW() WHERE email = '${email}';`);

/**
 * Clicks a toggle and waits for that toggle's own server action to
 * respond.
 *
 * Matches on the next-action header so an unrelated POST (login, another
 * action, a framework request) can't satisfy the wait. Deliberately does
 * not retry: a retry can land after a slow first click already succeeded
 * and toggle the value straight back off, which is exactly the failure
 * this helper is meant to prevent.
 */
async function clickAndSettle(page: Page, name: string | RegExp) {
  await waitForHydration(page, name);

  const button = page.getByRole("button", { name, exact: typeof name === "string" });
  await expect(button).toBeEnabled();

  await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === "POST" && "next-action" in r.request().headers() && r.status() < 400,
      { timeout: 15000 }
    ),
    button.click(),
  ]);
}

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
  return scalar(`SELECT slug FROM \`Article\` WHERE title = '${title}' LIMIT 1;`);
}

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestIp() });
});

async function register(page: Page, email: string, handle: string, name = "Reader") {
  await page.goto("/register");
  await page.fill('input[name="name"]', name);
  await page.fill('input[name="handle"]', handle);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.check('input[name="consent"]');
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

async function publishArticle(page: Page, title: string): Promise<string> {
  const email = `emod+${Date.now()}@example.com`;
  await register(page, email, `emod${Date.now()}`, "Engagement Author");
  promoteTo("MODERATOR", email);
  markEmailVerified(email);
  await login(page, email);

  await page.goto("/dashboard/articles/new");
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.locator('[contenteditable="true"]').click();
  await page.keyboard.type("Body for engagement tests.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.waitForURL("/dashboard/articles");
  await page.locator("tr", { hasText: title }).getByRole("button", { name: "Publish" }).click();
  await page.waitForLoadState("networkidle");

  await page.context().clearCookies();
  return `/article/${articleSlug(title)}`;
}

test.describe("Engagement", () => {
  test("a signed-out reader sees the controls but cannot use them", async ({ page }) => {
    const articleUrl = await publishArticle(page, `Engagement SignedOut ${Date.now()}`);
    await page.goto(articleUrl);

    await expect(page.getByRole("button", { name: "Like" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  });

  test("liking an article persists across a reload and toggles back off", async ({ page }) => {
    const articleUrl = await publishArticle(page, `Engagement Like ${Date.now()}`);

    const email = `eliker+${Date.now()}@example.com`;
    await register(page, email, `eliker${Date.now()}`);
    await login(page, email);
    await page.goto(articleUrl);

    // Assert on persisted state, not the optimistic label. The label
    // flips locally the instant the button is clicked, so asserting it
    // before a reload really tests React hydration timing rather than
    // whether the like was saved — which made this test flaky under
    // parallel load. After a reload the button is rendered from the
    // database, so it can only say "Liked" if the write landed.
    await clickAndSettle(page, "Like");
    await page.reload();
    await expect(page.getByRole("button", { name: /Liked/ })).toBeVisible();

    await clickAndSettle(page, /Liked/);
    await page.reload();
    await expect(page.getByRole("button", { name: "Like" })).toBeVisible();
  });

  test("saving an article puts it on the saved page, and unsaving removes it", async ({ page }) => {
    const title = `Engagement Save ${Date.now()}`;
    const articleUrl = await publishArticle(page, title);

    const email = `esaver+${Date.now()}@example.com`;
    await register(page, email, `esaver${Date.now()}`);
    await login(page, email);

    await page.goto("/saved");
    await expect(page.getByText("Nothing saved yet")).toBeVisible();

    await page.goto(articleUrl);
    await clickAndSettle(page, "Save");
    await page.reload();
    await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();

    await page.goto("/saved");
    await expect(page.getByText(title)).toBeVisible();

    await page.goto(articleUrl);
    await clickAndSettle(page, "Saved");
    await page.reload();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();

    await page.goto("/saved");
    await expect(page.getByText(title)).toHaveCount(0);
  });

  test("following an author persists, and you are never offered a follow of yourself", async ({ page }) => {
    const title = `Engagement Follow ${Date.now()}`;

    // The author publishes, then views their own article.
    const authorEmail = `eauthor+${Date.now()}@example.com`;
    await register(page, authorEmail, `eauthor${Date.now()}`, "Self Author");
    promoteTo("MODERATOR", authorEmail);
    markEmailVerified(authorEmail);
    await login(page, authorEmail);
    await page.goto("/dashboard/articles/new");
    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.locator('[contenteditable="true"]').click();
    await page.keyboard.type("Body.");
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.waitForURL("/dashboard/articles");
    await page.locator("tr", { hasText: title }).getByRole("button", { name: "Publish" }).click();
    await page.waitForLoadState("networkidle");
    const articleUrl = `/article/${articleSlug(title)}`;
    await page.goto(articleUrl);

    await expect(page.getByRole("button", { name: /Follow/ })).toHaveCount(0);

    // A different reader is offered it, and it sticks.
    await page.context().clearCookies();
    const readerEmail = `efollower+${Date.now()}@example.com`;
    await register(page, readerEmail, `efollower${Date.now()}`);
    await login(page, readerEmail);
    await page.goto(articleUrl);

    // Persisted state only — see the note in the like test.
    await clickAndSettle(page, /^Follow /);
    await page.reload();
    await expect(page.getByRole("button", { name: /^Following / })).toBeVisible();
  });
});
