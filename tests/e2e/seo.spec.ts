import { test, expect, type Page } from "@playwright/test";
import { uniqueTestIp } from "./support/testIp";
import { scalar, sql } from "./support/db";
import { finishLogin, mfaColumnsSql } from "./support/staff";

const PASSWORD = "correct-horse-battery-staple";

const promoteTo = (role: string, email: string) =>
  sql(`UPDATE \`User\` SET role = '${role}'${role === "MODERATOR" ? `, ${mfaColumnsSql()}` : ""} WHERE email = '${email}';`);
const markEmailVerified = (email: string) =>
  sql(`UPDATE \`User\` SET \`emailVerifiedAt\` = NOW() WHERE email = '${email}';`);
const articleSlug = (title: string) =>
  scalar(`SELECT slug FROM \`Article\` WHERE title = '${title}' LIMIT 1;`);

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestIp() });
});

async function register(page: Page, email: string, handle: string, name: string) {
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
  await finishLogin(page);
}

/** Creates a draft, and publishes it only if asked. */
async function writeArticle(page: Page, title: string, publish: boolean) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `seo+${stamp}@example.com`;
  await register(page, email, `seo${stamp}`, "SEO Test Author");
  promoteTo("MODERATOR", email);
  markEmailVerified(email);
  await login(page, email);

  await page.goto("/dashboard/articles/new");
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.locator('[contenteditable="true"]').click();
  await page.keyboard.type("Body for the SEO tests.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.waitForURL("/dashboard/articles");

  if (publish) {
    await page.locator("tr", { hasText: title }).getByRole("button", { name: "Publish" }).click();
    await page.waitForLoadState("networkidle");
  }

  await page.context().clearCookies();
  return articleSlug(title);
}

test.describe("Public reading experience", () => {
  test("robots.txt points at the sitemap and keeps crawlers out of private paths", async ({
    page,
  }) => {
    const response = await page.goto("/robots.txt");
    expect(response?.status()).toBe(200);

    const body = (await response?.text()) ?? "";
    expect(body).toContain("Sitemap:");
    expect(body).toContain("/sitemap.xml");
    // Signed-in-only areas, and the infinite thin space of search results.
    for (const path of ["/dashboard", "/saved", "/following", "/notifications", "/search"]) {
      expect(body, `robots.txt should disallow ${path}`).toContain(`Disallow: ${path}`);
    }
  });

  test("the sitemap lists published articles and never drafts", async ({ page }) => {
    const publishedTitle = `SEO Published ${Date.now()}`;
    const draftTitle = `SEO Draft ${Date.now()}`;
    const publishedSlug = await writeArticle(page, publishedTitle, true);
    const draftSlug = await writeArticle(page, draftTitle, false);

    const response = await page.goto("/sitemap.xml");
    expect(response?.status()).toBe(200);
    const xml = (await response?.text()) ?? "";

    expect(xml).toContain("<urlset");
    expect(xml).toContain(`/article/${publishedSlug}`);
    // A sitemap entry that 404s tells a crawler the site is unreliable.
    expect(xml, "a draft must never be advertised to crawlers").not.toContain(
      `/article/${draftSlug}`
    );
  });

  test("the RSS feed is valid, and carries published articles only", async ({ page }) => {
    const publishedTitle = `SEO Feed ${Date.now()}`;
    const draftTitle = `SEO Feed Draft ${Date.now()}`;
    const publishedSlug = await writeArticle(page, publishedTitle, true);
    const draftSlug = await writeArticle(page, draftTitle, false);

    const response = await page.goto("/feed.xml");
    expect(response?.status()).toBe(200);
    expect(response?.headers()["content-type"]).toContain("application/rss+xml");

    const xml = (await response?.text()) ?? "";
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain(`<title>${publishedTitle}</title>`);
    expect(xml).toContain(`/article/${publishedSlug}`);
    expect(xml, "a draft must never reach subscribers").not.toContain(`/article/${draftSlug}`);

    // A feed a reader can subscribe to has to be discoverable from the
    // page itself, which is how most subscribe buttons find it.
    await page.goto("/");
    const alternate = page.locator('link[rel="alternate"][type="application/rss+xml"]');
    await expect(alternate).toHaveAttribute("href", /\/feed\.xml$/);
  });

  test("an article carries a canonical URL and a share card", async ({ page }) => {
    const title = `SEO Card ${Date.now()}`;
    const slug = await writeArticle(page, title, true);

    await page.goto(`/article/${slug}`);

    // Without a canonical, the same article reached with a tracking
    // parameter looks like a duplicate page to a search engine.
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp(`/article/${slug}$`)
    );

    const ogImage = page.locator('meta[property="og:image"]');
    await expect(ogImage).toHaveCount(1);
    // Relative URLs in a share card are ignored outright, which is what
    // metadataBase exists to prevent.
    const imageUrl = await ogImage.getAttribute("content");
    expect(imageUrl).toMatch(/^https?:\/\//);

    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute("content", "article");
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      "content",
      "summary_large_image"
    );
  });

  test("the share card is a real image", async ({ page }) => {
    const title = `SEO Image ${Date.now()}`;
    const slug = await writeArticle(page, title, true);

    // Fetch the URL the page actually advertises rather than a guessed
    // path: Next.js appends a content hash to the generated image route
    // (…/opengraph-image-<hash>), and that advertised URL is the one every
    // crawler and chat unfurler will request.
    await page.goto(`/article/${slug}`);
    const imageUrl = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(imageUrl).toBeTruthy();

    const response = await page.request.get(imageUrl!);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");

    const body = await response.body();
    expect(body && body.length).toBeGreaterThan(1000);
    // PNG magic bytes: a 200 response of the wrong thing is still a
    // broken card everywhere it is shared.
    expect(body?.subarray(1, 4).toString()).toBe("PNG");
  });
});
