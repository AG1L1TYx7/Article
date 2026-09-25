import { test, expect, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { uniqueTestIp } from "./support/testIp";
import { count, scalar, sql } from "./support/db";
import { waitForHydration } from "./support/hydration";

/**
 * The newsroom tooling: analytics, people, the audit log, and breaking
 * alerts.
 *
 * The weight here is on the safeguards in user management. Getting a role
 * change wrong is the one mistake in this application that cannot be
 * undone from inside it — recovering the last admin needs a shell on the
 * server.
 */

const PASSWORD = "correct-horse-battery-staple";

const promoteTo = (role: string, email: string) =>
  sql(`UPDATE \`User\` u JOIN \`UserRole\` r ON r.\`key\` = LOWER('${role}') SET u.role = '${role}', u.roleId = r.id WHERE u.email = '${email}';`);
const markEmailVerified = (email: string) =>
  sql(`UPDATE \`User\` SET \`emailVerifiedAt\` = NOW() WHERE email = '${email}';`);
const roleOf = (email: string) => scalar(`SELECT role FROM \`User\` WHERE email = '${email}';`);
const statusOf = (email: string) => scalar(`SELECT status FROM \`User\` WHERE email = '${email}';`);
const articleSlug = (title: string) =>
  scalar(`SELECT slug FROM \`Article\` WHERE title = '${title}' LIMIT 1;`);

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestIp() });
});

async function register(page: Page, prefix: string, name = "Test Person") {
  // Base 36 keeps the handle inside the 30-character limit: the decimal
  // epoch alone is 13 characters, which the longer prefixes here blew
  // straight past, and registration failed rather than the test saying so.
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const email = `${prefix}+${stamp}@example.com`;
  await page.goto("/register");
  await page.fill('input[name="name"]', name);
  await page.fill('input[name="handle"]', `${prefix}${stamp}`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.check('input[name="consent"]');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/login/);
  return email;
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

/**
 * An admin who has finished enrolling MFA.
 *
 * Both halves are necessary and neither can be faked. proxy.ts bounces an
 * admin without MFA to /dashboard/mfa and nowhere else, so the enrolment
 * has to happen — and the stored secret is encrypted with AUTH_SECRET, so
 * writing one straight into the column does not produce a working one.
 * Going through the real flow is the only version of this that works.
 */
async function signInAsAdmin(page: Page, prefix: string) {
  const email = await register(page, prefix, "Admin Person");
  promoteTo("ADMIN", email);
  markEmailVerified(email);
  await login(page, email);

  // Lands on /dashboard/mfa, because an admin cannot go anywhere else yet.
  await page.waitForURL(/\/dashboard\/mfa/);
  await page.getByRole("button", { name: "Set up authenticator app" }).click();
  const secret = await page.locator("p.font-mono.text-xs.break-all").textContent();
  if (!secret) throw new Error("no manual entry key on the enrolment screen");
  await page.fill('input[name="code"]', codeFor(secret.trim()));
  await page.getByRole("button", { name: "Confirm and enable" }).click();
  await expect(page.getByText("MFA is enabled on this account.")).toBeVisible();

  return email;
}

function codeFor(base32Secret: string): string {
  return new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(base32Secret),
  }).generate();
}

async function signInAsModerator(page: Page, prefix: string) {
  const email = await register(page, prefix, "Moderator Person");
  promoteTo("MODERATOR", email);
  markEmailVerified(email);
  await login(page, email);
  return email;
}

/** Writes a draft and publishes it, optionally flagged breaking. */
async function publish(page: Page, title: string, body: string, breaking: boolean) {
  await page.goto("/dashboard/articles/new");
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.locator('[contenteditable="true"]').click();
  await page.keyboard.type(body);
  if (breaking) await page.getByLabel(/breaking/i).check();
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.waitForURL("/dashboard/articles");
  await page.locator("tr", { hasText: title }).getByRole("button", { name: "Publish" }).click();
  await page.waitForLoadState("networkidle");
}

const breakingNotificationsFor = (email: string) =>
  count(
    `SELECT count(*) FROM \`Notification\` WHERE type = 'BREAKING_NEWS'
     AND \`userId\` = (SELECT id FROM \`User\` WHERE email = '${email}');`
  );

