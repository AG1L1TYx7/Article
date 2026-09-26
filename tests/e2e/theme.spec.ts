import { test, expect } from "@playwright/test";
import { uniqueTestIp } from "./support/testIp";

/**
 * Light and dark: follows the device by default, and a reader's choice
 * overrides it in both directions, survives a reload, and is applied
 * before any script runs.
 */
const PAPER_LIGHT = "rgb(250, 250, 247)";
const PAPER_DARK = "rgb(17, 20, 24)";

const bodyBackground = (page: import("@playwright/test").Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestIp() });
});

test.describe("Theme", () => {
  test("follows the operating system until the reader chooses", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);
    expect(await bodyBackground(page)).toBe(PAPER_LIGHT);

    await page.emulateMedia({ colorScheme: "dark" });
    expect(await bodyBackground(page)).toBe(PAPER_DARK);
  });

  test("the toggle applies at once, is remembered, and beats the system in both directions", async ({ page, context }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/", { waitUntil: "networkidle" });

    // Every toggle on the page is one control: choosing in the masthead
    // updates the footer's copy too.
    const masthead = page.getByRole("banner").getByRole("radiogroup", { name: "Theme" });
    const footer = page.getByRole("contentinfo").getByRole("radiogroup", { name: "Theme" });
    await expect(masthead.getByRole("radio", { name: "System" })).toBeChecked();

    await masthead.getByRole("radio", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await bodyBackground(page)).toBe(PAPER_DARK);
    await expect(footer.getByRole("radio", { name: "Dark" })).toBeChecked();
    await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute("content", "#111418");

    // Stored, so the next page paints dark from the server with no script.
    await expect.poll(async () => (await context.cookies()).find((c) => c.name === "theme")?.value).toBe("dark");
    await page.goto("/search");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await bodyBackground(page)).toBe(PAPER_DARK);

    // A forced light theme wins over a dark system.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.getByRole("contentinfo").getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: "Light" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await bodyBackground(page)).toBe(PAPER_LIGHT);
    await expect.poll(async () => (await context.cookies()).find((c) => c.name === "theme")?.value).toBe("light");

    // Back to the system, which is dark here, and the cookie goes.
    await page.getByRole("contentinfo").getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: "System" }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);
    expect(await bodyBackground(page)).toBe(PAPER_DARK);
    await expect.poll(async () => (await context.cookies()).find((c) => c.name === "theme")).toBeUndefined();
  });

  test("works without JavaScript, returning to the same page", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: "light" });
    const page = await context.newPage();
    await page.goto("/search");
    await page.getByRole("contentinfo").getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: "Dark" }).click();
    await expect(page).toHaveURL(/\/search$/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await bodyBackground(page)).toBe(PAPER_DARK);
    await context.close();
  });

  test("the choice is translated with the rest of the interface", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("contentinfo").getByRole("button", { name: "नेपाली" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ne");
    const toggle = page.getByRole("contentinfo").getByRole("radiogroup", { name: "थिम" });
    await expect(toggle.getByRole("radio", { name: "अँध्यारो" })).toBeVisible();
    // And the language switch is now in the masthead too, back to English.
    await expect(page.getByRole("banner").getByRole("button", { name: "English" })).toBeVisible();
  });
});
