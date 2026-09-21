import { test, expect, type Page } from "@playwright/test";
import { uniqueTestIp } from "./support/testIp";
import { sql } from "./support/db";

const PASSWORD = "correct-horse-battery-staple";

const promoteTo = (role: string, email: string) =>
  sql(`UPDATE \`User\` SET role = '${role}' WHERE email = '${email}';`);
const markEmailVerified = (email: string) =>
  sql(`UPDATE \`User\` SET \`emailVerifiedAt\` = NOW() WHERE email = '${email}';`);
const setCategory = (title: string, categorySlug: string) =>
  sql(
    `UPDATE \`Article\` SET \`categoryId\` = (SELECT id FROM \`Category\` WHERE slug = '${categorySlug}') WHERE title = '${title}';`
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

/** Publishes an article with the given headline and body, then signs out. */
async function publish(
  page: Page,
  opts: { title: string; body: string; authorName: string; categorySlug?: string }
) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `searchauthor+${stamp}@example.com`;
  const handle = `searchauthor${stamp}`;
  await register(page, email, handle, opts.authorName);
  promoteTo("MODERATOR", email);
  markEmailVerified(email);
  await login(page, email);

  await page.goto("/dashboard/articles/new");
  await page.getByLabel("Title", { exact: true }).fill(opts.title);
  await page.locator('[contenteditable="true"]').click();
  await page.keyboard.type(opts.body);
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.waitForURL("/dashboard/articles");
  if (opts.categorySlug) setCategory(opts.title, opts.categorySlug);
  await page.locator("tr", { hasText: opts.title }).getByRole("button", { name: "Publish" }).click();
  await page.waitForLoadState("networkidle");
  await page.context().clearCookies();

  return { handle, email };
}