test.describe("Audit log viewer", () => {
  test("an admin can read what the application recorded", async ({ page }) => {
    // The data was already being written; until now there was no way to
    // read it without opening Postgres.
    const admin = await signInAsAdmin(page, "nraudit");

    await page.goto("/dashboard/audit-log");
    await expect(page.getByRole("heading", { name: "Audit log", level: 1 })).toBeVisible();

    // That admin's own sign-in is in there.
    await expect(page.getByText("auth.login").first()).toBeVisible();
    await expect(page.getByText(admin).first()).toBeVisible();
  });

  test("the failed-sign-in filter narrows to exactly that", async ({ page }) => {
    // Generate a failure to find.
    const victim = await register(page, "nrvictim");
    markEmailVerified(victim);
    await page.goto("/login");
    await page.fill('input[name="email"]', victim);
    await page.fill('input[name="password"]', "wrong-on-purpose");
    await page.click('button[type="submit"]');
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();

    await page.context().clearCookies();
    await signInAsAdmin(page, "nrauditfilter");

    await page.goto("/dashboard/audit-log?action=auth.login.failed");
    await expect(page.getByText("auth.login.failed").first()).toBeVisible();
    // A successful login must not show under the failed filter.
    await expect(page.getByText("auth.login", { exact: true })).toHaveCount(0);
  });

  test("a moderator cannot read the audit log", async ({ page }) => {
    await signInAsModerator(page, "nrauditmod");
    await page.goto("/dashboard/audit-log");
    await expect(page).toHaveURL("/dashboard");
  });
});

test.describe("People", () => {
  test("an admin can promote a reader to moderator", async ({ page }) => {
    const reader = await register(page, "nrpromote");
    await page.context().clearCookies();
    await signInAsAdmin(page, "nrpromoter");

    await page.goto("/dashboard/users");
    const row = page.locator("tr", { hasText: reader });
    // By visible label, not by value: roles are editable data now, so the
    // option values are database ids rather than the old fixed enum.
    await row.getByRole("combobox").selectOption({ label: "Moderator" });

    await expect.poll(() => roleOf(reader)).toBe("MODERATOR");
  });

  test("an admin cannot change their own role", async ({ page }) => {
    // The one way to lock yourself out of the page you are standing on.
    const admin = await signInAsAdmin(page, "nrself");

    await page.goto("/dashboard/users");
    const row = page.locator("tr", { hasText: admin });
    await expect(row.getByRole("combobox")).toBeDisabled();
    // And no suspend button either.
    await expect(row.getByRole("button", { name: /Suspend|Reinstate/ })).toHaveCount(0);

    expect(roleOf(admin)).toBe("ADMIN");
  });

  // NOT TESTED HERE: the guard that refuses to demote or suspend the last
  // active admin. Exercising it means making one account the only active
  // admin in the entire database, and the other spec files are creating
  // admins in parallel — so the test would either fail at random or
  // suspend accounts those tests are relying on. The guard itself is in
  // wouldRemoveLastAdmin() in this route's actions.ts, and the page warns
  // when only one active admin remains.

  test("suspending an account signs it out everywhere immediately", async ({ page }) => {
    const target = await register(page, "nrsuspend");
    markEmailVerified(target);

    await page.context().clearCookies();
    await signInAsAdmin(page, "nrsuspender");
    await page.goto("/dashboard/users");
    const row = page.locator("tr", { hasText: target });
    await row.getByRole("button", { name: "Suspend" }).click();

    await expect.poll(() => statusOf(target)).toBe("SUSPENDED");

    // A suspension that waits for a token to expire is not a suspension:
    // sessionVersion is bumped so the next request fails.
    expect(count(`SELECT \`sessionVersion\` FROM \`User\` WHERE email = '${target}';`)).toBeGreaterThan(
      0
    );
  });

  test("an admin can add a person with a role, and they can log in with the temporary password", async ({ page }) => {
    // Six sign-in round trips plus a forced password change: comfortably
    // inside the budget alone, over it when the whole suite is competing
    // for the machine. Same treatment as the MFA journeys.
    test.slow();
    await signInAsAdmin(page, "nradder");
    const stamp = Date.now();
    const email = `nradded+${stamp}@example.com`;

    await page.goto("/dashboard/users");
    await page.getByRole("button", { name: "Add person" }).click();
    // Exact: the people rows behind the dialog carry labels like "Role for
    // <name>", and another spec's renamed user can contain these words.
    await page.getByLabel("Name", { exact: true }).fill("Added Writer");
    await page.getByLabel("Handle", { exact: true }).fill(`nradded${stamp}`);
    await page.getByLabel("Email", { exact: true }).fill(email);
    // The role choices are read from the database now, so this is the
    // seeded role's name rather than the old hard-coded blurb.
    await page.getByRole("radio", { name: /Moderator/ }).check();
    await page.getByRole("button", { name: "Create account" }).click();

    // The temporary password is shown once, in the dialog.
    await expect(page.getByText("Account created")).toBeVisible();
    const temporary = (await page.locator("code").textContent())?.trim();
    expect(temporary).toBeTruthy();
    expect(roleOf(email)).toBe("MODERATOR");

    // The new person signs in with it and is made to choose their own
    // password before anything else opens.
    await page.context().clearCookies();
    await page.goto("/login");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', temporary!);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/account\/password/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/account\/password/);

    const own = `my-own-password-${stamp}`;
    await page.fill('input[name="current"]', temporary!);
    await page.fill('input[name="next"]', own);
    await page.fill('input[name="confirm"]', own);
    await page.getByRole("button", { name: "Set my password and continue" }).click();
    await page.waitForURL("/dashboard");

    // The temporary password no longer works; the new one does.
    await page.context().clearCookies();
    await page.goto("/login");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', temporary!);
    await page.click('button[type="submit"]');
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
    await page.fill('input[name="password"]', own);
    await page.click('button[type="submit"]');
    await page.waitForURL("/dashboard");
  });

  test("a moderator cannot reach the people page", async ({ page }) => {
    await signInAsModerator(page, "nrpeoplemod");
    await page.goto("/dashboard/users");
    await expect(page).toHaveURL("/dashboard");
  });
});

