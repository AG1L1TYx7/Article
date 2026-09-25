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
 *
 * What this adds on top of the standalone output:
 *   - app.js          Passenger entry point
 *   - setup.js        migrations / seed / first admin, without the Prisma CLI
 *   - migrations/     the SQL setup.js applies
 *   - database.sql    the same schema as one file, for phpMyAdmin's Import tab
 *   - Linux builds of argon2 and sharp, whatever machine ran the build
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const OUT = "cpanel-dist";
const STANDALONE = path.join(".next", "standalone");
const MIGRATIONS = path.join("prisma", "migrations-mysql");
const CACHE = ".cpanel-cache";

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

/**
 * Remove any .env the build dragged in.
 *
 * Next's standalone output copies .env into the bundle. That file holds
 * AUTH_SECRET and the database password for THIS machine, and this
 * bundle exists to be uploaded to a server — so leaving it here ships
 * development secrets to production and, worse, silently overrides the
 * .env written on the server.
 *
 * Checked rather than assumed on every build: a future Next version
 * could add another name.
 */
const leaked = fs
  .readdirSync(OUT)
  .filter((name) => name === ".env" || name.startsWith(".env."))
  .filter((name) => name !== ".env.example");

for (const name of leaked) {
  fs.rmSync(path.join(OUT, name), { force: true });
  console.log("removed from bundle: " + name + " (local secrets, never uploaded)");
}

/**
 * Development data the tracer picks up because the code names the path.
 * The outbox log holds every email the dev server "sent", including
 * password-reset and verification links; .local-uploads is whatever was
 * uploaded while testing. Neither belongs on a server.
 */
for (const name of [".email-dev-outbox.log", ".sms-dev-outbox.log", ".local-uploads"]) {
  if (fs.existsSync(path.join(OUT, name))) {
    fs.rmSync(path.join(OUT, name), { recursive: true, force: true });
    console.log("removed from bundle: " + name + " (development data)");
  }
}

// A node_modules/.bin that Passenger might try to use is not needed, and
// shipping it only makes the upload larger.
fs.rmSync(path.join(OUT, "node_modules", ".bin"), { recursive: true, force: true });

/**
 * The database driver has to be a real package in the bundle, because
 * setup.js require()s it. next.config.ts lists it in serverExternalPackages
 * for exactly this reason; if someone removes that, this is where it shows.
 *
 * Present is not the same as working. Next traces which FILES a package
 * needs and copies only those, following one entry point. mariadb
 * publishes two — "./promise.js" for import and "./dist/promise.cjs" for
 * require — so a trace that took the ESM path ships a package whose own
 * package.json still points require() at a dist/ directory that is not
 * there. The server chunks use require(), so every query fails as "pool
 * failed to retrieve a connection from pool (active=0 idle=0 limit=10)",
 * a message that names the pool and never mentions the missing file.
 *
 * So resolve each package the way the server will, and when that fails,
 * copy the whole package over the traced one. They are small; being sure
 * is worth the megabytes.
 */
const requireFromBundle = createRequire(path.join(path.resolve(OUT), "noop.cjs"));

for (const pkg of ["mariadb", "argon2", "@next/env"]) {
  if (!fs.existsSync(path.join(OUT, "node_modules", pkg, "package.json"))) {
    fail(
      `node_modules/${pkg} is missing from the standalone output, and setup.js needs it.\n` +
        (pkg === "mariadb"
          ? "Check that next.config.ts still has serverExternalPackages: [\"mariadb\"], then rebuild."
          : "Rebuild with `npm run build` and try again.")
    );
  }

  let resolved = null;
  try {
    resolved = requireFromBundle.resolve(pkg);
  } catch {
    resolved = null;
  }
  if (resolved && fs.existsSync(resolved)) continue;

  const source = path.join("node_modules", pkg);
  if (!fs.existsSync(source)) {
    fail(`node_modules/${pkg} cannot be require()d from the bundle, and is not installed here to repair it. Run npm install and rebuild.`);
  }
  // The Linux prebuilds are copied in further down; this machine's are
  // the wrong platform and only make the upload bigger.
  fs.cpSync(source, path.join(OUT, "node_modules", pkg), {
    recursive: true,
    filter: (src) => !src.split(path.sep).includes("prebuilds"),
  });
  console.log(`repaired in bundle: ${pkg} (the traced copy could not be require()d)`);

  try {
    requireFromBundle.resolve(pkg);
  } catch (e) {
    fail(`node_modules/${pkg} still cannot be require()d after copying the whole package: ${e.message}`);
  }
}

