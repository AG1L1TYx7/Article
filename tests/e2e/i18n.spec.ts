import { test, expect } from "@playwright/test";
import { uniqueTestIp } from "./support/testIp";
import { sql } from "./support/db";

/**
 * Internationalisation: the interface follows the reader, the story keeps
 * its own language, and the two are linked.
 *
 * The Nepali article is inserted directly, owned by the e2e fixture
 * account so the next run's cleanup removes it.
 */
function seedPair(stamp: number) {
  const enSlug = `i18n-original-${stamp}`;
  const neSlug = `i18n-anuwad-${stamp}`;
  sql(
    `INSERT INTO \`Article\` (id, slug, title, dek, \`bodyJson\`, \`bodyHtml\`, status, locale, \`authorId\`, \`publishedAt\`, \`createdAt\`, \`updatedAt\`)
     VALUES ('${enSlug}', '${enSlug}', 'Original story ${stamp}', 'An original in English.', '{}', '<p>Body.</p>', 'PUBLISHED', 'en',
             (SELECT id FROM \`User\` WHERE email = 'e2e-fixture@example.com'), NOW(3), NOW(3), NOW(3));`
  );
  sql(
    `INSERT INTO \`Article\` (id, slug, title, dek, \`bodyJson\`, \`bodyHtml\`, status, locale, \`authorId\`, \`translationOfId\`, \`publishedAt\`, \`createdAt\`, \`updatedAt\`)
     VALUES ('${neSlug}', '${neSlug}', 'अनूदित समाचार ${stamp}', 'नेपालीमा एउटा अनुवाद।', '{}', '<p>मुख्य भाग।</p>', 'PUBLISHED', 'ne',
             (SELECT id FROM \`User\` WHERE email = 'e2e-fixture@example.com'), '${enSlug}', NOW(3), NOW(3), NOW(3));`
  );
  return { enSlug, neSlug };
}

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestIp() });
});

test.describe("Internationalisation", () => {
  test("English by default, with the language declared and the switcher offering Nepali", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.headers()["content-language"]).toBe("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("contentinfo").getByRole("button", { name: "नेपाली" })).toBeVisible();
  });

  test("the browser's Accept-Language picks Nepali without any cookie", async ({ browser }) => {
    const context = await browser.newContext({ locale: "ne-NP", extraHTTPHeaders: { "accept-language": "ne-NP,ne;q=0.9,en;q=0.5" } });
    const page = await context.newPage();
    const response = await page.goto("/");
    expect(response?.headers()["content-language"]).toBe("ne");
    await expect(page.locator("html")).toHaveAttribute("lang", "ne");
    await expect(page.getByRole("link", { name: "ताजा" }).first()).toBeVisible();
    await context.close();
  });

  test("the switcher changes the interface, remembers the choice, and works without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/search");
    await expect(page.getByRole("heading", { name: "Search", level: 1 })).toBeVisible();

    await page.getByRole("contentinfo").getByRole("button", { name: "नेपाली" }).click();
    // Sent back to the page they were on, now in Nepali.
    await expect(page).toHaveURL(/\/search$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "ne");
    await expect(page.getByRole("heading", { name: "खोज", level: 1 })).toBeVisible();

    // The choice survives a fresh navigation, and the cookie carries only
    // the two-letter code.
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "लग इन", level: 1 })).toBeVisible();
    const cookie = (await context.cookies()).find((c) => c.name === "locale");
    expect(cookie?.value).toBe("ne");

    // And back again — from a page with a footer; the sign-in shell has none.
    await page.goto("/");
    await page.getByRole("contentinfo").getByRole("button", { name: "English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await context.close();
  });

  test("a story marks its own language and links to its translation, both ways", async ({ page }) => {
    const stamp = Date.now();
    const { enSlug, neSlug } = seedPair(stamp);

    // An English reader on the Nepali version is told so and offered English.
    await page.goto(`/article/${neSlug}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveAttribute("lang", "ne");
    await expect(page.getByText("This story is in नेपाली.")).toBeVisible();
    const toEnglish = page.getByRole("link", { name: "English", exact: true });
    await expect(toEnglish).toHaveAttribute("href", `/article/${enSlug}`);
    await expect(toEnglish).toHaveAttribute("hreflang", "en");
    // hreflang alternates in the head, for search engines.
    await expect(page.locator('link[rel="alternate"][hreflang="ne"]')).toHaveAttribute("href", new RegExp(`/article/${neSlug}$`));
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute("href", new RegExp(`/article/${enSlug}$`));

    // The original links back to the translation.
    await page.goto(`/article/${enSlug}`);
    await expect(page.getByRole("link", { name: "नेपाली", exact: true }).first()).toHaveAttribute("href", `/article/${neSlug}`);
    // Its headline is in the reader's language, so no lang override.
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveAttribute("lang", /.+/);
  });

  test("the sitemap pairs the two versions with hreflang alternates", async ({ request }) => {
    const stamp = Date.now();
    const { enSlug, neSlug } = seedPair(stamp);
    const xml = await (await request.get("/sitemap.xml")).text();
    const at = xml.indexOf(`/article/${enSlug}</loc>`);
    const entry = xml.slice(Math.max(0, at - 200), at + 600);
    expect(entry).toContain(`hreflang="ne"`);
    expect(entry).toContain(`/article/${neSlug}`);
  });

  test("the legal pages say they are English-only to a Nepali reader", async ({ browser }) => {
    // locale as well as the header: Chromium derives its own
    // Accept-Language from the context locale and would otherwise send
    // English regardless of the extra header.
    const context = await browser.newContext({ locale: "ne-NP", extraHTTPHeaders: { "accept-language": "ne" } });
    const page = await context.newPage();
    await page.goto("/privacy");
    await expect(page.getByRole("note")).toContainText("अङ्ग्रेजीमा मात्र उपलब्ध छ");
    await context.close();
  });
});