test.describe("Analytics", () => {
  test("staff can see the newsroom numbers", async ({ page }) => {
    await signInAsModerator(page, "nranalytics");
    await page.goto("/dashboard/analytics");

    await expect(page.getByRole("heading", { name: "Analytics", level: 1 })).toBeVisible();
    await expect(page.getByText("Published", { exact: true })).toBeVisible();
    await expect(page.getByText("Most read")).toBeVisible();
  });

  test("reading an article counts a view", async ({ page }) => {
    const title = `NR Views ${Date.now()}`;
    await signInAsModerator(page, "nrviews");
    await publish(page, title, "Body.", false);

    const slug = articleSlug(title);
    await page.context().clearCookies();
    await page.goto(`/article/${slug}`);

    // The write is scheduled with after(), so it lands once the response
    // has gone out rather than before it.
    await expect
      .poll(() => count(`SELECT \`viewCount\` FROM \`Article\` WHERE slug = '${slug}';`), {
        timeout: 10000,
      })
      .toBeGreaterThan(0);
  });

  test("a plain reader cannot see analytics", async ({ page }) => {
    const reader = await register(page, "nranalyticsreader");
    markEmailVerified(reader);
    await login(page, reader);
    await page.goto("/dashboard/analytics");
    await expect(page).not.toHaveURL(/analytics/);
  });
});

test.describe("Breaking news alerts", () => {
  test("publishing a breaking story alerts the followers of its author", async ({ page }) => {
    const title = `NR Breaking ${Date.now()}`;
    const author = await signInAsModerator(page, "nrbreaking");
    const authorHandle = scalar(`SELECT handle FROM \`User\` WHERE email = '${author}';`);

    // A reader follows the author.
    await page.context().clearCookies();
    const follower = await register(page, "nrfollower");
    markEmailVerified(follower);
    await login(page, follower);
    await page.goto(`/author/${authorHandle}`);
    // Clicking before hydration does nothing at all, and only loses the
    // race under parallel load. See support/hydration.ts.
    await waitForHydration(page, /^Follow/);
    await page.getByRole("button", { name: /^Follow/ }).click();
    await expect
      .poll(() =>
        count(
          `SELECT count(*) FROM \`Follow\` WHERE \`followerId\` = (SELECT id FROM \`User\` WHERE email = '${follower}');`
        )
      )
      .toBe(1);

    // The author publishes something breaking.
    await page.context().clearCookies();
    await login(page, author);
    await publish(page, title, "Something happened.", true);

    expect(breakingNotificationsFor(follower)).toBe(1);

    // And the follower sees it.
    await page.context().clearCookies();
    await login(page, follower);
    await page.goto("/notifications");
    // Anchored: the footer's "Get breaking news alerts" toggle would otherwise
    // match too. The optional prefix is the screen-reader-only "Unread:".
    await expect(page.getByText(/^(Unread: )?Breaking news$/)).toBeVisible();
    await expect(page.getByText(title)).toBeVisible();
  });

  test("an ordinary publish alerts nobody", async ({ page }) => {
    // Every publish alerting every follower would make the flag
    // meaningless within a week.
    const title = `NR Ordinary ${Date.now()}`;
    const author = await signInAsModerator(page, "nrordinary");
    const authorHandle = scalar(`SELECT handle FROM \`User\` WHERE email = '${author}';`);

    await page.context().clearCookies();
    const follower = await register(page, "nrordinaryfollower");
    markEmailVerified(follower);
    await login(page, follower);
    await page.goto(`/author/${authorHandle}`);
    // Clicking before hydration does nothing at all, and only loses the
    // race under parallel load. See support/hydration.ts.
    await waitForHydration(page, /^Follow/);
    await page.getByRole("button", { name: /^Follow/ }).click();
    await expect
      .poll(() =>
        count(
          `SELECT count(*) FROM \`Follow\` WHERE \`followerId\` = (SELECT id FROM \`User\` WHERE email = '${follower}');`
        )
      )
      .toBe(1);

    await page.context().clearCookies();
    await login(page, author);
    // Deliberately not flagged breaking.
    await publish(page, title, "Nothing urgent.", false);

    expect(breakingNotificationsFor(follower)).toBe(0);
  });

  test("an author is not alerted about their own story", async ({ page }) => {
    const title = `NR Self Alert ${Date.now()}`;
    const author = await signInAsModerator(page, "nrselfalert");
    await publish(page, title, "My own breaking story.", true);

    expect(breakingNotificationsFor(author)).toBe(0);
  });
});
