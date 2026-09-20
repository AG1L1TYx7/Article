/**
 * Assembles a cPanel-ready bundle from an existing production build.
 *
 *   npm run build
 *   npm run build:cpanel
 *
 * cPanel's "Setup Node.js App" runs Phusion Passenger, which wants one
 * directory containing an entry file and everything the app needs. Next's
 * standalone output is almost that, but it deliberately leaves out the
 * static assets and public/ — so uploading .next/standalone on its own
 * gives a site with no CSS, no JavaScript and no images, which looks like
 * a broken deployment rather than a missing copy step.
 *
 * Why build here and upload the result, rather than building on the
 * server: `next build` wants roughly 2GB of RAM, and shared hosting
 * usually caps a process well below that. The build gets killed with no
 * useful error.
 */
import fs from "node:fs";
import path from "node:path";

const OUT = "cpanel-dist";
const STANDALONE = path.join(".next", "standalone");

function fail(message) {
  console.error("\n" + message + "\n");
  process.exit(1);
}

if (!fs.existsSync(STANDALONE)) {
  fail(
    "No .next/standalone directory. Run `npm run build` first.\n" +
      "If that produced nothing, check next.config.ts still sets output: \"standalone\"."
  );
}

// Start clean so a stale file from a previous bundle cannot ship.
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

fs.cpSync(STANDALONE, OUT, { recursive: true });
fs.cpSync(path.join(".next", "static"), path.join(OUT, ".next", "static"), { recursive: true });
if (fs.existsSync("public")) {
  fs.cpSync("public", path.join(OUT, "public"), { recursive: true });
}

/**
 * Passenger picks the entry file by name and does not pass arguments, so
 * anything the app needs has to be set here rather than on a command
 * line. It provides PORT; everything else comes from the .env file that
 * is created on the server.
 */
fs.writeFileSync(
  path.join(OUT, "app.js"),
  `// Entry point for cPanel's "Setup Node.js App" (Phusion Passenger).
//
// Passenger starts this file directly and supplies PORT. It does not read
// package.json scripts, so nothing here can depend on npm start.
process.env.NODE_ENV = "production";

// Bind to localhost only. Passenger proxies to the app; anything else
// would expose it directly, and this application trusts X-Forwarded-For
// for rate limiting — see docs/deployment.md.
process.env.HOSTNAME = process.env.HOSTNAME || "127.0.0.1";

require("./server.js");
`
);

// A node_modules/.bin that Passenger might try to use is not needed, and
// shipping it only makes the upload larger.
fs.rmSync(path.join(OUT, "node_modules", ".bin"), { recursive: true, force: true });

function sizeOf(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) {
      total += fs.statSync(path.join(entry.parentPath ?? entry.path, entry.name)).size;
    }
  }
  return total;
}

const megabytes = (sizeOf(OUT) / 1024 / 1024).toFixed(0);

console.log(`\ncPanel bundle ready in ${OUT}/  (${megabytes} MB)\n`);
console.log("Next steps — the full walkthrough is in docs/cpanel.md:");
console.log("  1. Upload the contents of this directory to your app root on the server");
console.log("  2. Create .env there (never upload your local one)");
console.log("  3. In cPanel, Setup Node.js App -> Application startup file: app.js");
console.log("  4. Run the migrations, then Restart\n");
console.log("Node 20.9 or newer is required. Older versions will not start.\n");
