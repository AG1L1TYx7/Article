import { expect, type Page } from "@playwright/test";

/**
 * Waits until a toggle control is actually interactive.
 *
 * Playwright will happily click server-rendered markup before React has
 * hydrated, in which case the handler never runs and nothing is sent.
 * That is the single biggest source of flakiness in this suite, and it
 * only shows up under parallel load, when hydration is slow enough to
 * lose the race.
 *
 * ToggleButton sets data-hydrated in an effect, which only runs on the
 * client, so it is a direct signal that this specific control is live —
 * rather than a sleep, which would be a guess.
 */
export async function waitForHydration(page: Page, name: string | RegExp) {
  await expect(
    page.getByRole("button", { name, exact: typeof name === "string" })
  ).toHaveAttribute("data-hydrated", "true", { timeout: 15000 });
}
