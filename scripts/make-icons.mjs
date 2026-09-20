/**
 * Generates the app icons in public/icons from the wordmark.
 *
 *   node scripts/make-icons.mjs
 *
 * Run again after changing the palette or the initial. Committed output,
 * not a build step: the icons change roughly never, and a build that
 * needs sharp to produce a favicon is a build with one more way to fail.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const OUT = path.join("public", "icons");
fs.mkdirSync(OUT, { recursive: true });

// A serif "D" on paper, with the editorial red as a rule beneath — the
// same shapes the masthead uses.
function svg(size, { maskable = false } = {}) {
  // Maskable icons get cropped to a circle or squircle by the launcher;
  // keep the mark inside the central 80% so nothing is cut off.
  const pad = maskable ? size * 0.2 : size * 0.1;
  const inner = size - pad * 2;
  const fontSize = inner * 0.78;
  const rule = Math.max(4, Math.round(size * 0.035));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${maskable ? 0 : size * 0.18}" fill="#faf8f4"/>
    <text x="50%" y="${pad + inner * 0.7}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-weight="600" font-size="${fontSize}" fill="#17140f">D</text>
    <rect x="${pad + inner * 0.22}" y="${pad + inner * 0.86}" width="${inner * 0.56}" height="${rule}" fill="#b7271f"/>
  </svg>`;
}

const jobs = [
  ["icon-192.png", 192, {}],
  ["icon-512.png", 512, {}],
  ["maskable-512.png", 512, { maskable: true }],
  ["apple-touch-icon.png", 180, { maskable: true }],
  ["favicon-32.png", 32, {}],
];

for (const [name, size, opts] of jobs) {
  await sharp(Buffer.from(svg(size, opts))).png().toFile(path.join(OUT, name));
  console.log("wrote", path.join(OUT, name));
}
