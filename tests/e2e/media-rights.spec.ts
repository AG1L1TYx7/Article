import { test, expect, type Page } from "@playwright/test";
import { uniqueTestIp } from "./support/testIp";
import { scalar, sql } from "./support/db";
import { finishLogin, mfaColumnsSql } from "./support/staff";

const PASSWORD = "correct-horse-battery-staple";

/**
 * Audio in a story, from upload to a reader's player, and the rule that
 * nothing publishes without a credit and a licence.
 *
 * The clip is a real one-second WAV of silence built here, because the
 * upload route identifies files by their bytes and then hands them to
 * ffmpeg, which has to be able to decode them. ffmpeg comes from the
 * ffmpeg-static package, so this runs on a laptop and in CI alike.
 */
function silentWav(seconds = 1, rate = 8000): Buffer {
  const samples = seconds * rate;
  const data = samples * 2;
  const buf = Buffer.alloc(44 + data);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + data, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(data, 40);
  return buf;
}

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueTestIp() });
});

async function signInAsModerator(page: Page, prefix: string): Promise<string> {
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const email = `${prefix}+${stamp}@example.com`;
  await page.goto("/register");
  await page.fill('input[name="name"]', "Audio Producer");
  await page.fill('input[name="handle"]', `${prefix}${stamp}`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.check('input[name="consent"]');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/login/);
  sql(`UPDATE \`User\` SET role = 'MODERATOR', ${mfaColumnsSql()}, \`emailVerifiedAt\` = NOW() WHERE email = '${email}';`);
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await finishLogin(page);
  return email;
}

test.describe("Audio uploads", () => {
  test("a WAV is re-encoded to MP3, measured, served with ranges, and downloadable only when the licence allows", async ({ page }) => {
    test.slow();
    await signInAsModerator(page, "aud");

    const response = await page.request.post("/api/media/upload", {
      multipart: { file: { name: "clip.wav", mimeType: "audio/wav", buffer: silentWav(2) } },
    });
    expect(response.status(), await response.text()).toBe(201);
    const media = (await response.json()) as { id: string; url: string; type: string; durationSecs: number | null };
    expect(media.type).toBe("AUDIO");
    expect(media.url).toMatch(/\.mp3$/);
    expect(media.durationSecs).toBe(2);

    // Served as audio, seekable, inline.
    const served = await page.request.get(media.url);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toBe("audio/mpeg");
    expect(served.headers()["accept-ranges"]).toBe("bytes");
    expect(served.headers()["content-disposition"]).toBe("inline");
    const partial = await page.request.get(media.url, { headers: { Range: "bytes=0-99" } });
    expect(partial.status()).toBe(206);

    // ?download=1 is ignored until the licence permits a copy.
    const noDownload = await page.request.get(`${media.url}?download=1`);
    expect(noDownload.headers()["content-disposition"]).toBe("inline");
    sql(`UPDATE \`Media\` SET license = 'CC_BY' WHERE id = '${media.id}';`);
    const download = await page.request.get(`${media.url}?download=1`);
    expect(download.headers()["content-disposition"]).toMatch(/^attachment; filename=/);

    // The stored row knows its size, and never the bytes that were uploaded.
    expect(Number(scalar(`SELECT \`sizeBytes\` FROM \`Media\` WHERE id = '${media.id}';`))).toBeGreaterThan(1000);
    expect(scalar(`SELECT \`contentType\` FROM \`Media\` WHERE id = '${media.id}';`)).toBe("audio/mpeg");
  });
});

