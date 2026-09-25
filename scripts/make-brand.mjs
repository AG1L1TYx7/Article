/**
 * Turns the supplied logo into everything the site needs from it.
 *
 *   node scripts/make-brand.mjs
 *
 * Input:  public/brand/logo-source.png — the wordmark as delivered, on a
 *         solid black background.
 * Output: public/brand/logo.png      — the wordmark on a transparent
 *                                       background, trimmed, 1200px wide,
 *                                       for the masthead and footer
 *         public/brand/mark.png      — the "D" mark alone, square, for
 *                                       share cards
 *         public/icons/*.png         — app icons and favicon sizes
 *         src/app/favicon.ico        — the tab icon
 *
 * Committed output, not a build step, for the same reason as
 * make-icons.mjs before it: the logo changes roughly never, and a build
 * that needs image processing to produce a favicon has one more way to
 * fail.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SOURCE = path.join("public", "brand", "logo-source.png");
const BRAND = path.join("public", "brand");
const ICONS = path.join("public", "icons");
/** The plate the logo sits on: the darkest ink, not the theme token, so it is the same in both themes. */
const PLATE = { r: 11, g: 13, b: 16, alpha: 1 };

fs.mkdirSync(BRAND, { recursive: true });
fs.mkdirSync(ICONS, { recursive: true });

/**
 * Lifts the artwork off its black background.
 *
 * A pixel's alpha is how far it is from black: pure black goes fully
 * transparent, the anti-aliased edge of a letter fades, and anything
 * with real colour (the navy lines inside the D are the darkest) stays
 * opaque. Threshold chosen so the navy (blue channel ~90) is untouched.
 */
async function knockOutBlack(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const LIMIT = 40;
  for (let i = 0; i < data.length; i += 4) {
    const m = Math.max(data[i], data[i + 1], data[i + 2]);
    if (m < LIMIT) data[i + 3] = Math.round((m / LIMIT) * 255);
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

const transparent = await knockOutBlack(SOURCE);

// The full wordmark, trimmed to its ink.
await sharp(transparent).trim().resize({ width: 1200, withoutEnlargement: true }).png({ compressionLevel: 9 }).toFile(path.join(BRAND, "logo.png"));
console.log("wrote", path.join(BRAND, "logo.png"));

// The mark: everything left of the wordmark. The source is 2172 wide and
// the "D" with its fanned pages ends around x=540; the trim finds the
// exact edges from there.
// Two steps on purpose: sharp runs trim before extract within one
// pipeline, which would shrink the image and put the crop out of bounds.
const markRegion = await sharp(transparent).extract({ left: 0, top: 0, width: 560, height: 724 }).png().toBuffer();
const mark = await sharp(markRegion).trim().png().toBuffer();
const markMeta = await sharp(mark).metadata();
const side = Math.max(markMeta.width, markMeta.height);

/** The mark centred on a square plate, with `padRatio` of the side as margin. */
function onPlate(size, padRatio, radiusRatio) {
  const inner = Math.round(size * (1 - padRatio * 2));
  const scale = inner / side;
  const w = Math.round(markMeta.width * scale);
  const h = Math.round(markMeta.height * scale);
  const radius = Math.round(size * radiusRatio);
  const rounded = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="rgb(${PLATE.r},${PLATE.g},${PLATE.b})"/></svg>`
  );
  return sharp(rounded)
    .composite([{ input: mark, top: Math.round((size - h) / 2), left: Math.round((size - w) / 2), blend: "over" }])
    .png();
}

// composite needs the overlay already at the right size; resize first.
async function plateWithResizedMark(size, padRatio, radiusRatio) {
  const inner = Math.round(size * (1 - padRatio * 2));
  const resized = await sharp(mark).resize({ width: inner, height: inner, fit: "inside" }).png().toBuffer();
  const meta = await sharp(resized).metadata();
  const radius = Math.round(size * radiusRatio);
  const plate = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="rgb(${PLATE.r},${PLATE.g},${PLATE.b})"/></svg>`
  );
  return sharp(plate).composite([{ input: resized, top: Math.round((size - meta.height) / 2), left: Math.round((size - meta.width) / 2) }]).png();
}
void onPlate;

await (await plateWithResizedMark(512, 0.12, 0)).toFile(path.join(BRAND, "mark.png"));
console.log("wrote", path.join(BRAND, "mark.png"));

const jobs = [
  // name, size, padding, corner radius (0 = square; launchers round their own)
  ["icon-192.png", 192, 0.12, 0],
  ["icon-512.png", 512, 0.12, 0],
  // Maskable icons get cropped to a circle or squircle; keep the mark
  // inside the central 80%.
  ["maskable-512.png", 512, 0.2, 0],
  ["apple-touch-icon.png", 180, 0.16, 0],
  ["favicon-32.png", 32, 0.08, 0],
];
for (const [name, size, pad, radius] of jobs) {
  await (await plateWithResizedMark(size, pad, radius)).toFile(path.join(ICONS, name));
  console.log("wrote", path.join(ICONS, name));
}

// favicon.ico: an ICO container holding one 32px PNG, which every
// browser since Vista reads. Written by hand — it is 22 bytes of header.
const png32 = await (await plateWithResizedMark(32, 0.08, 0)).toBuffer();
const header = Buffer.alloc(6 + 16);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // one image
header.writeUInt8(32, 6); // width
header.writeUInt8(32, 7); // height
header.writeUInt8(0, 8); // palette
header.writeUInt8(0, 9); // reserved
header.writeUInt16LE(1, 10); // colour planes
header.writeUInt16LE(32, 12); // bits per pixel
header.writeUInt32LE(png32.length, 14); // image bytes
header.writeUInt32LE(22, 18); // offset of the image data
fs.writeFileSync(path.join("src", "app", "favicon.ico"), Buffer.concat([header, png32]));
console.log("wrote src/app/favicon.ico");
