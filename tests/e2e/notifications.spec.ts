import { test, expect, type Page } from "@playwright/test";
import { uniqueTestIp } from "./support/testIp";
import { sql, scalar } from "./support/db";
import { commentInThread } from "./support/comments";

const PASSWORD = "correct-horse-battery-staple";

const promoteTo = (role: string, email: string) =>
  sql(`UPDATE "User" SET role = '${role}' WHERE email = '${email}';`);
const markEmailVerified = (email: string) =>
  sql(`UPDATE "User" SET "emailVerifiedAt" = NOW() WHERE email = '${email}';`);

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
    `INSERT INTO "Comment" (id, "articleId", "userId", body, status, "createdAt", "updatedAt")
     SELECT 'trust-' || md5(random()::text || g::text),
            'e2e-trust-ballast',
            (SELECT id FROM "User" WHERE email = '${email}'),
            'Established account warm-up ' || g,
            'APPROVED', NOW(), NOW()
     FROM generate_series(1, 3) g;`
  );

const notificationCount = (email: string) =>
  Number(
    scalar(
      `SELECT count(*) FROM "Notification"
       WHERE "userId" = (SELECT id FROM "User" WHERE email = '${email}');`
    )
  );

const articleSlug = (title: string) =>
  scalar(`SELECT slug FROM "Article" WHERE title = '${title}' LIMIT 1;`);

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestIp() });
});

async function register(page: Page, email: string, handle: string, name = "Reader") {
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

async function publishArticle(page: Page, title: string): Promise<string> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `nmod+${stamp}@example.com`;
  await register(page, email, `nmod${stamp}`, "Notification Test Author");
  promoteTo("MODERATOR", email);
  markEmailVerified(email);
  await login(page, email);

  await page.goto("/dashboard/articles/new");
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.locator('[contenteditable="true"]').click();
  await page.keyboard.type("Article body for the notification tests.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.waitForURL("/dashboard/articles");
  await page.locator("tr", { hasText: title }).getByRole("button", { name: "Publish" }).click();
  await page.waitForLoadState("networkidle");

  await page.context().clearCookies();
  return `/article/${articleSlug(title)}`;
}

/** Registers a verified reader and signs them in. */
async function reader(page: Page, prefix: string, name: string) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `${prefix}+${stamp}@example.com`;
  await register(page, email, `${prefix}${stamp}`, name);
  markEmailVerified(email);
  await login(page, email);
  return email;
}

/** Posts a top-level comment from a trusted account, straight into public. */
async function postComment(page: Page, articleUrl: string, email: string, body: string) {
  grantCommentTrust(email);
  await page.goto(articleUrl);
  await page.getByPlaceholder("Join the discussion…").fill(body);
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(commentInThread(page, body)).toBeVisible();
  // Checked against the database too, not just the screen: a later step
  // failing because this comment is missing should blame this helper, not
  // the step that went looking for it.
  expect(
    scalar(`SELECT status FROM "Comment" WHERE body = '${body}' LIMIT 1;`),
    `comment "${body}" rendered but is not APPROVED in the database`
  ).toBe("APPROVED");
}

/** Replies to the first comment on the page. */
async function replyToFirst(page: Page, body: string) {
  await page.getByRole("button", { name: "Reply" }).first().click();
  await page.getByPlaceholder("Write a reply…").fill(body);
  await page.getByRole("button", { name: "Reply", exact: true }).last().click();
}

