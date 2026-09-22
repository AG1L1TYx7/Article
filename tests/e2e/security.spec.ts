import { test, expect, type Page } from "@playwright/test";
import { uniqueTestIp } from "./support/testIp";
import { count, scalar, sql } from "./support/db";
import { finishLogin, mfaColumnsSql } from "./support/staff";

/**
 * Attack attempts against the running application.
 *
 * Every test here tries to do something it must not be allowed to do, and
 * asserts it failed. Organised by the OWASP Top 10 category each one
 * belongs to, so a gap in coverage is visible rather than implied.
 *
 * This is automated testing, not a penetration test. It exercises the
 * attacks that were considered while building the thing, which is exactly
 * the set a real attacker will go beyond. It is a regression net for known
 * classes of flaw — valuable, and not a substitute for someone
 * adversarial and unfamiliar looking at it.
 */

const PASSWORD = "correct-horse-battery-staple";

const promoteTo = (role: string, email: string) =>
  sql(`UPDATE \`User\` SET role = '${role}'${role === "MODERATOR" ? `, ${mfaColumnsSql()}` : ""} WHERE email = '${email}';`);
const markEmailVerified = (email: string) =>
  sql(`UPDATE \`User\` SET \`emailVerifiedAt\` = NOW() WHERE email = '${email}';`);
const articleSlug = (title: string) =>
  scalar(`SELECT slug FROM \`Article\` WHERE title = '${title}' LIMIT 1;`);
const articleId = (title: string) =>
  scalar(`SELECT id FROM \`Article\` WHERE title = '${title}' LIMIT 1;`);

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestIp() });
});

async function register(page: Page, prefix: string, name = "Test Person") {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
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
  await finishLogin(page);
}

async function signInAs(page: Page, prefix: string, role: "READER" | "MODERATOR" | "ADMIN") {
  const email = await register(page, prefix);
  if (role !== "READER") promoteTo(role, email);
  markEmailVerified(email);
  await login(page, email);
  return email;
}