/**
 * setup.js and the migrations it applies. The bundle carries no Prisma
 * CLI (it is a dev dependency, ~100MB, and needs the schema and generated
 * client), so this small script does the same three jobs with the driver
 * that is already here. See scripts/cpanel-setup.cjs.
 */
fs.copyFileSync(path.join("scripts", "cpanel-setup.cjs"), path.join(OUT, "setup.js"));

const migrations = fs
  .readdirSync(MIGRATIONS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => fs.existsSync(path.join(MIGRATIONS, name, "migration.sql")))
  .sort();

if (!migrations.length) fail(`No migrations found in ${MIGRATIONS}/.`);

for (const name of migrations) {
  fs.mkdirSync(path.join(OUT, "migrations", name), { recursive: true });
  fs.copyFileSync(
    path.join(MIGRATIONS, name, "migration.sql"),
    path.join(OUT, "migrations", name, "migration.sql")
  );
}

/**
 * database.sql: the whole schema as one file for phpMyAdmin's Import tab,
 * for hosts where the Terminal is disabled. It records itself in
 * _prisma_migrations the same way setup.js and Prisma do, so whichever
 * route is used, `node setup.js check` and `prisma migrate deploy` both
 * see an up-to-date database afterwards.
 */
{
  const { createHash, randomUUID } = await import("node:crypto");
  const parts = [
    "-- Generated by `npm run build:cpanel`. Import this into an EMPTY database",
    "-- with phpMyAdmin (Import tab) if you cannot run `node setup.js migrate`.",
    "-- Afterwards run `node setup.js seed` and `node setup.js admin` if you can,",
    "-- or see docs/cpanel.md for what to do without a terminal.",
    "",
    "SET NAMES utf8mb4;",
    "SET FOREIGN_KEY_CHECKS = 0;",
    "",
    "CREATE TABLE IF NOT EXISTS `_prisma_migrations` (",
    "  `id` VARCHAR(36) PRIMARY KEY NOT NULL,",
    "  `checksum` VARCHAR(64) NOT NULL,",
    "  `finished_at` DATETIME(3),",
    "  `migration_name` VARCHAR(255) NOT NULL,",
    "  `logs` TEXT,",
    "  `rolled_back_at` DATETIME(3),",
    "  `started_at` DATETIME(3) NOT NULL DEFAULT now(3),",
    "  `applied_steps_count` INTEGER UNSIGNED NOT NULL DEFAULT 0",
    ") DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;",
    "",
  ];
  for (const name of migrations) {
    const bytes = fs.readFileSync(path.join(MIGRATIONS, name, "migration.sql"));
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const steps = bytes
      .toString("utf8")
      .split(/;\s*(?:\r?\n|$)/)
      .map((chunk) => chunk.replace(/^\s*--.*$/gm, "").trim())
      .filter(Boolean).length;
    parts.push(`-- ---- migration ${name} ----`, "", bytes.toString("utf8").trim(), "");
    parts.push(
      "INSERT INTO `_prisma_migrations` (`id`, `checksum`, `finished_at`, `migration_name`, `started_at`, `applied_steps_count`)",
      `VALUES ('${randomUUID()}', '${checksum}', now(3), '${name}', now(3), ${steps});`,
      ""
    );
  }
  parts.push("SET FOREIGN_KEY_CHECKS = 1;", "");
  fs.writeFileSync(path.join(OUT, "database.sql"), parts.join("\n"));
}