test.describe("Notifications", () => {
  test("a reply tells the person who was replied to, and links into the thread", async ({ page }) => {
    const articleUrl = await publishArticle(page, `Notif Reply ${Date.now()}`);

    const parentEmail = await reader(page, "nparent", "Thread Starter");
    const parentBody = `My original point ${Date.now()}`;
    await postComment(page, articleUrl, parentEmail, parentBody);

    await page.context().clearCookies();
    const replierEmail = await reader(page, "nreplier", "Helpful Replier");
    grantCommentTrust(replierEmail);
    await page.goto(articleUrl);
    const replyBody = `A considered reply ${Date.now()}`;
    await replyToFirst(page, replyBody);
    await expect(commentInThread(page, replyBody)).toBeVisible();

    // The replier hears nothing about their own reply.
    expect(notificationCount(replierEmail)).toBe(0);

    await page.context().clearCookies();
    await login(page, parentEmail);
    await page.goto("/notifications");

    await expect(page.getByText("Helpful Replier replied to your comment")).toBeVisible();
    await expect(page.getByText(replyBody)).toBeVisible();

    // The link goes to the reply itself, not just the article.
    await page.getByRole("link", { name: "View in thread" }).first().click();
    await expect(page).toHaveURL(/#comment-/);
    await expect(page.getByText(replyBody)).toBeVisible();
  });

  test("replying to yourself notifies nobody", async ({ page }) => {
    const articleUrl = await publishArticle(page, `Notif Self ${Date.now()}`);

    const email = await reader(page, "nself", "Talking To Myself");
    const body = `A point I will follow up on ${Date.now()}`;
    await postComment(page, articleUrl, email, body);

    const selfReply = `Following up on myself ${Date.now()}`;
    await replyToFirst(page, selfReply);
    await expect(commentInThread(page, selfReply)).toBeVisible();

    expect(notificationCount(email)).toBe(0);
  });

  test("a held reply stays silent until a moderator approves it", async ({ page }) => {
    // Otherwise the moderation queue becomes a delivery mechanism: anything
    // held for review would still reach the other person's notifications.
    const articleUrl = await publishArticle(page, `Notif Held ${Date.now()}`);

    const parentEmail = await reader(page, "nheldparent", "Waiting Author");
    const parentBody = `Something worth replying to ${Date.now()}`;
    await postComment(page, articleUrl, parentEmail, parentBody);

    // A brand new account, so its reply goes to the queue.
    await page.context().clearCookies();
    await reader(page, "nheldnew", "Brand New Account");
    await page.goto(articleUrl);
    const replyBody = `A reply from a new account ${Date.now()}`;
    await replyToFirst(page, replyBody);
    await expect(page.getByText("a moderator will review it")).toBeVisible();

    expect(notificationCount(parentEmail)).toBe(0);

    // A moderator lets it through.
    await page.context().clearCookies();
    const modEmail = `nmoderator+${Date.now()}@example.com`;
    await register(page, modEmail, `nmoderator${Date.now()}`, "The Moderator");
    promoteTo("MODERATOR", modEmail);
    markEmailVerified(modEmail);
    await login(page, modEmail);

    await page.goto("/dashboard/comments");
    await page.locator("li", { hasText: replyBody }).getByRole("button", { name: "Approve" }).click();
    await page.waitForLoadState("networkidle");

    // Now, and only now, the parent author hears about it.
    expect(notificationCount(parentEmail)).toBe(1);

    await page.context().clearCookies();
    await login(page, parentEmail);
    await page.goto("/notifications");
    await expect(page.getByText("Brand New Account replied to your comment")).toBeVisible();
  });

  test("an author is told when their held comment goes public", async ({ page }) => {
    const articleUrl = await publishArticle(page, `Notif Approved ${Date.now()}`);

    await page.context().clearCookies();
    const email = await reader(page, "napproved", "Patient Newcomer");
    await page.goto(articleUrl);
    const body = `My very first comment ${Date.now()}`;
    await page.getByPlaceholder("Join the discussion…").fill(body);
    await page.getByRole("button", { name: "Post comment" }).click();
    await expect(page.getByText("a moderator will review it")).toBeVisible();

    await page.context().clearCookies();
    const modEmail = `napprovemod+${Date.now()}@example.com`;
    await register(page, modEmail, `napprovemod${Date.now()}`, "Approving Moderator");
    promoteTo("MODERATOR", modEmail);
    markEmailVerified(modEmail);
    await login(page, modEmail);
    await page.goto("/dashboard/comments");
    await page.locator("li", { hasText: body }).getByRole("button", { name: "Approve" }).click();
    await page.waitForLoadState("networkidle");

    await page.context().clearCookies();
    await login(page, email);
    await page.goto("/notifications");
    await expect(page.getByText("Your comment was approved and is now public")).toBeVisible();
  });

  test("the header badge counts unread notifications and clears when read", async ({ page }) => {
    const articleUrl = await publishArticle(page, `Notif Badge ${Date.now()}`);

    const parentEmail = await reader(page, "nbadge", "Badge Watcher");
    await postComment(page, articleUrl, parentEmail, `Reply to me please ${Date.now()}`);

    await page.context().clearCookies();
    const replierEmail = await reader(page, "nbadger", "Badge Replier");
    grantCommentTrust(replierEmail);
    await page.goto(articleUrl);
    const badgeReply = `Here is your reply ${Date.now()}`;
    await replyToFirst(page, badgeReply);
    await expect(commentInThread(page, badgeReply)).toBeVisible();

    await page.context().clearCookies();
    await login(page, parentEmail);
    await page.goto("/");

    const link = page.getByRole("link", { name: /Notifications/ });
    await expect(link).toContainText("1");

    await link.click();
    await page.getByRole("button", { name: /Mark 1 as read/ }).click();
    await expect(page.getByRole("button", { name: /Mark .* as read/ })).toHaveCount(0);

    // The badge is gone on the next page load, not just on this one.
    await page.goto("/");
    await expect(page.getByRole("link", { name: /Notifications/ })).not.toContainText("1");
  });

  test("a signed-out visitor is sent to log in, and sees no notifications link", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /Notifications/ })).toHaveCount(0);

    await page.goto("/notifications");
    await expect(page).toHaveURL(/\/login/);
  });
});