/** Writes a draft as the signed-in moderator and returns its title. */
async function writeDraft(page: Page, title: string) {
  await page.goto("/dashboard/articles/new");
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.locator('[contenteditable="true"]').click();
  await page.keyboard.type("Body.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.waitForURL("/dashboard/articles");
  return title;
}

// ---------------------------------------------------------------------------
test.describe("A01 Broken access control", () => {
  test("a signed-out visitor cannot reach the dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("a reader cannot reach the dashboard", async ({ page }) => {
    // Registration always creates a READER. If this ever passes, the
    // whole staff/reader distinction is decorative.
    await signInAs(page, "secreader", "READER");
    await page.goto("/dashboard");
    await expect(page).not.toHaveURL(/\/dashboard$/);
  });

  test("a moderator cannot reach admin-only areas", async ({ page }) => {
    await signInAs(page, "secmod", "MODERATOR");
    for (const path of ["/dashboard/categories", "/dashboard/users", "/dashboard/audit-log"]) {
      await page.goto(path);
      await expect(page, `moderator reached ${path}`).toHaveURL("/dashboard");
    }
  });

  test("a moderator cannot edit another moderator's article", async ({ page }) => {
    const title = `Sec Ownership ${Date.now()}`;
    await signInAs(page, "secowner", "MODERATOR");
    await writeDraft(page, title);
    const id = articleId(title);

    await page.context().clearCookies();
    await signInAs(page, "secintruder", "MODERATOR");
    await page.goto(`/dashboard/articles/${id}`);
    await expect(page).toHaveURL("/dashboard/articles");
  });

  test("an unpublished article is not readable by its URL", async ({ page }) => {
    // The dashboard hides it; the question is whether the public route
    // does, for someone who knows or guesses the slug.
    const title = `Sec Draft ${Date.now()}`;
    await signInAs(page, "secdraft", "MODERATOR");
    await writeDraft(page, title);
    const slug = articleSlug(title);

    await page.context().clearCookies();
    const response = await page.goto(`/article/${slug}`);
    expect(response?.status()).toBe(404);
  });

  test("a suspended account cannot sign in", async ({ page }) => {
    const email = await register(page, "secsuspended");
    markEmailVerified(email);
    sql(`UPDATE \`User\` SET status = 'SUSPENDED' WHERE email = '${email}';`);

    await page.goto("/login");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("uploading requires staff, not merely an account", async ({ page }) => {
    await signInAs(page, "secupload", "READER");
    const response = await page.request.post("/api/media/upload", {
      multipart: { file: { name: "x.png", mimeType: "image/png", buffer: Buffer.from("x") } },
    });
    expect(response.status()).toBe(403);
  });
});

// ---------------------------------------------------------------------------
test.describe("A03 Injection", () => {
  test("SQL injection through the search box does not execute", async ({ page }) => {
    // Search is the one raw SQL statement in the application.
    //
    // A canary account rather than global row counts: the other spec
    // files run in parallel and create articles and admins constantly, so
    // "the totals did not move" is not something this test can assert
    // without failing on other people's work.
    const canary = await register(page, "secinjection");

    for (const payload of [
      '\'; DROP TABLE "Article"; --',
      "' OR '1'='1",
      "x' UNION SELECT NULL,NULL,NULL--",
      `'; UPDATE \`User\` SET role='ADMIN' WHERE email='${canary}'; --`,
      `'; DELETE FROM \`User\` WHERE email='${canary}'; --`,
    ]) {
      const response = await page.goto(`/search?q=${encodeURIComponent(payload)}`);
      expect(response?.status(), payload).toBe(200);
    }

    // The canary was not promoted and was not deleted.
    expect(scalar(`SELECT role FROM \`User\` WHERE email = '${canary}';`)).toBe("READER");

    // And the table is still there at all — a successful DROP would make
    // this query error rather than return a number.
    expect(count(`SELECT count(*) FROM \`Article\`;`)).toBeGreaterThanOrEqual(0);
  });

  test("SQL injection through a URL parameter does not execute", async ({ page }) => {
    for (const path of [
      "/article/' OR 1=1--",
      "/category/'; DROP TABLE \"Category\"; --",
      "/author/' UNION SELECT--",
    ]) {
      const response = await page.goto(encodeURI(path));
      expect([404, 400], path).toContain(response?.status() ?? 0);
    }
    // The table is still there.
    expect(count(`SELECT count(*) FROM \`Category\`;`)).toBeGreaterThan(0);
  });

  test("a script tag in an article body never reaches the page", async ({ page }) => {
    const marker = `xss${Date.now()}`;
    const title = `Sec XSS Body ${Date.now()}`;
    await signInAs(page, "secxss", "MODERATOR");

    await page.goto("/dashboard/articles/new");
    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.locator('[contenteditable="true"]').click();
    await page.keyboard.type(`<script>window.${marker}=1</script><img src=x onerror="window.${marker}=1">`);
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.waitForURL("/dashboard/articles");
    await page.locator("tr", { hasText: title }).getByRole("button", { name: "Publish" }).click();
    await page.waitForLoadState("networkidle");

    await page.context().clearCookies();
    await page.goto(`/article/${articleSlug(title)}`);

    // Sanitized on save and again on render. Asserted against the DOM
    // rather than the HTML source: the payload is expected to appear in
    // the source as escaped text, which is the whole point — what matters
    // is that it is text and not an element.
    expect(
      await page.evaluate((m) => (window as never as Record<string, unknown>)[m], marker)
    ).toBeUndefined();

    const body = page.locator("article .prose");
    await expect(body.locator("script")).toHaveCount(0);
    await expect(body.locator("img")).toHaveCount(0);
    await expect(body.locator("[onerror]")).toHaveCount(0);
    // And it is visible as the text the author typed.
    await expect(body).toContainText("<script>");
  });

  test("a script tag in a comment is shown as text, not run", async ({ page }) => {
    const marker = `cxss${Date.now()}`;
    const title = `Sec XSS Comment ${Date.now()}`;
    await signInAs(page, "secxssmod", "MODERATOR");
    await writeDraft(page, title);
    await page.locator("tr", { hasText: title }).getByRole("button", { name: "Publish" }).click();
    await page.waitForLoadState("networkidle");
    const url = `/article/${articleSlug(title)}`;

    await page.context().clearCookies();
    const reader = await register(page, "secxssreader");
    markEmailVerified(reader);
    await login(page, reader);

    await page.goto(url);
    const payload = `<script>window.${marker}=1</script>`;
    await page.getByPlaceholder("Join the discussion…").fill(payload);
    await page.getByRole("button", { name: "Post comment" }).click();
    await expect(page.getByText("a moderator will review it")).toBeVisible();

    // Approve it so it actually renders to the public.
    sql(`UPDATE \`Comment\` SET status = 'APPROVED' WHERE body = '${payload.replace(/'/g, "''")}';`);
    await page.reload();

    expect(await page.evaluate((m) => (window as never as Record<string, unknown>)[m], marker)).toBeUndefined();
  });

  test("path traversal through a media key is refused", async ({ page }) => {
    for (const key of [
      "..%2F..%2F.env",
      "....//....//.env",
      "%2e%2e%2f%2e%2e%2fpackage.json",
    ]) {
      const response = await page.request.get(`/media/${key}`);
      expect([400, 404], key).toContain(response.status());
      const body = await response.text();
      expect(body).not.toContain("DATABASE_URL");
      expect(body).not.toContain("AUTH_SECRET");
    }
  });
});

// ---------------------------------------------------------------------------
test.describe("A07 Authentication failures", () => {
  test("an open redirect cannot turn a real login into a phishing hop", async ({ page }) => {
    // The bug this guards: `from.startsWith("/")` accepted "//evil.com",
    // which browsers resolve to https://evil.com — a victim logs in
    // genuinely and lands on an attacker's cloned page.
    const email = await register(page, "secredirect");
    markEmailVerified(email);

    for (const payload of ["//evil.com", "/\\evil.com", "https://evil.com"]) {
      await page.goto(`/login?from=${encodeURIComponent(payload)}`);
      await page.fill('input[name="email"]', email);
      await page.fill('input[name="password"]', PASSWORD);
      await page.click('button[type="submit"]');
      await finishLogin(page);

      expect(new URL(page.url()).host, `redirected off-site via ${payload}`).toBe(
        new URL(page.url()).host
      );
      expect(page.url(), payload).not.toContain("evil.com");
      await page.context().clearCookies();
    }
  });

  test("repeated wrong passwords lock the account", async ({ page }) => {
    const email = await register(page, "seclockout");
    markEmailVerified(email);

    for (let attempt = 0; attempt < 6; attempt++) {
      await page.goto("/login");
      await page.fill('input[name="email"]', email);
      await page.fill('input[name="password"]', `wrong-guess-${attempt}`);
      await page.click('button[type="submit"]');
      await expect(page.getByText("Incorrect email or password.")).toBeVisible();
    }

    expect(
      scalar(
        `SELECT coalesce(CAST(\`lockedUntil\` AS CHAR), 'none') FROM \`User\` WHERE email = '${email}';`
      )
    ).not.toBe("none");

    // And the correct password does not work while locked. Because the
    // password IS right, the page says so plainly (the person already
    // knows the account exists) instead of the generic message that had
    // people retyping a correct password and extending the lock.
    await page.goto("/login");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page.getByText(/locked for another/)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    // A wrong password on the locked account still gets the generic
    // message — the lock is never revealed to someone without the password.
    await page.goto("/login");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', "still-wrong");
    await page.click('button[type="submit"]');
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
  });

  test("failed logins are recorded, so an attack is visible afterwards", async ({ page }) => {
    // Without this the log shows nothing until an attempt succeeds.
    const email = await register(page, "secauditlog");
    markEmailVerified(email);

    await page.goto("/login");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', "definitely-not-it");
    await page.click('button[type="submit"]');
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();

    expect(
      count(
        `SELECT count(*) FROM \`AuditLog\` WHERE action = 'auth.login.failed'
         AND \`actorId\` = (SELECT id FROM \`User\` WHERE email = '${email}');`
      )
    ).toBeGreaterThan(0);
  });

  test("the session cookie is not readable by scripts", async ({ page }) => {
    const email = await register(page, "seccookie");
    markEmailVerified(email);
    await login(page, email);

    const cookies = await page.context().cookies();
    const session = cookies.find((c) => /authjs|next-auth/i.test(c.name) && /session/i.test(c.name));
    expect(session, "no session cookie found").toBeTruthy();
    // An XSS that cannot read the session cookie cannot steal the session.
    expect(session!.httpOnly).toBe(true);
    expect(session!.sameSite).toBe("Lax");
  });

  test("registration does not reveal whether an email is already known", async ({ page }) => {
    const email = await register(page, "secenum");

    await page.goto("/register");
    await page.fill('input[name="name"]', "Someone Else");
    await page.fill('input[name="handle"]', `secenum2${Date.now()}`);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PASSWORD);
    await page.check('input[name="consent"]');
    await page.click('button[type="submit"]');

    // Either outcome is fine as long as it does not say "already taken":
    // that turns the form into an account-existence oracle.
    const body = await page.textContent("body");
    expect(body?.toLowerCase()).not.toContain("already registered");
    expect(body?.toLowerCase()).not.toContain("already exists");
  });
});

// ---------------------------------------------------------------------------
test.describe("CSRF on cookie-authenticated API routes", () => {
  test("a cross-origin POST to the media upload route is refused", async ({ page }) => {
    // Simulates a hostile page's form or fetch posting to this API with
    // the visitor's session cookie riding along. SameSite=Lax on that
    // cookie already blocks this in a real browser; this proves the
    // explicit Origin check works too, since it is what protects a client
    // that does not enforce SameSite correctly.
    await signInAs(page, "seccsrf", "MODERATOR");

    const response = await page.request.post("/api/media/upload", {
      headers: { origin: "https://attacker.example" },
      multipart: { file: { name: "x.png", mimeType: "image/png", buffer: Buffer.from("x") } },
    });
    expect(response.status()).toBe(403);
  });

  test("a cross-origin POST to upload-url is refused", async ({ page }) => {
    await signInAs(page, "seccsrfurl", "MODERATOR");
    const response = await page.request.post("/api/media/upload-url", {
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      data: { extension: "mp4", size: 1024 },
    });
    expect(response.status()).toBe(403);
  });

  test("a cross-origin POST to finalize is refused", async ({ page }) => {
    await signInAs(page, "seccsrffin", "MODERATOR");
    const response = await page.request.post("/api/media/finalize", {
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      data: { storageKey: "quarantine/3f2504e0-4f89-11d3-9a0c-0305e82c3301.mp4", token: "x" },
    });
    expect(response.status()).toBe(403);
  });

  test("a same-origin POST still works", async ({ page }) => {
    // The check must not be so strict it blocks the legitimate case.
    await signInAs(page, "seccsrfok", "MODERATOR");
    const response = await page.request.post("/api/media/upload", {
      multipart: { file: { name: "x.png", mimeType: "image/png", buffer: Buffer.from("x") } },
    });
    expect(response.status()).not.toBe(403);
  });
});

test.describe("A05 Security misconfiguration", () => {
  test("responses do not advertise the framework", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.headers()["x-powered-by"]).toBeUndefined();
  });

  test("the security headers are present on a public page", async ({ page }) => {
    const response = await page.goto("/");
    const headers = response?.headers() ?? {};
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["content-security-policy"]).toBeTruthy();
  });

  test("the site cannot be framed", async ({ page }) => {
    // Clickjacking: the defence is frame-ancestors, with X-Frame-Options
    // for browsers that predate it.
    const response = await page.goto("/");
    expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  });
});