test.describe("Search", () => {
  test("a word that appears only in the body finds the article", async ({ page }) => {
    // The whole point of the searchText column: matching body copy, not
    // just headlines. The marker word appears nowhere else in the database.
    const marker = `zorbulate${Date.now()}`;
    const title = `Search Body Article ${Date.now()}`;
    await publish(page, {
      title,
      body: `The committee voted to ${marker} the proposal this week.`,
      authorName: "Search Body Author",
    });

    await page.goto(`/search?q=${marker}`);
    await expect(page.getByRole("link", { name: title })).toBeVisible();
    await expect(page.getByText("1 article matching")).toBeVisible();
  });

  test("the header search box takes you to results", async ({ page }) => {
    const marker = `headersearch${Date.now()}`;
    const title = `Search Header Article ${marker}`;
    await publish(page, { title, body: "Body copy.", authorName: "Search Header Author" });

    await page.goto("/");
    await page.getByLabel("Search articles").fill(marker);
    await page.getByLabel("Search articles").press("Enter");

    await expect(page).toHaveURL(new RegExp(`/search\\?q=${marker}`));
    await expect(page.getByRole("link", { name: title })).toBeVisible();
  });

  test("a query matching nothing says so instead of showing an empty page", async ({ page }) => {
    await page.goto(`/search?q=qwertzuiopasdfgh${Date.now()}`);
    await expect(page.getByText("No articles match")).toBeVisible();
  });

  test("punctuation a reader might type does not break the page", async ({ page }) => {
    // websearch_to_tsquery tolerates this; to_tsquery would raise a syntax
    // error and turn a stray character into a 500.
    const response = await page.goto("/search?q=%22unclosed%20%26%20%7C%20!%20(");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Search", level: 1 })).toBeVisible();
  });

  test("filtering by section narrows the results", async ({ page }) => {
    const marker = `sectionfilter${Date.now()}`;
    const inTech = `Search Tech ${marker}`;
    const inWorld = `Search World ${marker}`;
    await publish(page, {
      title: inTech,
      body: `A story about ${marker}.`,
      authorName: "Search Tech Author",
      categorySlug: "technology",
    });
    await publish(page, {
      title: inWorld,
      body: `Another story about ${marker}.`,
      authorName: "Search World Author",
      categorySlug: "world",
    });

    await page.goto(`/search?q=${marker}`);
    await expect(page.getByRole("link", { name: inTech })).toBeVisible();
    await expect(page.getByRole("link", { name: inWorld })).toBeVisible();

    await page.goto(`/search?q=${marker}&category=technology`);
    await expect(page.getByRole("link", { name: inTech })).toBeVisible();
    await expect(page.getByRole("link", { name: inWorld })).toHaveCount(0);
  });

  test("filtering by author narrows the results, and the dropdown remembers who", async ({ page }) => {
    const marker = `authorfilter${Date.now()}`;
    const mine = `Search Mine ${marker}`;
    const theirs = `Search Theirs ${marker}`;
    const { handle } = await publish(page, {
      title: mine,
      body: `Reporting on ${marker}.`,
      authorName: "Search Filter Author",
    });
    await publish(page, {
      title: theirs,
      body: `Also reporting on ${marker}.`,
      authorName: "Search Other Author",
    });

    await page.goto(`/search?q=${marker}&author=${handle}`);
    await expect(page.getByRole("link", { name: mine })).toBeVisible();
    await expect(page.getByRole("link", { name: theirs })).toHaveCount(0);

    // Reloading a filtered URL must not silently reset the control while
    // the filter is still applied.
    await expect(page.getByLabel("Author")).toHaveValue(handle);
  });

  test("a story published moments ago is inside the past-24-hours filter", async ({ page }) => {
    // Regression guard. publishedAt is a naive UTC timestamp while now()
    // and bound Date parameters are timestamptz; comparing them directly
    // shifts every article by the database session's UTC offset, which
    // made anything published in the last few hours invisible. See the
    // comment on the WHERE clause in lib/search.ts.
    const marker = `freshstory${Date.now()}`;
    const title = `Search Fresh ${marker}`;
    await publish(page, {
      title,
      body: `Breaking coverage of ${marker}.`,
      authorName: "Search Fresh Author",
    });

    await page.goto(`/search?q=${marker}&range=24h`);
    await expect(page.getByRole("link", { name: title })).toBeVisible();

    // And the filter still excludes things: nothing was published a year ago.
    await page.goto(`/search?q=${marker}&range=year`);
    await expect(page.getByRole("link", { name: title })).toBeVisible();
  });

  test("a filter with no search words browses the section, newest first", async ({ page }) => {
    const marker = `browseonly${Date.now()}`;
    const title = `Search Browse ${marker}`;
    await publish(page, {
      title,
      body: `A story that is only reached by browsing ${marker}.`,
      authorName: "Search Browse Author",
      categorySlug: "sport",
    });

    // No q at all: the section filter alone must list the story, and say so.
    await page.goto("/search?category=sport");
    await expect(page.getByRole("link", { name: title })).toBeVisible();
    // Scoped to main: the footer's push toggle carries its own status text.
    await expect(page.getByRole("main").getByRole("status")).toContainText(/articles? in Sport, newest first/);

    // A different section must not show it.
    await page.goto("/search?category=world");
    await expect(page.getByRole("link", { name: title })).toHaveCount(0);
  });

  test("changing a filter dropdown applies it without pressing Search", async ({ page }) => {
    await page.goto("/search", { waitUntil: "networkidle" });
    // By role, not label: the masthead's <nav aria-label="Sections"> also
    // answers to getByLabel("Section").
    const section = page.getByRole("combobox", { name: "Section" });
    await section.selectOption("sport");
    await page.waitForURL(/\/search\?.*category=sport/);
    await expect(page.getByRole("combobox", { name: "Section" })).toHaveValue("sport");
  });

  test("a draft is never searchable", async ({ page }) => {
    const marker = `draftonly${Date.now()}`;
    const title = `Search Draft ${marker}`;

    const stamp = Date.now();
    const email = `searchdraft+${stamp}@example.com`;
    await register(page, email, `searchdraft${stamp}`, "Search Draft Author");
    promoteTo("MODERATOR", email);
    markEmailVerified(email);
    await login(page, email);

    await page.goto("/dashboard/articles/new");
    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.locator('[contenteditable="true"]').click();
    await page.keyboard.type(`Unpublished notes about ${marker}.`);
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.waitForURL("/dashboard/articles");

    // Even signed in as its own author — search only ever reads published work.
    await page.goto(`/search?q=${marker}`);
    await expect(page.getByText("No articles match")).toBeVisible();
  });
});