/**
 * Native binaries for the server, not for this machine.
 *
 * The tracer copies only the prebuilt binary that matches the machine
 * running the build. Built on Windows, the bundle would carry win32-x64
 * builds of argon2 (every login) and sharp (every image upload), and on
 * a Linux host both would fail to load — logins with "argon2 could not
 * load", uploads with a 500. cPanel hosts are Linux x64 with glibc.
 *
 * argon2 ships every platform in its npm package, so its Linux build is
 * already in node_modules and just has to be copied. sharp puts each
 * platform in its own optional package, and npm only installs the one for
 * the current OS; the Linux ones are downloaded with `npm pack` and kept
 * in .cpanel-cache/ so repeat builds are offline.
 */
{
  const argon2Prebuilds = path.join("node_modules", "argon2", "prebuilds");
  for (const platform of ["linux-x64", "linux-arm64"]) {
    const src = path.join(argon2Prebuilds, platform);
    if (!fs.existsSync(src)) {
      if (platform === "linux-x64") fail(`node_modules/argon2/prebuilds/linux-x64 is missing. Run npm install and try again.`);
      continue;
    }
    fs.cpSync(src, path.join(OUT, "node_modules", "argon2", "prebuilds", platform), { recursive: true });
  }

  // ffmpeg-static downloads one binary per platform at install time, so
  // a Windows build has ffmpeg.exe and the server needs plain "ffmpeg".
  // Fetched from the package's own release, cached like the sharp
  // tarballs, and checked to be a real ELF file rather than an HTML
  // error page. Without it video and audio uploads are refused on the
  // server (images still work) — see docs/media.md.
  {
    const ffmpegDir = path.join("node_modules", "ffmpeg-static");
    const ffmpegPkg = JSON.parse(fs.readFileSync(path.join(ffmpegDir, "package.json"), "utf8"));
    const meta = ffmpegPkg["ffmpeg-static"] ?? {};
    const tag = meta["binary-release-tag"];
    const baseName = meta["executable-base-name"] ?? "ffmpeg";
    const dest = path.join(OUT, "node_modules", "ffmpeg-static", baseName);
    const installed = path.join(ffmpegDir, baseName);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    for (const f of ["package.json", "index.js", "LICENSE"]) {
      if (fs.existsSync(path.join(ffmpegDir, f))) fs.copyFileSync(path.join(ffmpegDir, f), path.join(path.dirname(dest), f));
    }
    let source = null;
    if (process.platform === "linux" && process.arch === "x64" && fs.existsSync(installed)) {
      source = installed;
    } else if (typeof tag === "string") {
      const cached = path.join(CACHE, `ffmpeg-${tag}-linux-x64`);
      if (!fs.existsSync(cached)) {
        fs.mkdirSync(CACHE, { recursive: true });
        const url = `https://github.com/eugeneware/ffmpeg-static/releases/download/${tag}/ffmpeg-linux-x64`;
        console.log(`downloading ffmpeg ${tag} (Linux build for the server)`);
        const res = await fetch(url, { redirect: "follow" });
        if (!res.ok) fail(`Could not download ${url}: HTTP ${res.status}. Video and audio uploads need it on the server.`);
        fs.writeFileSync(cached, Buffer.from(await res.arrayBuffer()));
      }
      source = cached;
    }
    if (!source) fail("Cannot work out which ffmpeg build to bundle; node_modules/ffmpeg-static/package.json has changed shape.");
    const head = fs.readFileSync(source).subarray(0, 4);
    if (head.toString("latin1") !== "\x7fELF") fail(`${source} is not a Linux executable (got ${JSON.stringify(head.toString("latin1"))}).`);
    fs.copyFileSync(source, dest);
    fs.chmodSync(dest, 0o755);

    /**
     * Two things the copy above does not settle.
     *
     * The traced copy brought this machine's own binary along, so a
     * Windows build ships a 79MB ffmpeg.exe the server can never run —
     * twice over, because Next keeps a second copy of the package under
     * .next/node_modules. That was 158MB of a 290MB upload.
     *
     * And at runtime require("ffmpeg-static") resolves to whichever copy
     * Next made, not the one in node_modules. ffmpeg-static returns the
     * path of the binary sitting next to its own index.js, so a copy
     * without the Linux binary reports that ffmpeg is unavailable and
     * every video and audio upload is refused, with images still working
     * — exactly the startup warning this bundle was showing.
     */
    const ffmpegCopies = [path.join(OUT, "node_modules", "ffmpeg-static")];
    const nextModules = path.join(OUT, ".next", "node_modules");
    if (fs.existsSync(nextModules)) {
      for (const entry of fs.readdirSync(nextModules)) {
        if (entry.startsWith("ffmpeg-static")) ffmpegCopies.push(path.join(nextModules, entry));
      }
    }
    for (const dir of ffmpegCopies) {
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir)) {
        if (entry.toLowerCase().endsWith(".exe")) {
          fs.rmSync(path.join(dir, entry), { force: true });
          console.log(`removed from bundle: ${path.relative(OUT, path.join(dir, entry))} (Windows binary; the server is Linux)`);
        }
      }
      const target = path.join(dir, baseName);
      if (!fs.existsSync(target)) {
        fs.copyFileSync(source, target);
        fs.chmodSync(target, 0o755);
        console.log(`placed the Linux ffmpeg in ${path.relative(OUT, dir)}`);
      }
    }
  }

  const sharpPkg = JSON.parse(fs.readFileSync(path.join("node_modules", "sharp", "package.json"), "utf8"));
  const wanted = ["@img/sharp-linux-x64", "@img/sharp-libvips-linux-x64"];
  for (const name of wanted) {
    const version = sharpPkg.optionalDependencies?.[name];
    if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
      fail(`Cannot work out which version of ${name} sharp ${sharpPkg.version} wants; node_modules/sharp/package.json has changed shape.`);
    }
    const dest = path.join(OUT, "node_modules", name);
    const installed = path.join("node_modules", name);
    if (fs.existsSync(path.join(installed, "package.json"))) {
      // Building on Linux: npm installed it already.
      fs.cpSync(installed, dest, { recursive: true });
      continue;
    }
    const tarball = path.join(CACHE, `${name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`);
    if (!fs.existsSync(tarball)) {
      fs.mkdirSync(CACHE, { recursive: true });
      console.log(`downloading ${name}@${version} (Linux build for the server)`);
      const pack = spawnSync("npm", ["pack", `${name}@${version}`, "--pack-destination", CACHE, "--silent"], {
        stdio: "inherit",
        shell: true,
      });
      if (pack.status !== 0 || !fs.existsSync(tarball)) {
        fail(
          `Could not download ${name}@${version}.\n` +
            "It is needed for image uploads on the Linux server. Check the network and try again,\n" +
            `or download it yourself with: npm pack ${name}@${version} --pack-destination ${CACHE}`
        );
      }
    }
    fs.mkdirSync(dest, { recursive: true });
    // Forward slashes: GNU tar on Windows (Git Bash) misreads backslashes.
    const posix = (p) => p.split(path.sep).join("/");
    const extract = spawnSync("tar", ["-xzf", posix(tarball), "-C", posix(dest), "--strip-components=1"], {
      stdio: "inherit",
    });
    if (extract.status !== 0) fail(`tar failed to extract ${tarball}.`);
  }

  // Prove the bundle now holds Linux code: ELF magic, not a Windows PE header.
  const sharpVersion = sharpPkg.optionalDependencies["@img/sharp-linux-x64"];
  const mustBeElf = [
    path.join(OUT, "node_modules", "argon2", "prebuilds", "linux-x64", "argon2.glibc.node"),
    path.join(OUT, "node_modules", "@img", "sharp-linux-x64", "lib", `sharp-linux-x64-${sharpVersion}.node`),
  ];
  for (const file of mustBeElf) {
    if (!fs.existsSync(file)) fail(`Expected ${file} in the bundle and it is not there.`);
    const head = Buffer.alloc(4);
    const fd = fs.openSync(file, "r");
    fs.readSync(fd, head, 0, 4, 0);
    fs.closeSync(fd);
    if (head.toString("latin1") !== "\x7fELF") fail(`${file} is not a Linux binary.`);
  }
  console.log("Linux builds of argon2 and sharp are in place (verified ELF)");
}

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
console.log("  4. In the Terminal:  node setup.js check   then   node setup.js migrate");
console.log("     node setup.js seed   and   node setup.js admin --email you@yourdomain.com");
console.log("  5. Restart the app\n");
console.log("Node 20.9 or newer is required. Older versions will not start.\n");
