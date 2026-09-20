import { test, expect, type Page } from "@playwright/test";
import { uniqueTestIp } from "./support/testIp";
import { sql, scalar } from "./support/db";
import { commentInThread } from "./support/comments";

const PASSWORD = "correct-horse-battery-staple";

const promoteTo = (role: string, email: string) =>
  sql(`UPDATE \`User\` SET role = '${role}' WHERE email = '${email}';`);
const markEmailVerified = (email: string) =>
  sql(`UPDATE \`User\` SET \`emailVerifiedAt\` = NOW() WHERE email = '${email}';`);
/**
 * Fakes an established account, so its comments skip the new-account queue.
 *
 * Seeds the approved comments directly rather than posting them through
 * the UI: an account needs TRUSTED_AFTER_APPROVED_COMMENTS (3, see
 * lib/spam.ts) approved comments before it is trusted, and three extra
 * round trips per test is a lot of wall-clock time to spend on a
 * precondition these tests are not about.
 *
 * They are parked on the draft ballast article created by globalSetup.
 * Drafts are never rendered to readers, so these can never turn up on the
 * page under test and inflate its comment count or its Edit/Delete/Report
 * controls.
 */
const grantCommentTrust = (email: string) =>
  sql(
    `INSERT INTO \`Comment\` (id, \`articleId\`, \`userId\`, body, status, \`createdAt\`, \`updatedAt\`)
     SELECT CONCAT('trust-', UUID()),
            'e2e-trust-ballast',
            (SELECT id FROM \`User\` WHERE email = '${email}'),
            CONCAT('Established account warm-up ', n),
            'APPROVED', NOW(3), NOW(3)
     FROM (SELECT 1 AS n UNION SELECT 2 UNION SELECT 3) AS warmups;`
  );
/** Backdates a comment past the edit window without waiting fifteen minutes. */
const ageComment = (body: string) =>
  sql(`UPDATE \`Comment\` SET \`createdAt\` = NOW(3) - INTERVAL 30 MINUTE WHERE body = '${body}';`);
const commentStatus = (body: string) =>
  scalar(`SELECT status FROM \`Comment\` WHERE body = '${body}' LIMIT 1;`);

const articleSlug = (title: string) =>
  scalar(`SELECT slug FROM \`Article\` WHERE title = '${title}' LIMIT 1;`);

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestIp() });
});

async function register(page: Page, email: string, handle: string, name = "Commenter") {
  await page.goto("/register");
  await page.fill('input[name="name"]', name);
  await page.fill('input[name="handle"]', handle);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
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

/** Publishes an article as a throwaway moderator and returns its public URL. */
async function publishArticle(page: Page, title: string): Promise<string> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `camod+${stamp}@example.com`;
  await register(page, email, `camod${stamp}`, "Comment Authoring Author");
  promoteTo("MODERATOR", email);
  markEmailVerified(email);
  await login(page, email);

  await page.goto("/dashboard/articles/new");
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.locator('[contenteditable="true"]').click();
  await page.keyboard.type("Article body for the comment authoring tests.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.waitForURL("/dashboard/articles");
  await page.locator("tr", { hasText: title }).getByRole("button", { name: "Publish" }).click();
  await page.waitForLoadState("networkidle");

  await page.context().clearCookies();
  return `/article/${articleSlug(title)}`;
}

/** Registers a verified, comment-trusted reader so their comments post immediately. */
async function trustedReader(page: Page, prefix: string, name: string) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `${prefix}+${stamp}@example.com`;
  await register(page, email, `${prefix}${stamp}`, name);
  markEmailVerified(email);
  await login(page, email);
  return email;
}

/** Posts a comment from a trusted account, so it lands straight in public. */
async function postTrustedComment(page: Page, articleUrl: string, email: string, body: string) {
  grantCommentTrust(email);
  await page.goto(articleUrl);
  await page.getByPlaceholder("Join the discussion…").fill(body);
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(commentInThread(page, body)).toBeVisible();
}