test.describe("Credits and licences", () => {
  test("audio goes into a story with its details, cannot publish without them, and readers get the player and credits", async ({ page }) => {
    test.slow();
    await signInAsModerator(page, "rights");
    const stamp = Date.now();
    const title = `Council interview ${stamp}`;

    await page.goto("/dashboard/articles/new");
    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.locator('[contenteditable="true"]').click();
    await page.getByRole("button", { name: "Heading", exact: true }).click();
    await page.keyboard.type("What was said");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Listen to the full conversation below.");

    // Insert audio: the file picker, then the details dialog.
    await page.getByRole("button", { name: "Insert audio" }).click();
    await page.getByTestId("editor-file-input").setInputFiles({ name: "interview.wav", mimeType: "audio/wav", buffer: silentWav(1) });
    const dialog = page.getByRole("dialog", { name: /About this audio clip/ });
    await expect(dialog).toBeVisible();

    // Nothing can be saved until the licence, the creator and the confirmation are in.
    const save = dialog.getByRole("button", { name: "Save details" });
    await expect(save).toBeDisabled();
    await dialog.getByLabel("Caption").fill("The council leader on the housing vote");
    await dialog.getByLabel("Title").fill("Interview: the housing vote");
    await dialog.getByLabel(/^Licence/).selectOption("CC_BY");
    await expect(save).toBeDisabled();
    await dialog.getByLabel(/^Creator/).fill("Priya Natarajan");
    await dialog.getByLabel("Transcript").fill("[Silence, for the test.]");
    await expect(save).toBeDisabled();
    await dialog.getByLabel(/I confirm we have the right/).check();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(dialog).toBeHidden();

    // The figure is in the editor with its credit line.
    const figure = page.locator('figure[data-kind="audio"]');
    await expect(figure).toBeVisible();
    await expect(figure).toContainText("Audio: Priya Natarajan · CC BY 4.0");

    await page.getByRole("button", { name: "Save draft" }).click();
    await page.waitForURL("/dashboard/articles");

    // Undo the confirmation behind the editor's back: publishing must refuse.
    const mediaId = scalar(
      `SELECT m.id FROM \`Media\` m JOIN \`User\` u ON u.id = m.\`uploadedById\` WHERE u.name = 'Audio Producer' AND m.title = 'Interview: the housing vote' ORDER BY m.\`createdAt\` DESC LIMIT 1;`
    );
    sql(`UPDATE \`Media\` SET \`rightsConfirmedAt\` = NULL WHERE id = '${mediaId}';`);
    const row = page.locator("tr", { hasText: title });
    await row.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText(/Every file needs a credit and licence before this can be published/)).toBeVisible();
    expect(scalar(`SELECT status FROM \`Article\` WHERE title = '${title}';`)).toBe("DRAFT");

    // Confirmed again (as the dialog would), it publishes.
    sql(`UPDATE \`Media\` SET \`rightsConfirmedAt\` = NOW(3) WHERE id = '${mediaId}';`);
    await page.reload();
    await page.locator("tr", { hasText: title }).getByRole("button", { name: "Publish" }).click();
    await expect(page.locator("tr", { hasText: title })).toContainText(/PUBLISHED/i);
    const slug = scalar(`SELECT slug FROM \`Article\` WHERE title = '${title}';`);

    // A reader: the player, the credit under the clip, the credits list,
    // the transcript, the download (CC BY allows it), and the JSON-LD.
    await page.context().clearCookies();
    await page.goto(`/article/${slug}`, { waitUntil: "networkidle" });
    const player = page.locator(`[data-audio-player="${mediaId}"]`);
    await expect(player).toBeVisible();
    await expect(player.getByRole("button", { name: "Play", exact: true })).toBeVisible();
    await expect(player.getByRole("button", { name: "Forward 15 seconds" })).toBeVisible();
    await expect(player.getByRole("link", { name: "Download" })).toHaveAttribute("href", /\?download=1$/);
    await expect(page.locator("figure[data-kind=audio] figcaption")).toContainText("Audio: Priya Natarajan · CC BY 4.0");

    const credits = page.locator("[data-media-credits]");
    await expect(credits).toContainText("Credits and licences");
    await expect(credits).toContainText("Priya Natarajan");
    await expect(credits.getByRole("link", { name: "CC BY 4.0" })).toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/");
    await credits.getByText("Transcript").click();
    await expect(credits).toContainText("[Silence, for the test.]");

    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? "{}") as {
      "@type": string;
      audio?: { "@type": string; license?: string; creditText?: string; duration?: string }[];
    };
    expect(ld["@type"]).toBe("NewsArticle");
    expect(ld.audio?.[0]).toMatchObject({ "@type": "AudioObject", license: "https://creativecommons.org/licenses/by/4.0/", creditText: "Priya Natarajan", duration: "PT1S" });

    // And the feed offers the clip as an enclosure.
    const feed = await (await page.request.get("/feed.xml")).text();
    const item = feed.slice(feed.indexOf(`<title>${title}</title>`));
    expect(item.slice(0, item.indexOf("</item>"))).toMatch(/<enclosure url="[^"]+\.mp3" length="\d+" type="audio\/mpeg" \/>/);
  });

  test("a cover image asks for its details, and publishing without them is refused", async ({ page }) => {
    test.slow();
    await signInAsModerator(page, "cover");
    const stamp = Date.now();
    const title = `Cover rights ${stamp}`;
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );

    await page.goto("/dashboard/articles/new");
    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.locator('[contenteditable="true"]').click();
    await page.keyboard.type("A story with a picture.");
    await page.getByTestId("cover-file-input").setInputFiles({ name: "pixel.png", mimeType: "image/png", buffer: png });

    // The dialog opens on its own; cancelling leaves the cover in place but uncredited.
    const dialog = page.getByRole("dialog", { name: /About this image/ });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Needs a credit and licence before publishing.")).toBeVisible();

    await page.getByRole("button", { name: "Save draft" }).click();
    await page.waitForURL("/dashboard/articles");
    await page.locator("tr", { hasText: title }).getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText(/Every file needs a credit and licence/)).toBeVisible();

    // Back in the editor, Details completes it: our own work needs only the confirmation.
    await page.locator("tr", { hasText: title }).getByRole("link", { name: title }).click();
    await page.waitForURL(/\/dashboard\/articles\/[a-z0-9]+$/);
    await page.getByRole("button", { name: "Details" }).click();
    const again = page.getByRole("dialog", { name: /About this image/ });
    await again.getByLabel(/^Alt text/).fill("A single grey pixel");
    await again.getByLabel(/^Licence/).selectOption("OWN_WORK");
    await again.getByLabel(/I confirm we have the right/).check();
    await again.getByRole("button", { name: "Save details" }).click();
    await expect(again).toBeHidden();
    await expect(page.getByText("Needs a credit and licence before publishing.")).toHaveCount(0);
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.waitForURL("/dashboard/articles");

    await page.goto("/dashboard/articles");
    await page.locator("tr", { hasText: title }).getByRole("button", { name: "Publish" }).click();
    await expect(page.locator("tr", { hasText: title })).toContainText(/PUBLISHED/i);
  });
});
