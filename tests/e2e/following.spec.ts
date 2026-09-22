import { test, expect, type Page } from "@playwright/test";
import { uniqueTestIp } from "./support/testIp";
import { waitForHydration } from "./support/hydration";
import { scalar, sql } from "./support/db";
import { finishLogin } from "./support/staff";

const PASSWORD = "correct-horse-battery-staple";

/**
 * The personalised "Following" feed.
 *
 * The article under test is inserted directly rather than published
 * through the newsroom UI: these tests are about following, and the
 * publishing flow has its own suite. It is owned by the e2e fixture
 * account so the next run's cleanup removes it.
 */
function seedPublishedArticle(title: string, categoryId: string): string {
  const slug = `following-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  sql(
    `INSERT INTO \`Article\` (id, slug, title, dek, \`bodyJson\`, \`bodyHtml\`, status, locale, \`authorId\`, \`categoryId\`, \`publishedAt\`, \`createdAt\`, \`updatedAt\`)
     VALUES ('${slug}', '${slug}', '${title}', 'A story for the following feed.', '{}', '<p>Body.</p>', 'PUBLISHED', 'en',
             (SELECT id FROM \`User\` WHERE email = 'e2e-fixture@example.com'), '${categoryId}', NOW(3), NOW(3), NOW(3));`
  );
  return slug;
}

/**
 * A category to follow: the first seeded one, or one made for the run.
 *
 * Joined with "|" rather than a tab: the mysql client's batch output
 * escapes a tab inside a value as the two characters "\t".
 */
function someCategory(): { id: string; slug: string; name: string } {
  let row = scalar("SELECT CONCAT_WS('|', id, slug, name) FROM `Category` ORDER BY name LIMIT 1;");
  if (!row) {
    const stamp = Date.now();
    sql(
      `INSERT INTO \`Category\` (id, slug, name)
       VALUES ('cat-${stamp}', 'e2e-section-${stamp}', 'E2E Section ${stamp}');`
    );
    row = scalar(`SELECT CONCAT_WS('|', id, slug, name) FROM \`Category\` WHERE id = 'cat-${stamp}';`);
  }
  const [id, slug, name] = row.split("|");
  return { id: id!, slug: slug!, name: name! };
}

async function registerAndLogin(page: Page, email: string, handle: string) {
  await page.goto("/register");
  await page.fill('input[name="name"]', "Follower");
  await page.fill('input[name="handle"]', handle);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.check('input[name="consent"]');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/login/);
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await finishLogin(page);
}

async function clickToggle(page: Page, name: string) {
  await waitForHydration(page, name);
  const button = page.getByRole("button", { name, exact: true });
  await expect(button).toBeEnabled();
  await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === "POST" && "next-action" in r.request().headers() && r.status() < 400,
      { timeout: 15000 }
    ),
    button.click(),
  ]);
}

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestIp() });
});

test.describe("Following feed", () => {
  test("is private: signed-out readers are sent to log in", async ({ page }) => {
    await page.goto("/following");
    await expect(page).toHaveURL(/\/login/);
  });

  test("a section can be followed from its page, feeds the reader's list and the front page, and can be unfollowed", async ({
    page,
  }) => {
    test.slow();
    const stamp = Date.now();
    const category = someCategory();
    const title = `Following Feed Story ${stamp}`;
    seedPublishedArticle(title, category.id);

    await registerAndLogin(page, `follower+${stamp}@example.com`, `follower${stamp}`);

    // Nothing followed yet.
    await page.goto("/following");
    await expect(page.getByText("You aren't following anyone yet")).toBeVisible();
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "From writers and sections you follow" })).toHaveCount(0);

    // Follow the section.
    await page.goto(`/category/${category.slug}`);
    await clickToggle(page, `Follow ${category.name}`);
    await expect(page.getByRole("button", { name: `Following ${category.name}` })).toBeVisible();

    // The feed lists the story, and names the section as a source.
    await page.goto("/following");
    await expect(page.getByRole("link", { name: title })).toBeVisible();
    await expect(page.getByRole("list", { name: "What you follow" }).getByRole("link", { name: category.name })).toBeVisible();

    // The front page grows a personalised strip, linked to the full feed.
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "From writers and sections you follow" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Everything you follow/ })).toHaveAttribute("href", "/following");

    // And the follow is recorded against the section, not an author.
    expect(
      scalar(
        `SELECT count(*) FROM \`Follow\` f JOIN \`User\` u ON u.id = f.\`followerId\`
         WHERE u.email = 'follower+${stamp}@example.com' AND f.\`categoryId\` = '${category.id}' AND f.\`authorId\` IS NULL;`
      )
    ).toBe("1");

    // Unfollow: the feed empties and the strip goes.
    await page.goto(`/category/${category.slug}`);
    await clickToggle(page, `Following ${category.name}`);
    await page.goto("/following");
    await expect(page.getByText("You aren't following anyone yet")).toBeVisible();
  });

  test("a signed-out reader sees the follow control but cannot use it", async ({ page }) => {
    const category = someCategory();
    await page.goto(`/category/${category.slug}`);
    await expect(page.getByRole("button", { name: `Follow ${category.name}` })).toBeDisabled();
  });
});
