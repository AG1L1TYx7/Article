import { test, expect } from "@playwright/test";
import { uniqueTestIp } from "./support/testIp";
import { sql } from "./support/db";

/**
 * Internationalisation: the interface follows the reader, the story keeps
 * its own language, and the two are linked.
 *
 * The Spanish article is inserted directly, owned by the e2e fixture
 * account so the next run's cleanup removes it.
 */
function seedPair(stamp: number) {
  const enSlug = `i18n-original-${stamp}`;
  const esSlug = `i18n-traduccion-${stamp}`;
  sql(
    `INSERT INTO \`Article\` (id, slug, title, dek, \`bodyJson\`, \`bodyHtml\`, status, locale, \`authorId\`, \`publishedAt\`, \`createdAt\`, \`updatedAt\`)
     VALUES ('${enSlug}', '${enSlug}', 'Original story ${stamp}', 'An original in English.', '{}', '<p>Body.</p>', 'PUBLISHED', 'en',
             (SELECT id FROM \`User\` WHERE email = 'e2e-fixture@example.com'), NOW(3), NOW(3), NOW(3));`
  );
  sql(
    `INSERT INTO \`Article\` (id, slug, title, dek, \`bodyJson\`, \`bodyHtml\`, status, locale, \`authorId\`, \`translationOfId\`, \`publishedAt\`, \`createdAt\`, \`updatedAt\`)
     VALUES ('${esSlug}', '${esSlug}', 'Noticia traducida ${stamp}', 'Una traducción al español.', '{}', '<p>Cuerpo.</p>', 'PUBLISHED', 'es',
             (SELECT id FROM \`User\` WHERE email = 'e2e-fixture@example.com'), '${enSlug}', NOW(3), NOW(3), NOW(3));`
  );
  return { enSlug, esSlug };
}

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestIp() });
});

test.describe("Internationalisation", () => {
  test("English by default, with the language declared and the switcher offering Spanish", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.headers()["content-language"]).toBe("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("contentinfo").getByRole("button", { name: "Español" })).toBeVisible();
  });

  test("the browser's Accept-Language picks Spanish without any cookie", async ({ browser }) => {
    const context = await browser.newContext({ locale: "es-ES", extraHTTPHeaders: { "accept-language": "es-ES,es;q=0.9,en;q=0.5" } });
    const page = await context.newPage();
    const response = await page.goto("/");
    expect(response?.headers()["content-language"]).toBe("es");
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    await expect(page.getByRole("link", { name: "Última hora" }).first()).toBeVisible();
    await context.close();
  });

  test("the switcher changes the interface, remembers the choice, and works without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/search");
    await expect(page.getByRole("heading", { name: "Search", level: 1 })).toBeVisible();

    await page.getByRole("contentinfo").getByRole("button", { name: "Español" }).click();
    // Sent back to the page they were on, now in Spanish.
    await expect(page).toHaveURL(/\/search$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    await expect(page.getByRole("heading", { name: "Buscar", level: 1 })).toBeVisible();

    // The choice survives a fresh navigation, and the cookie carries only
    // the two-letter code.
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Iniciar sesión", level: 1 })).toBeVisible();
    const cookie = (await context.cookies()).find((c) => c.name === "locale");
    expect(cookie?.value).toBe("es");

    // And back again — from a page with a footer; the sign-in shell has none.
    await page.goto("/");
    await page.getByRole("contentinfo").getByRole("button", { name: "English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await context.close();
  });

  test("a story marks its own language and links to its translation, both ways", async ({ page }) => {
    const stamp = Date.now();
    const { enSlug, esSlug } = seedPair(stamp);

    // An English reader on the Spanish version is told so and offered English.
    await page.goto(`/article/${esSlug}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveAttribute("lang", "es");
    await expect(page.getByText("This story is in Español.")).toBeVisible();
    const toEnglish = page.getByRole("link", { name: "English", exact: true });
    await expect(toEnglish).toHaveAttribute("href", `/article/${enSlug}`);
    await expect(toEnglish).toHaveAttribute("hreflang", "en");
    // hreflang alternates in the head, for search engines.
    await expect(page.locator('link[rel="alternate"][hreflang="es"]')).toHaveAttribute("href", new RegExp(`/article/${esSlug}$`));
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute("href", new RegExp(`/article/${enSlug}$`));

    // The original links back to the translation.
    await page.goto(`/article/${enSlug}`);
    await expect(page.getByRole("link", { name: "Español", exact: true }).first()).toHaveAttribute("href", `/article/${esSlug}`);
    // Its headline is in the reader's language, so no lang override.
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveAttribute("lang", /.+/);
  });

  test("the sitemap pairs the two versions with hreflang alternates", async ({ request }) => {
    const stamp = Date.now();
    const { enSlug, esSlug } = seedPair(stamp);
    const xml = await (await request.get("/sitemap.xml")).text();
    const at = xml.indexOf(`/article/${enSlug}</loc>`);
    const entry = xml.slice(Math.max(0, at - 200), at + 600);
    expect(entry).toContain(`hreflang="es"`);
    expect(entry).toContain(`/article/${esSlug}`);
  });

  test("the legal pages say they are English-only to a Spanish reader", async ({ browser }) => {
    // locale as well as the header: Chromium derives its own
    // Accept-Language from the context locale and would otherwise send
    // English regardless of the extra header.
    const context = await browser.newContext({ locale: "es-ES", extraHTTPHeaders: { "accept-language": "es" } });
    const page = await context.newPage();
    await page.goto("/privacy");
    await expect(page.getByRole("note")).toContainText("solo está disponible en inglés");
    await context.close();
  });
});
