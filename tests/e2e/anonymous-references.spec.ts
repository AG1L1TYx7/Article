import { test, expect, type Page } from "@playwright/test";
import { uniqueTestIp } from "./support/testIp";
import { scalar, sql } from "./support/db";
import { finishLogin, mfaColumnsSql } from "./support/staff";

const PASSWORD = "correct-horse-battery-staple";

/**
 * Two things a writer can do when publishing: cite sources in a numbered
 * References list, and publish without a byline.
 *
 * Anonymity is tested from every side a name could leak: the byline, the
 * follow control, the author page, the feed, search by author, share
 * metadata — and the newsroom list, where staff must still see whose it is.
 */
test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestIp() });
});

async function signInAsModerator(page: Page, prefix: string, name: string) {
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const handle = `${prefix}${stamp}`;
  const email = `${prefix}+${stamp}@example.com`;
  await page.goto("/register");
  await page.fill('input[name="name"]', name);
  await page.fill('input[name="handle"]', handle);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.check('input[name="consent"]');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/login/);
  sql(`UPDATE \`User\` SET role = 'MODERATOR', ${mfaColumnsSql()}, \`emailVerifiedAt\` = NOW() WHERE email = '${email}';`);
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await finishLogin(page);
  return { email, handle };
}

test("a story can cite numbered references and go out without a byline", async ({ page }) => {
  test.slow();
  const writer = "Quiet Correspondent";
  const { handle } = await signInAsModerator(page, "anon", writer);
  const stamp = Date.now();
  const title = `Unsigned report ${stamp}`;

  // Write it, anonymously, and let the autosave create the draft.
  await page.goto("/dashboard/articles/new");
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.locator('[contenteditable="true"]').click();
  await page.keyboard.type("The figures come from the council's own assessment.");
  await page.getByLabel(/Publish anonymously/).check();
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.waitForURL("/dashboard/articles");

  // The newsroom list still shows the writer, and that readers will not.
  const row = page.locator("tr", { hasText: title });
  await expect(row).toContainText("anonymous");

  // References are added on the edit page, then cited in the text.
  await row.getByRole("link", { name: title }).click();
  await page.waitForURL(/\/dashboard\/articles\/[a-z0-9]+$/);
  const refs = page.locator("[data-article-references]");
  await refs.getByLabel("Add a reference").fill("Housing needs assessment 2026");
  await refs.getByLabel("Author").fill("Riverside Council");
  await refs.getByLabel("Link", { exact: false }).fill("https://example.gov/housing-2026.pdf");
  await refs.getByLabel("Date").fill("12 May 2026");
  await refs.getByRole("button", { name: "Add reference" }).click();
  await expect(refs).toContainText("1.");
  await refs.getByLabel("Add a reference").fill("Minutes of the planning committee");
  await refs.getByLabel("Publication").fill("Riverside Council");
  await refs.getByRole("button", { name: "Add reference" }).click();
  await expect(refs).toContainText("2.");

  // Cite the second source: the toolbar asks for its number.
  await page.locator('[contenteditable="true"]').click();
  await page.keyboard.press("End");
  page.once("dialog", (d) => d.accept("2"));
  await page.getByRole("button", { name: "Cite a reference" }).click();
  await expect(page.locator('.ProseMirror a[href="#ref-2"]')).toHaveText("[2]");
  await expect(page.getByLabel(/Publish anonymously/)).toBeChecked();
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.waitForURL("/dashboard/articles");
  await page.locator("tr", { hasText: title }).getByRole("button", { name: "Publish" }).click();
  await expect(page.locator("tr", { hasText: title })).toContainText(/PUBLISHED/i);
  const slug = scalar(`SELECT slug FROM \`Article\` WHERE title = '${title}';`);
  expect(scalar(`SELECT count(*) FROM \`ArticleReference\` r JOIN \`Article\` a ON a.id = r.\`articleId\` WHERE a.slug = '${slug}';`)).toBe("2");

  // A reader: no name anywhere, no follow, the citation and the list.
  await page.context().clearCookies();
  await page.goto(`/article/${slug}`, { waitUntil: "networkidle" });
  await expect(page.locator("[data-anonymous-byline]")).toHaveText("Anonymous");
  await expect(page.getByRole("link", { name: writer })).toHaveCount(0);
  await expect(page.getByText(writer)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Follow/ })).toHaveCount(0);
  await expect(page.locator('.prose-article a[href="#ref-2"]')).toHaveText("[2]");
  const list = page.locator("[data-references]");
  await expect(list).toContainText("References");
  await expect(list.locator("#ref-1")).toContainText("Housing needs assessment 2026");
  await expect(list.locator("#ref-1").getByRole("link")).toHaveAttribute("href", "https://example.gov/housing-2026.pdf");
  await expect(list.locator("#ref-2")).toContainText("Minutes of the planning committee");
  const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? "{}") as {
    author: { "@type": string; name: string };
    citation: { name: string; url?: string }[];
  };
  expect(ld.author["@type"]).toBe("Organization");
  expect(ld.author.name).not.toBe(writer);
  expect(ld.citation.map((c) => c.name)).toEqual(["Housing needs assessment 2026", "Minutes of the planning committee"]);
  const html = await page.content();
  expect(html).not.toContain(`article:author`);

  // Not on the writer's page, not in a search by their handle, not in the feed under their name.
  await page.goto(`/author/${handle}`);
  await expect(page.getByText(title)).toHaveCount(0);
  await page.goto(`/search?author=${handle}`);
  await expect(page.getByText(title)).toHaveCount(0);
  const feed = await (await page.request.get("/feed.xml")).text();
  const item = feed.slice(feed.indexOf(`<title>${title}</title>`));
  expect(item.slice(0, item.indexOf("</item>"))).toContain("<dc:creator>Anonymous</dc:creator>");
  expect(item.slice(0, item.indexOf("</item>"))).not.toContain(writer);
});