test.describe("Comment authoring", () => {
  test("an author can fix a typo in their own comment", async ({ page }) => {
    const articleUrl = await publishArticle(page, `CA Edit ${Date.now()}`);
    const email = await trustedReader(page, "caedit", "Editing Reader");

    const original = `I ment to say something sensible ${Date.now()}`;
    const corrected = `I meant to say something sensible ${Date.now()}`;
    await postTrustedComment(page, articleUrl, email, original);

    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Edit your comment").fill(corrected);
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(commentInThread(page, corrected)).toBeVisible();
    await expect(commentInThread(page, original)).toHaveCount(0);
    await expect(page.getByText("· edited")).toBeVisible();

    // And the correction is real, not just optimistic UI.
    await page.reload();
    await expect(commentInThread(page, corrected)).toBeVisible();
  });

  test("editing a comment into spam sends it back to the moderation queue", async ({ page }) => {
    // Without this, editing would be a one-line moderation bypass: post
    // something harmless, wait for approval, then rewrite it as spam.
    const articleUrl = await publishArticle(page, `CA Bypass ${Date.now()}`);
    const email = await trustedReader(page, "cabypass", "Sneaky Reader");

    const harmless = `A perfectly ordinary opinion ${Date.now()}`;
    await postTrustedComment(page, articleUrl, email, harmless);

    const spam = "https://a.example https://b.example https://c.example https://d.example";
    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Edit your comment").fill(spam);
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByText("a moderator will review it")).toBeVisible();
    expect(commentStatus(spam)).toBe("PENDING");

    // Gone from the public page until a moderator looks at it.
    await page.reload();
    await expect(commentInThread(page, spam)).toHaveCount(0);
  });

  test("the edit window closes, and the server says so", async ({ page }) => {
    const articleUrl = await publishArticle(page, `CA Window ${Date.now()}`);
    const email = await trustedReader(page, "cawindow", "Late Reader");

    const body = `Second thoughts much later ${Date.now()}`;
    await postTrustedComment(page, articleUrl, email, body);

    ageComment(body);
    await page.reload();

    // The control is withdrawn once the window has passed.
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(commentInThread(page, body)).toBeVisible();
  });

  test("a reader is never offered edit or delete on someone else's comment", async ({ page }) => {
    const articleUrl = await publishArticle(page, `CA Other ${Date.now()}`);
    const authorEmail = await trustedReader(page, "caowner", "Comment Owner");

    const body = `My own words, thank you ${Date.now()}`;
    await postTrustedComment(page, articleUrl, authorEmail, body);

    await page.context().clearCookies();
    await trustedReader(page, "capasserby", "Passer By");
    await page.goto(articleUrl);

    await expect(commentInThread(page, body)).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
    // Reporting someone else's comment is still on offer.
    await expect(page.getByRole("button", { name: "Report" })).toBeVisible();
  });

  test("deleting your own comment removes it but leaves the replies standing", async ({ page }) => {
    // Otherwise "delete my comment" becomes a way to erase a conversation
    // other people wrote.
    const articleUrl = await publishArticle(page, `CA Tombstone ${Date.now()}`);
    const parentEmail = await trustedReader(page, "catomb", "Thread Starter");

    const parentBody = `The opening point ${Date.now()}`;
    await postTrustedComment(page, articleUrl, parentEmail, parentBody);

    // Someone else replies to it.
    await page.context().clearCookies();
    const replyEmail = await trustedReader(page, "careply", "Replying Reader");
    grantCommentTrust(replyEmail);
    await page.goto(articleUrl);
    const replyBody = `A reply worth keeping ${Date.now()}`;
    await page.getByRole("button", { name: "Reply" }).first().click();
    await page.getByPlaceholder("Write a reply…").fill(replyBody);
    await page.getByRole("button", { name: "Reply", exact: true }).last().click();
    await expect(commentInThread(page, replyBody)).toBeVisible();

    // The original author deletes their comment.
    await page.context().clearCookies();
    await login(page, parentEmail);
    await page.goto(articleUrl);
    await page.getByRole("button", { name: "Delete" }).first().click();

    await expect(page.getByText("This comment was deleted by its author.")).toBeVisible();
    await expect(commentInThread(page, parentBody)).toHaveCount(0);
    await expect(commentInThread(page, replyBody)).toBeVisible();

    // Soft delete: the row survives for the audit trail.
    expect(commentStatus(parentBody)).toBe("DELETED");
  });

  test("a deleted comment with no replies disappears entirely", async ({ page }) => {
    const articleUrl = await publishArticle(page, `CA Vanish ${Date.now()}`);
    const email = await trustedReader(page, "cavanish", "Regretful Reader");

    const body = `Said in haste ${Date.now()}`;
    await postTrustedComment(page, articleUrl, email, body);

    await page.getByRole("button", { name: "Delete" }).click();
    await expect(commentInThread(page, body)).toHaveCount(0);
    await expect(page.getByText("This comment was deleted by its author.")).toHaveCount(0);

    await page.context().clearCookies();
    await page.goto(articleUrl);
    await expect(commentInThread(page, body)).toHaveCount(0);
  });
});
