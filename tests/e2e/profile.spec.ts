import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { uniqueTestIp } from "./support/testIp";
import { scalar, sql } from "./support/db";
import { finishLogin } from "./support/staff";

const PASSWORD = "correct-horse-battery-staple";
const SMS_OUTBOX = join(process.cwd(), ".sms-dev-outbox.log");
const EMAIL_OUTBOX = join(process.cwd(), ".email-dev-outbox.log");

/**
 * Profile settings and anonymous posting.
 *
 * Phone and email verification read their codes and links from the
 * local outboxes (src/lib/sms.ts, src/lib/email.ts), which is what makes
 * both flows testable before a Twilio or Resend account exists.
 */
function latestSmsTo(phone: string): string {
  if (!existsSync(SMS_OUTBOX)) throw new Error("no SMS outbox — is TWILIO_* set? The suite needs the local fallback.");
  const lines = readFileSync(SMS_OUTBOX, "utf-8").trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const entry = JSON.parse(lines[i]!) as { to: string; body: string };
    if (entry.to === phone) return entry.body;
  }
  throw new Error(`no SMS to ${phone}`);
}

function latestEmailLinkTo(email: string): string {
  const lines = readFileSync(EMAIL_OUTBOX, "utf-8").trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const entry = JSON.parse(lines[i]!) as { to: string; html: string };
    if (entry.to === email) {
      const m = entry.html.match(/href="([^"]+)"/);
      if (m) return m[1]!.replace(/&amp;/g, "&");
    }
  }
  throw new Error(`no email to ${email}`);
}

const markEmailVerified = (email: string) =>
  sql(`UPDATE \`User\` SET \`emailVerifiedAt\` = NOW() WHERE email = '${email}';`);

/** Approved comments make an account trusted, so its posts go live at once. */
const grantCommentTrust = (email: string) =>
  sql(
    `INSERT INTO \`Comment\` (id, \`articleId\`, \`userId\`, body, status, \`createdAt\`, \`updatedAt\`)
     SELECT CONCAT('trust-', UUID()), 'e2e-trust-ballast',
            (SELECT id FROM \`User\` WHERE email = '${email}'),
            CONCAT('Established account warm-up ', n), 'APPROVED', NOW(3), NOW(3)
     FROM (SELECT 1 AS n UNION SELECT 2 UNION SELECT 3) AS warmups;`
  );

function seedArticle(stamp: number): string {
  const slug = `profile-story-${stamp}`;
  sql(
    `INSERT INTO \`Article\` (id, slug, title, dek, \`bodyJson\`, \`bodyHtml\`, status, locale, \`authorId\`, \`publishedAt\`, \`createdAt\`, \`updatedAt\`)
     VALUES ('${slug}', '${slug}', 'Profile Story ${stamp}', 'For the profile tests.', '{}', '<p>Body.</p>', 'PUBLISHED', 'en',
             (SELECT id FROM \`User\` WHERE email = 'e2e-fixture@example.com'), NOW(3), NOW(3), NOW(3));`
  );
  return slug;
}

async function registerAndLogin(page: Page, email: string, handle: string, name = "Profile Reader") {
  await page.goto("/register");
  await page.fill('input[name="name"]', name);
  await page.fill('input[name="handle"]', handle);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.check('input[name="consent"]');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/login/);
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await finishLogin(page);
}

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestIp() });
});

test.describe("Anonymous comments", () => {
  test("readers see “Anonymous”, the author still sees “You”, and moderators see who wrote it", async ({ page, browser }) => {
    test.slow();
    const stamp = Date.now();
    const slug = seedArticle(stamp);
    const email = `anon+${stamp}@example.com`;
    await registerAndLogin(page, email, `anon${stamp.toString(36)}`, "Rowan Hale");
    markEmailVerified(email);
    grantCommentTrust(email);

    const body = `Posted without my name ${stamp}`;
    await page.goto(`/article/${slug}`, { waitUntil: "networkidle" });
    await page.getByPlaceholder("Join the discussion…").fill(body);
    await page.getByLabel(/Post anonymously/).check();
    await page.getByRole("button", { name: "Post comment" }).click();

    // The author sees their own comment, marked as theirs, with no name.
    const mine = page.locator("li", { has: page.locator("[data-comment-body]", { hasText: body }) }).first();
    await expect(mine.getByText("Anonymous").first()).toBeVisible();
    await expect(mine.getByText("You", { exact: true })).toBeVisible();
    await expect(mine.getByText("Rowan Hale")).toHaveCount(0);

    // Stored against the account, flagged anonymous.
    expect(
      scalar(
        `SELECT CONCAT(anonymous, '|', (SELECT email FROM \`User\` u WHERE u.id = c.\`userId\`))
         FROM \`Comment\` c WHERE body = '${body}';`
      )
    ).toBe(`1|${email}`);

    // A stranger sees "Anonymous" and never the name.
    const other = await browser.newContext();
    const reader = await other.newPage();
    await reader.goto(`/article/${slug}`);
    const theirs = reader.locator("li", { has: reader.locator("[data-comment-body]", { hasText: body }) }).first();
    await expect(theirs.getByText("Anonymous").first()).toBeVisible();
    await expect(reader.getByText("Rowan Hale")).toHaveCount(0);
    await other.close();

    // The data export records the flag, so the person can see it too.
    const exported = await page.request.get("/account/data");
    const data = (await exported.json()) as { comments: { body: string; anonymous: boolean }[] };
    expect(data.comments.find((c) => c.body === body)?.anonymous).toBe(true);
  });
});

