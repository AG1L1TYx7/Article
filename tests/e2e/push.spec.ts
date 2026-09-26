import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { uniqueTestIp } from "./support/testIp";
import { count, scalar } from "./support/db";
import { finishLogin } from "./support/staff";

const PASSWORD = "correct-horse-battery-staple";

/**
 * Web Push, at the API boundary.
 *
 * A headless browser has no push service to subscribe through, so the
 * subscription object is faked here: the endpoint is on a reserved test
 * hostname (cleanup-test-data removes it) and the keys are the right
 * shape. What is under test is everything server-side of the browser —
 * validation, origin checks, persistence, ownership and removal.
 */
function fakeSubscription() {
  return {
    endpoint: `https://push.example.com/send/${randomUUID()}`,
    keys: {
      p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
      auth: "tBHItJI5svbpez7KI4CCXg",
    },
  };
}

const rowsFor = (endpoint: string) =>
  count(`SELECT count(*) FROM \`PushSubscription\` WHERE endpoint = '${endpoint}';`);

async function pushEnabled(request: APIRequestContext): Promise<boolean> {
  const res = await request.get("/api/push/config");
  const body = (await res.json()) as { enabled: boolean };
  return body.enabled;
}

async function registerAndLogin(page: Page, email: string, handle: string) {
  await page.goto("/register");
  await page.fill('input[name="name"]', "Push Reader");
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

test.describe("Push alerts", () => {
  test("the config endpoint says whether push is available and never caches", async ({ request }) => {
    const res = await request.get("/api/push/config");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-store");
    const body = (await res.json()) as { enabled: boolean; publicKey: string | null };
    expect(typeof body.enabled).toBe("boolean");
    if (body.enabled) expect(body.publicKey).toMatch(/^[A-Za-z0-9_-]{60,}$/);
    else expect(body.publicKey).toBeNull();
  });

  test("the service worker is served from the site's own origin", async ({ request }) => {
    const res = await request.get("/sw.js");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/javascript/);
    expect(await res.text()).toContain('addEventListener("push"');
  });

  test("a cross-origin subscribe is refused", async ({ request }) => {
    const res = await request.post("/api/push/subscribe", {
      data: fakeSubscription(),
      headers: { origin: "https://evil.example.net" },
    });
    expect(res.status()).toBe(403);
  });

  test("a malformed subscription is refused", async ({ request }) => {
    test.skip(!(await pushEnabled(request)), "VAPID keys are not configured in this environment");
    const res = await request.post("/api/push/subscribe", {
      data: { endpoint: "http://not-https.example.com/x", keys: { p256dh: "short", auth: "x" } },
    });
    expect(res.status()).toBe(400);
  });

  test("an anonymous reader can subscribe once, re-subscribe idempotently, and unsubscribe", async ({
    request,
  }) => {
    test.skip(!(await pushEnabled(request)), "VAPID keys are not configured in this environment");
    const sub = fakeSubscription();

    expect((await request.post("/api/push/subscribe", { data: sub })).status()).toBe(204);
    expect(rowsFor(sub.endpoint)).toBe(1);
    expect(scalar(`SELECT \`userId\` IS NULL FROM \`PushSubscription\` WHERE endpoint = '${sub.endpoint}';`)).toBe("1");

    // Same endpoint again: the row is refreshed, not duplicated.
    expect((await request.post("/api/push/subscribe", { data: sub })).status()).toBe(204);
    expect(rowsFor(sub.endpoint)).toBe(1);

    expect((await request.delete("/api/push/subscribe", { data: { endpoint: sub.endpoint } })).status()).toBe(204);
    expect(rowsFor(sub.endpoint)).toBe(0);
  });

  test("a signed-in reader's subscription is attached to their account", async ({ page }) => {
    test.skip(!(await pushEnabled(page.request)), "VAPID keys are not configured in this environment");
    const stamp = Date.now();
    const email = `pushreader+${stamp}@example.com`;
    await registerAndLogin(page, email, `pushreader${stamp}`);

    const sub = fakeSubscription();
    // page.request shares the browser context's cookies, so this is the
    // same call the PushToggle component makes from the signed-in page.
    const res = await page.request.post("/api/push/subscribe", { data: sub });
    expect(res.status()).toBe(204);

    const owner = scalar(
      `SELECT u.email FROM \`PushSubscription\` p JOIN \`User\` u ON u.id = p.\`userId\`
       WHERE p.endpoint = '${sub.endpoint}';`
    );
    expect(owner).toBe(email);

    // And it shows up in — and is described by — their data export.
    const exported = await page.request.get("/account/data");
    expect(exported.status()).toBe(200);
    const body = (await exported.json()) as { pushAlertDevices: { pushService: string }[] };
    expect(body.pushAlertDevices).toEqual([expect.objectContaining({ pushService: "push.example.com" })]);
  });

  test("the account page offers device alerts only when push is configured", async ({ page }) => {
    const enabled = await pushEnabled(page.request);
    const stamp = Date.now();
    await registerAndLogin(page, `pushui+${stamp}@example.com`, `pushui${stamp}`);
    await page.goto("/account/settings");

    await expect(page.getByRole("heading", { name: "Alerts on this device" })).toBeVisible();
    // Scoped to the section: the footer carries a second copy of the toggle.
    const toggle = page.getByRole("region", { name: "Alerts on this device" }).locator("[data-push-toggle]");
    if (enabled) {
      // Headless Chromium supports the APIs, so the control appears and
      // is off; the real subscribe cannot complete without a push service.
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
    } else {
      await expect(toggle).toHaveCount(0);
    }
  });
});
