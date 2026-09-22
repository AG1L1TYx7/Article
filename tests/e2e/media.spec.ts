import { test, expect, type Page } from "@playwright/test";
import { uniqueTestIp } from "./support/testIp";
import { count, sql } from "./support/db";
import { finishLogin, mfaColumnsSql } from "./support/staff";

const PASSWORD = "correct-horse-battery-staple";

const promoteTo = (role: string, email: string) =>
  sql(`UPDATE \`User\` SET role = '${role}'${role === "MODERATOR" ? `, ${mfaColumnsSql()}` : ""} WHERE email = '${email}';`);
const markEmailVerified = (email: string) =>
  sql(`UPDATE \`User\` SET \`emailVerifiedAt\` = NOW() WHERE email = '${email}';`);

/**
 * A real 1x1 PNG. It has to be genuine: the upload route identifies files
 * by magic bytes rather than by filename or the declared Content-Type, so
 * invented bytes are rejected before anything else happens.
 */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/**
 * A minimal but genuinely detectable MP4: an ftyp box is what file-type
 * matches on. It is not playable, which is the point — the upload is
 * refused before anything would try to play it.
 */
const TINY_MP4 = Buffer.from(
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
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

test.describe("Uploading", () => {
  test("video is refused outright when no scanner is configured", async ({ page }) => {
    // It used to be stored and marked PENDING. That was safe only on
    // local disk: with S3 configured, Media.url points straight at the
    // bucket and this app's media route is not in the path at all, so an
    // unscanned video was publicly readable. Refusing is the only
    // behaviour that is true on both backends.
    await signInAsModerator(page);

    const response = await page.request.post("/api/media/upload", {
      multipart: { file: { name: "clip.mp4", mimeType: "video/mp4", buffer: TINY_MP4 } },
    });

    expect(response.status()).toBe(503);
    expect((await response.json()).error).toContain("no malware scanner is configured");

    // And nothing was written: no row, so nothing to serve or clean up.
    expect(count(`SELECT count(*) FROM \`Media\` WHERE type = 'VIDEO';`)).toBe(0);
  });

  test("a file that is not an image or video is refused", async ({ page }) => {
    // Identified by magic bytes, so naming it .png changes nothing.
    await signInAsModerator(page);

    const response = await page.request.post("/api/media/upload", {
      multipart: {
        file: { name: "payload.png", mimeType: "image/png", buffer: Buffer.from("<html>hi</html>") },
      },
    });

    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain("Unsupported file type");
  });

  test("direct upload reports that it is unavailable on local disk", async ({ page }) => {
    // There is nothing to pre-sign without object storage, and the client
    // falls back to posting through the server.
    await signInAsModerator(page);

    const response = await page.request.post("/api/media/upload-url", {
      data: { extension: "mp4", size: 1024 },
    });

    expect(response.status()).toBe(501);
    expect((await response.json()).fallback).toBe("/api/media/upload");
  });

  test("finalize refuses a key this server never issued", async ({ page }) => {
    // Without this check, finalize would fetch and process any object
    // named by any moderator.
    await signInAsModerator(page);

    for (const storageKey of [
      "quarantine/../../etc/passwd",
      "some-live-media-key.webp",
      "quarantine/not-a-uuid.mp4",
    ]) {
      const response = await page.request.post("/api/media/finalize", {
        data: { storageKey, token: "anything" },
      });
      expect(response.status(), storageKey).toBe(400);
    }
  });

  test("finalize refuses a well-formed key without a valid token", async ({ page }) => {
    await signInAsModerator(page);

    const response = await page.request.post("/api/media/finalize", {
      data: {
        storageKey: "quarantine/3f2504e0-4f89-11d3-9a0c-0305e82c3301.mp4",
        token: "forged.signature",
      },
    });
    expect(response.status()).toBe(400);
  });

  test("a signed-out visitor cannot request an upload URL or finalize", async ({ page }) => {
    const ticket = await page.request.post("/api/media/upload-url", { data: { extension: "mp4" } });
    expect(ticket.status()).toBe(401);

    const finalize = await page.request.post("/api/media/finalize", {
      data: { storageKey: "quarantine/3f2504e0-4f89-11d3-9a0c-0305e82c3301.mp4", token: "x" },
    });
    expect(finalize.status()).toBe(401);
  });
});