test.describe("Contact details", () => {
  test("a phone number is verified by a code from the SMS outbox, stored encrypted, and removable", async ({ page }) => {
    test.slow();
    const stamp = Date.now();
    const email = `phone+${stamp}@example.com`;
    await registerAndLogin(page, email, `phone${stamp.toString(36)}`);
    // Unique per run, and a reserved-looking range so a real message is
    // never at stake if the outbox fallback were ever misconfigured.
    const phone = `+15005550${String(stamp).slice(-3)}`;

    await page.goto("/account/settings");
    await expect(page.locator("[data-phone-status]")).toHaveAttribute("data-phone-status", "none");
    await page.getByRole("button", { name: "Add a phone number" }).click();
    await page.getByLabel("Phone number").fill(phone);
    await page.getByRole("button", { name: "Send code" }).click();
    await expect(page.getByText(/We sent a six-digit code/)).toBeVisible();

    // Nothing readable in the database: not the number, not the code.
    const stored = scalar(
      `SELECT CONCAT(IFNULL(\`phoneEncrypted\`,''), '|', IFNULL(\`phoneHash\`,''), '|', IFNULL(\`phoneCodeHash\`,''))
       FROM \`User\` WHERE email = '${email}';`
    );
    expect(stored).not.toContain(phone.slice(1));
    const [encrypted, hash, codeHash] = stored.split("|");
    expect(encrypted!.length).toBeGreaterThan(20);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(codeHash).toMatch(/^[0-9a-f]{64}$/);

    // A wrong code is refused; the right one, read from the outbox, is not.
    await page.getByLabel("Enter the code").fill("000000");
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(page.getByText("That code didn't match.")).toBeVisible();

    const code = latestSmsTo(phone).match(/\b(\d{6})\b/)![1]!;
    expect(code).not.toBe(codeHash!.slice(0, 6));
    await page.getByLabel("Enter the code").fill(code);
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(page.getByText("Phone number verified.")).toBeVisible();
    await expect(page.locator("[data-phone-status]")).toHaveAttribute("data-phone-status", "verified");
    // Masked on the page: country code and last three digits only.
    await expect(page.locator("[data-phone-status]")).toContainText(phone.slice(-3));
    await expect(page.locator("[data-phone-status]")).not.toContainText(phone.slice(2, 8));

    // The export gives the owner the real number; the audit log has the event.
    const data = (await (await page.request.get("/account/data")).json()) as { account: { phone: string } };
    expect(data.account.phone).toBe(phone);
    expect(
      scalar(
        `SELECT count(*) FROM \`AuditLog\` WHERE action = 'account.phone.verified'
         AND \`actorId\` = (SELECT id FROM \`User\` WHERE email = '${email}');`
      )
    ).toBe("1");

    // The same number cannot be claimed by a second account.
    await page.context().clearCookies();
    const other = `phone2+${stamp}@example.com`;
    await registerAndLogin(page, other, `phoneb${stamp.toString(36)}`);
    await page.goto("/account/settings");
    await page.getByRole("button", { name: "Add a phone number" }).click();
    await page.getByLabel("Phone number").fill(phone);
    await page.getByRole("button", { name: "Send code" }).click();
    await expect(page.getByText(/already verified on another account/)).toBeVisible();
  });

  test("changing the email address needs the password and a link opened from the new inbox", async ({ page }) => {
    test.slow();
    const stamp = Date.now();
    const email = `mail+${stamp}@example.com`;
    const newEmail = `mail-new+${stamp}@example.com`;
    await registerAndLogin(page, email, `mail${stamp.toString(36)}`);

    await page.goto("/account/settings");
    await page.getByRole("button", { name: "Change", exact: true }).click();
    await page.getByLabel("New email address").fill(newEmail);
    await page.getByLabel(/Your password, to confirm/).fill("wrong-password-here");
    await page.getByRole("button", { name: "Send confirmation link" }).click();
    await expect(page.getByText("Incorrect password.")).toBeVisible();

    await page.getByLabel(/Your password, to confirm/).fill(PASSWORD);
    await page.getByRole("button", { name: "Send confirmation link" }).click();
    await expect(page.getByText(new RegExp(`A link is on its way to ${newEmail.replace("+", "\\+")}`))).toBeVisible();

    // Nothing has changed yet.
    expect(scalar(`SELECT email FROM \`User\` WHERE \`pendingEmail\` = '${newEmail}';`)).toBe(email);

    // Opening the link from the new inbox completes it.
    await page.goto(latestEmailLinkTo(newEmail));
    await page.getByRole("button", { name: "Confirm my email" }).click();
    await expect(page.getByRole("heading", { name: "Email verified" })).toBeVisible();
    expect(scalar(`SELECT CONCAT(email, '|', IFNULL(\`pendingEmail\`, '')) FROM \`User\` WHERE email = '${newEmail}';`)).toBe(`${newEmail}|`);

    // And the old address no longer signs in; the new one does.
    await page.context().clearCookies();
    await page.goto("/login", { waitUntil: "networkidle" });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
    await page.fill('input[name="email"]', newEmail);
    await page.click('button[type="submit"]');
    await finishLogin(page);
  });
});
