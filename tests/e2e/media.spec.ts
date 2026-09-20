import { test, expect, type Page } from "@playwright/test";
import { uniqueTestIp } from "./support/testIp";
import { sql } from "./support/db";

const PASSWORD = "correct-horse-battery-staple";

const promoteTo = (role: string, email: string) =>
  sql(`UPDATE "User" SET role = '${role}' WHERE email = '${email}';`);
const markEmailVerified = (email: string) =>
  sql(`UPDATE "User" SET "emailVerifiedAt" = NOW() WHERE email = '${email}';`);

/**
 * A real 1x1 PNG. It has to be genuine: the upload route identifies files
 * by magic bytes rather than by filename or the declared Content-Type, so
 * invented bytes are rejected before anything else happens.
 */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestIp() });
});

async function signInAsModerator(page: Page) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `media+${stamp}@example.com`;

  await page.goto("/register");
  await page.fill('input[name="name"]', "Media Test Author");
  await page.fill('input[name="handle"]', `media${stamp}`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/login/);

  promoteTo("MODERATOR", email);
  markEmailVerified(email);

  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

/** Uploads the test image and returns the URL it is served from. */
async function uploadImage(page: Page): Promise<string> {
  const response = await page.request.post("/api/media/upload", {
    multipart: {
      file: { name: "pixel.png", mimeType: "image/png", buffer: TINY_PNG },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const body = (await response.json()) as { url: string };
  return body.url;
}

test.describe("Serving uploaded media", () => {
  test("an uploaded image is served with the headers user content needs", async ({ page }) => {
    await signInAsModerator(page);
    const url = await uploadImage(page);

    const response = await page.request.get(url);
    expect(response.status()).toBe(200);

    const headers = response.headers();
    expect(headers["content-type"]).toContain("image/webp");
    // Without nosniff, a browser can decide an uploaded file is HTML and
    // execute it — the content-sniffing attack that re-encoding exists to
    // defend against. src/proxy.ts does not cover /media, so this route
    // has to set it itself.
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["content-security-policy"]).toContain("default-src 'none'");
    expect(headers["content-disposition"]).toBe("inline");
    // How a player learns it is allowed to seek at all.
    expect(headers["accept-ranges"]).toBe("bytes");
  });

  test("a range request gets exactly those bytes back", async ({ page }) => {
    // This is what a <video> element does. Without it seeking is
    // impossible, and Safari refuses to play at all.
    await signInAsModerator(page);
    const url = await uploadImage(page);

    const whole = await page.request.get(url);
    const full = await whole.body();

    const partial = await page.request.get(url, { headers: { Range: "bytes=0-9" } });
    expect(partial.status()).toBe(206);
    expect(partial.headers()["content-range"]).toBe(`bytes 0-9/${full.length}`);

    const slice = await partial.body();
    expect(slice.length).toBe(10);
    // The right ten bytes, not just ten bytes.
    expect(slice.equals(full.subarray(0, 10))).toBe(true);
  });

  test("a suffix range returns the end of the file", async ({ page }) => {
    await signInAsModerator(page);
    const url = await uploadImage(page);

    const whole = await page.request.get(url);
    const full = await whole.body();

    const partial = await page.request.get(url, { headers: { Range: "bytes=-5" } });
    expect(partial.status()).toBe(206);
    const slice = await partial.body();
    expect(slice.equals(full.subarray(full.length - 5))).toBe(true);
  });

  test("a range past the end of the file is refused, not silently clamped", async ({ page }) => {
    await signInAsModerator(page);
    const url = await uploadImage(page);

    const response = await page.request.get(url, { headers: { Range: "bytes=999999-" } });
    expect(response.status()).toBe(416);
    expect(response.headers()["content-range"]).toMatch(/^bytes \*\/\d+$/);
  });

  test("an unknown key is a 404", async ({ page }) => {
    const response = await page.request.get("/media/definitely-not-a-real-key.webp");
    expect(response.status()).toBe(404);
  });
});
