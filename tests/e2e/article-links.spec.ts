import { test, expect, type Page } from "@playwright/test";
import { uniqueTestIp } from "./support/testIp";
import { sql, scalar } from "./support/db";

const PASSWORD = "correct-horse-battery-staple";

const promoteTo = (role: string, email: string) =>
  sql(`UPDATE \`User\` SET role = '${role}' WHERE email = '${email}';`);
const markEmailVerified = (email: string) =>
  sql(`UPDATE \`User\` SET \`emailVerifiedAt\` = NOW() WHERE email = '${email}';`);
const articleIdFor = (title: string) =>
  scalar(`SELECT id FROM \`Article\` WHERE title = '${title}' LIMIT 1;`);
const articleSlugFor = (title: string) =>
  scalar(`SELECT slug FROM \`Article\` WHERE title = '${title}' LIMIT 1;`);
const linkCount = (title: string) =>
  Number(
    scalar(
      `SELECT count(*) FROM \`ArticleLink\`
       WHERE \`articleId\` = (SELECT id FROM \`Article\` WHERE title = '${title}' LIMIT 1);`
    )
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

/** Signs in a fresh moderator and leaves them on the edit page for a new draft. */
async function draftAs(page: Page, prefix: string, title: string) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `${prefix}+${stamp}@example.com`;
  await register(page, email, `${prefix}${stamp}`, "Link Test Author");
  promoteTo("MODERATOR", email);
  markEmailVerified(email);
  await login(page, email);

  await page.goto("/dashboard/articles/new");
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.locator('[contenteditable="true"]').click();
  await page.keyboard.type("Article body for the link tests.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.waitForURL("/dashboard/articles");

  const id = articleIdFor(title);
  await page.goto(`/dashboard/articles/${id}`);
  return { email, id };
}

test.describe("Related links", () => {
  test("an author can attach a link and it shows on the published article", async ({ page }) => {
    const title = `Links Attach ${Date.now()}`;
    await draftAs(page, "linkauthor", title);

    // A public URL that this offline test environment cannot reach: the
    // link is still saved, just without a preview, which is exactly the
    // behaviour a newsroom needs when a source site is down.
    await page.getByLabel("Add a link").fill("https://example.com/some-report");
    await page.getByLabel(/^Label/).fill("The full report");
    await page.getByRole("button", { name: "Add link" }).click();

    await expect(page.getByText("The full report")).toBeVisible();
    expect(linkCount(title)).toBe(1);

    // And a reader sees it on the article itself.
    await page.goto("/dashboard/articles");
    await page.locator("tr", { hasText: title }).getByRole("button", { name: "Publish" }).click();
    await page.waitForLoadState("networkidle");

    await page.context().clearCookies();
    await page.goto(`/article/${articleSlugFor(title)}`);
    const link = page.getByRole("link", { name: "The full report" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "https://example.com/some-report");
    // An author must not be able to pass this site's ranking to an
    // arbitrary page, and a reader's path through the site is not the
    // linked host's business.
    await expect(link).toHaveAttribute("rel", /nofollow/);
    await expect(link).toHaveAttribute("rel", /noreferrer/);
  });

  test("a link pointing inside the network is refused", async ({ page }) => {
    // The server would be the one making this request — the SSRF case the
    // whole of lib/linkPreview exists for. It must not be stored as a
    // previewed link, and must not hang the form.
    const title = `Links SSRF ${Date.now()}`;
    await draftAs(page, "linkssrf", title);

    await page.getByLabel("Add a link").fill("http://169.254.169.254/latest/meta-data/");
    await page.getByRole("button", { name: "Add link" }).click();

    // It is saved as a plain link with no preview — the fetch was refused,
    // not attempted — and the author is told so plainly.
    await expect(page.getByText("Nothing could be read from that page")).toBeVisible();
    expect(
      scalar(
        `SELECT coalesce(CAST(\`fetchedAt\` AS CHAR), 'never') FROM \`ArticleLink\`
         WHERE \`articleId\` = (SELECT id FROM \`Article\` WHERE title = '${title}' LIMIT 1);`
      )
    ).toBe("never");
  });

  test("a non-web scheme is rejected outright", async ({ page }) => {
    const title = `Links Scheme ${Date.now()}`;
    await draftAs(page, "linkscheme", title);

    // type="url" lets file: through client-side validation, so the server
    // is what has to say no.
    await page.getByLabel("Add a link").fill("file:///etc/passwd");
    await page.getByRole("button", { name: "Add link" }).click();

    await expect(page.getByText("Links must start with http:// or https://")).toBeVisible();
    expect(linkCount(title)).toBe(0);
  });

  test("an author can remove a link they added", async ({ page }) => {
    const title = `Links Remove ${Date.now()}`;
    await draftAs(page, "linkremove", title);

    await page.getByLabel("Add a link").fill("https://example.com/remove-me");
    await page.getByRole("button", { name: "Add link" }).click();
    // Scoped to the list: with no label and no preview the URL is shown
    // twice in the same row, as the heading and as the source line.
    const row = page.getByRole("listitem").filter({ hasText: "https://example.com/remove-me" });
    await expect(row).toBeVisible();

    await page.getByRole("button", { name: "Remove" }).click();
    await expect(row).toHaveCount(0);
    expect(linkCount(title)).toBe(0);
  });

  test("a moderator cannot add links to someone else's article", async ({ page }) => {
    const title = `Links Ownership ${Date.now()}`;
    const { id } = await draftAs(page, "linkowner", title);

    // A different moderator opens the same edit page.
    await page.context().clearCookies();
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const intruder = `linkintruder+${stamp}@example.com`;
    await register(page, intruder, `linkintruder${stamp}`, "Someone Else");
    promoteTo("MODERATOR", intruder);
    markEmailVerified(intruder);
    await login(page, intruder);

    await page.goto(`/dashboard/articles/${id}`);
    // Sent away from an article that isn't theirs.
    await expect(page).toHaveURL("/dashboard/articles");
    expect(linkCount(title)).toBe(0);
  });
});
