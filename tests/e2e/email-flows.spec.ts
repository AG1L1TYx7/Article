import { test, expect, type Page } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { uniqueTestIp } from "./support/testIp";
import { sql } from "./support/db";
import { answerMfaIfPrompted, mfaColumnsSql } from "./support/staff";

// The dashboard (where the verification banner lives) is staff-only — see
// proxy.ts — so exercising it needs a MODERATOR, not a plain reader.
function promoteToModerator(email: string) {
  sql(`UPDATE \`User\` SET role = 'MODERATOR', ${mfaColumnsSql()} WHERE email = '${email}';`);
}

// Exercises verify-email and password-reset end to end against the dev
// email outbox (see src/lib/email.ts) — this only works because
// RESEND_API_KEY is unset in .env, which routes sent emails to
// .email-dev-outbox.log instead of a real inbox. If that env var is ever
// set for local dev, these tests need a real test-inbox provider instead.
const OUTBOX_PATH = join(process.cwd(), ".email-dev-outbox.log");
const PASSWORD = "correct-horse-battery-staple";

interface OutboxEntry {
  to: string;
  subject: string;
  html: string;
  sentAt: string;
}

function latestEmailTo(email: string): OutboxEntry {
  if (!existsSync(OUTBOX_PATH)) throw new Error(`Outbox file not found at ${OUTBOX_PATH}`);
  const lines = readFileSync(OUTBOX_PATH, "utf-8").trim().split("\n");
  const entries: OutboxEntry[] = lines.map((l) => JSON.parse(l));
  const matches = entries.filter((e) => e.to === email);
  const last = matches.at(-1);
  if (!last) throw new Error(`No email found for ${email}`);
  return last;
}

function extractLink(html: string): string {
  const match = html.match(/href="([^"]+)"/);
  if (!match) throw new Error(`No link found in email HTML: ${html}`);
  return match[1]!;
}

async function register(page: Page, email: string, handle: string) {
  await page.goto("/register");
  await page.fill('input[name="name"]', "Test User");
  await page.fill('input[name="handle"]', handle);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.check('input[name="consent"]');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/login/);
}

// Each test gets its own synthetic source IP so the real rate limiters
// (keyed per IP — see src/lib/rateLimit.ts) don't let one test's
// registrations exhaust another test's budget when the suite runs from a
// single machine.
test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestIp() });
});

async function login(page: Page, email: string, password = PASSWORD) {
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await answerMfaIfPrompted(page);
}

test.describe("Email verification", () => {
  test("registration sends a working verification link", async ({ page }) => {
    const email = `verify+${Date.now()}@example.com`;
    await register(page, email, `verify${Date.now()}`);

    const link = extractLink(latestEmailTo(email).html);

    // Merely loading the link must NOT verify: these tokens are single use
    // and mail scanners/unfurlers fetch links before humans do. The token
    // is only spent when the button is pressed.
    await page.goto(link);
    await expect(page.getByRole("heading", { name: "Confirm your email" })).toBeVisible();

    await page.getByRole("button", { name: "Confirm my email" }).click();
    await expect(page.getByRole("heading", { name: "Email verified" })).toBeVisible();

    // Pressing again on a fresh load of the same (now-consumed) link must
    // not re-verify — single use, per src/lib/auth/tokens.ts.
    await page.goto(link);
    await page.getByRole("button", { name: "Confirm my email" }).click();
    await expect(page.getByRole("heading", { name: "Link expired or invalid" })).toBeVisible();
  });

  test("unverified users see a resend banner on the dashboard; verified users don't", async ({ page }) => {
    const email = `unverified+${Date.now()}@example.com`;
    await register(page, email, `unverified${Date.now()}`);
    promoteToModerator(email);
    await login(page, email);
    await page.waitForURL(/\/dashboard/);

    await expect(page.getByText("Your email address isn't verified yet.")).toBeVisible();

    await page.getByRole("button", { name: "Resend" }).click();
    await expect(page.getByText("Check your inbox for a new verification link.")).toBeVisible();

    const link = extractLink(latestEmailTo(email).html);
    await page.goto(link);
    await page.getByRole("button", { name: "Confirm my email" }).click();
    await expect(page.getByRole("heading", { name: "Email verified" })).toBeVisible();

    await page.goto("/dashboard");
    await expect(page.getByText("Your email address isn't verified yet.")).not.toBeVisible();
  });
});

test.describe("Password reset", () => {
  test("forgot-password gives the same response for existing and non-existent emails", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.fill('input[name="email"]', "definitely-not-registered@example.com");
    await page.click('button[type="submit"]');
    await expect(page.getByText(/reset link is on its way/)).toBeVisible();
  });

  test("a reset link lets the user set a new password, and the old one stops working", async ({ page }) => {
    const email = `reset+${Date.now()}@example.com`;
    await register(page, email, `reset${Date.now()}`);

    await page.goto("/forgot-password");
    await page.fill('input[name="email"]', email);
    await page.click('button[type="submit"]');
    await expect(page.getByText(/reset link is on its way/)).toBeVisible();

    const link = extractLink(latestEmailTo(email).html);
    await page.goto(link);
    const newPassword = "a-completely-different-passphrase";
    await page.fill('input[name="password"]', newPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/login\?reset=1/);

    // Old password must no longer work.
    await login(page, email, PASSWORD);
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();

    // New password works.
    await page.goto("/login");
    await login(page, email, newPassword);
    await page.waitForURL((u) => u.pathname !== "/login");
  });

  test("resetting a password invalidates sessions already open elsewhere", async ({ browser }) => {
    // Regression test for a real bug: proxy.ts used to run against a
    // Prisma-free "edge-safe" auth config (built on the assumption that
    // Next.js middleware runs on the Edge runtime), which only decoded a
    // session's existing JWT claims and never re-checked sessionVersion
    // against the database. A revoked READER session survived because
    // proxy.ts bounces non-staff away from /dashboard on role alone,
    // before ever reaching a Node-runtime handler that would have caught
    // it. Fixed by collapsing proxy.ts onto the one real auth() config
    // (this Next.js version defaults Proxy to the Node.js runtime, so the
    // split wasn't needed in the first place) — deliberately using a
    // plain READER here, not a MODERATOR, to prove the fix at the role
    // proxy.ts itself rejects, not just the one it lets through.
    const email = `reset-revoke+${Date.now()}@example.com`;
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await pageA.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestIp() });
    await register(pageA, email, `resetrevoke${Date.now()}`);
    await login(pageA, email);
    await pageA.waitForURL((u) => u.pathname !== "/login");

    // Reset the password from a second, unauthenticated context — like the
    // user doing this from a different device after losing their session.
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await pageB.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestIp() });
    await pageB.goto("/forgot-password");
    await pageB.fill('input[name="email"]', email);
    await pageB.click('button[type="submit"]');
    await expect(pageB.getByText(/reset link is on its way/)).toBeVisible();
    const link = extractLink(latestEmailTo(email).html);
    await pageB.goto(link);
    await pageB.fill('input[name="password"]', "yet-another-new-passphrase");
    await pageB.click('button[type="submit"]');
    await pageB.waitForURL(/\/login\?reset=1/);

    // The original, still-cookied session must now be rejected.
    await pageA.goto("/dashboard");
    await expect(pageA).toHaveURL(/\/login/);

    await contextA.close();
    await contextB.close();
  });
});
