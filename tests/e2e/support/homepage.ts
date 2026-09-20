import { expect, type Page } from "@playwright/test";

/**
 * Waits for a freshly published article to appear on the homepage.
 *
 * The homepage is statically rendered and publishing revalidates it, but
 * the very next request can still be served the previous version. A plain
 * goto-then-assert races that window — the longest-standing source of
 * flakiness in this suite. Reloading until the headline is there tests the
 * same behaviour without depending on revalidation landing within one
 * request.
 */
export async function waitForOnHomepage(page: Page, title: string) {
  await expect(async () => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: title })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
}
