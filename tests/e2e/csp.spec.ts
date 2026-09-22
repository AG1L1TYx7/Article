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

/**
 * Collects anything the browser refused to load or run.
 *
 * A CSP failure is not an exception — the page still renders, it just
 * silently does nothing. Watching the console is the only way to see it,
 * which is exactly why this needs a test rather than a look.
 */
function watchForViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && /Content Security Policy|Refused to/i.test(text)) {
      violations.push(text);
    }
  });
  return violations;
}

async function signInAsModerator(page: Page) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `csp+${stamp}@example.com`;

  await page.goto("/register");
  await page.fill('input[name="name"]', "CSP Test Author");
  await page.fill('input[name="handle"]', `csp${stamp}`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.check('input[name="consent"]');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/login/);

  promoteTo("MODERATOR", email);
  markEmailVerified(email);

  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await finishLogin(page);
}

test.describe("Content Security Policy", () => {
  test("every response carries a policy, with a fresh nonce each time", async ({ page }) => {
    const first = await page.goto("/");
    const firstCsp = first?.headers()["content-security-policy"] ?? "";

    expect(firstCsp).toContain("default-src 'self'");
    expect(firstCsp).toContain("'strict-dynamic'");
    expect(firstCsp).toContain("object-src 'none'");
    expect(firstCsp).toContain("base-uri 'none'");
    expect(firstCsp).toContain("frame-ancestors 'none'");
    expect(firstCsp).toContain("form-action 'self'");

    const second = await page.goto("/login");
    const secondCsp = second?.headers()["content-security-policy"] ?? "";

    // A reused nonce is a guessable nonce, which is no nonce at all.
    const nonceOf = (csp: string) => /'nonce-([a-f0-9]+)'/.exec(csp)?.[1];
    expect(nonceOf(firstCsp)).toBeTruthy();
    expect(nonceOf(secondCsp)).toBeTruthy();
    expect(nonceOf(firstCsp)).not.toBe(nonceOf(secondCsp));
  });

  test("the public pages load with nothing blocked", async ({ page }) => {
    // The failure this catches is total and silent: with the policy but
    // without a nonce on the scripts, these pages render and then no
    // JavaScript runs at all. That is what happened the first time this
    // was switched on, because the pages were still statically rendered.
    const violations = watchForViolations(page);

    for (const path of ["/", "/login", "/register", "/search?q=test"]) {
      violations.length = 0;
      await page.goto(path, { waitUntil: "networkidle" });
      expect(violations, `${path} blocked: ${violations[0] ?? ""}`).toHaveLength(0);
    }
  });

  test("an article page and its comment box load with nothing blocked", async ({ page }) => {
    const violations = watchForViolations(page);

    const title = `CSP Article ${Date.now()}`;
    await signInAsModerator(page);
    await page.goto("/dashboard/articles/new");
    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.locator('[contenteditable="true"]').click();
    await page.keyboard.type("Body for the CSP test.");
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.waitForURL("/dashboard/articles");
    await page.locator("tr", { hasText: title }).getByRole("button", { name: "Publish" }).click();
    await page.waitForLoadState("networkidle");

    violations.length = 0;
    await page.goto(`/article/${articleSlug(title)}`, { waitUntil: "networkidle" });
    expect(violations, violations[0] ?? "").toHaveLength(0);
    // The article body renders through the one dangerouslySetInnerHTML in
    // the codebase — the exact place this policy exists to backstop.
    await expect(page.getByText("Body for the CSP test.")).toBeVisible();
  });

  test("the editor works under the policy", async ({ page }) => {
    // The riskiest page: a rich text editor doing contenteditable work.
    // If anything were going to need eval or an inline handler, it is this.
    const violations = watchForViolations(page);
    await signInAsModerator(page);

    violations.length = 0;
    await page.goto("/dashboard/articles/new", { waitUntil: "networkidle" });
    expect(violations, violations[0] ?? "").toHaveLength(0);

    // Not just present — actually interactive, which needs hydration.
    await page.locator('[contenteditable="true"]').click();
    await page.keyboard.type("Typing proves the editor hydrated.");
    await expect(page.locator('[contenteditable="true"]')).toContainText(
      "Typing proves the editor hydrated."
    );
    expect(violations, violations[0] ?? "").toHaveLength(0);
  });

  test("interactive controls still work, so hydration really happened", async ({ page }) => {
    // A blocked bundle leaves a page that looks right and does nothing.
    // Clicking something that needs JavaScript is the honest check.
    const violations = watchForViolations(page);

    await page.goto("/search?q=test", { waitUntil: "networkidle" });
    // Scoped to the page form: the masthead has a search box with the
    // same label.
    await page.getByRole("main").getByLabel("Search articles").fill("budget");
    await page.getByRole("button", { name: "Search" }).click();
    await page.waitForURL(/q=budget/);

    expect(violations, violations[0] ?? "").toHaveLength(0);
  });
});
