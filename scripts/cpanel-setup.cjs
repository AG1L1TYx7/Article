/**
 * First-run database setup for a cPanel deployment.
 *
 * Copied into the bundle as setup.js by scripts/build-cpanel.mjs. It
 * exists because the three things a fresh install needs — migrations, the
 * starter categories and the first admin account — normally go through
 * the Prisma CLI, tsx and the project source, none of which are in the
 * bundle. cPanel's Terminal has Node and nothing else, so this file uses
 * only what the bundle already carries: the mariadb driver, argon2 and
 * @next/env.
 *
 *   node setup.js check                        connect and report problems
 *   node setup.js migrate                      apply pending migrations
 *   node setup.js seed                         starter categories
 *   node setup.js admin --email you@site.com   first admin (prints a password once)
 *
 * DATABASE_URL comes from .env in this directory, read the same way the
 * app reads it. Migrations are recorded in _prisma_migrations exactly as
 * Prisma records them — same checksum, same columns — so running
 * `prisma migrate deploy` from a development machine later agrees with
 * what happened here instead of trying to apply everything twice.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomBytes, randomUUID } = require("node:crypto");

const ROOT = __dirname;
const MIGRATIONS_DIR = path.join(ROOT, "migrations");
const MIN_NODE = [20, 9];

// Prisma's own definition of this table, so the rows are interchangeable.
const MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS \`_prisma_migrations\` (
  \`id\` VARCHAR(36) PRIMARY KEY NOT NULL,
  \`checksum\` VARCHAR(64) NOT NULL,
  \`finished_at\` DATETIME(3),
  \`migration_name\` VARCHAR(255) NOT NULL,
  \`logs\` TEXT,
  \`rolled_back_at\` DATETIME(3),
  \`started_at\` DATETIME(3) NOT NULL DEFAULT now(3),
  \`applied_steps_count\` INTEGER UNSIGNED NOT NULL DEFAULT 0
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`;

// Mirrors prisma/seed.ts. Idempotent: a category that already exists is
// left exactly as the newsroom has edited it.
const CATEGORIES = [
  { slug: "world", name: "World", description: "International news and reporting" },
  { slug: "politics", name: "Politics", description: "Government, policy and elections" },
  { slug: "business", name: "Business", description: "Markets, companies and the economy" },
  { slug: "technology", name: "Technology", description: "Tech industry and science" },
  { slug: "culture", name: "Culture", description: "Arts, media and society" },
  { slug: "sport", name: "Sport", description: "Results, analysis and features" },
];

function fail(message) {
  console.error("\n" + message + "\n");
  process.exit(1);
}

function arg(name) {
  const i = process.argv.indexOf("--" + name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

// Same shape Prisma's cuid() produces (25 chars starting with c), so ids
// made here are indistinguishable from ones the app makes.
function cuid() {
  return "c" + randomBytes(16).toString("hex").slice(0, 24);
}

function loadEnv() {
  try {
    // The same loader the app uses, so precedence (.env.production.local
    // over .env.local over .env) is identical.
    require("@next/env").loadEnvConfig(ROOT, false, { info() {}, error: console.error });
    return;
  } catch {
    // Fall through to a plain reader.
  }
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (line.trim().startsWith("#")) continue;
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

function connectionOptions() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    fail(
      "DATABASE_URL is not set.\n" +
        "Create .env in " + ROOT + " with a line like\n" +
        '  DATABASE_URL="mysql://cpaneluser_db:password@localhost:3306/cpaneluser_news"\n' +
        "See docs/cpanel.md, step 4."
    );
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail("DATABASE_URL is not a valid URL. Expected mysql://user:password@host:3306/database");
  }
  if (url.protocol !== "mysql:" && url.protocol !== "mariadb:") {
    fail("DATABASE_URL must start with mysql:// — this build uses MySQL, not " + url.protocol.replace(":", ""));
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) {
    fail("DATABASE_URL has no database name after the host. Expected mysql://user:password@host:3306/database");
  }

  const options = {
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    connectTimeout: 10_000,
    // One statement per query. Migrations are split up and run one at a
    // time so a failure names the statement that broke.
    multipleStatements: false,
  };
  const socket = url.searchParams.get("socket");
  if (socket) {
    options.socketPath = socket;
  } else {
    options.host = url.hostname || "localhost";
    options.port = Number(url.port) || 3306;
  }
  return options;
}

function requireFromBundle(name, why) {
  try {
    return require(name);
  } catch (err) {
    fail(
      "Cannot load the " + name + " package (" + why + ").\n" +
        "This bundle appears incomplete — rebuild it with `npm run build && npm run build:cpanel`\n" +
        "and upload the whole contents of cpanel-dist/ again.\n\n" +
        (err && err.message ? err.message : String(err))
    );
  }
}

async function connect() {
  const mariadb = requireFromBundle("mariadb", "database driver");
  const options = connectionOptions();
  const where = options.socketPath ? options.socketPath : options.host + ":" + options.port;
  try {
    return await mariadb.createConnection(options);
  } catch (err) {
    const code = err && err.code;
    if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ETIMEDOUT") {
      fail(
        "Nothing is answering at " + where + ".\n" +
          "On cPanel the database is almost always localhost:3306. Check the host and port in DATABASE_URL."
      );
    }
    if (code === "ER_ACCESS_DENIED_ERROR" || err.errno === 1045) {
      fail(
        "MySQL rejected the username or password for " + options.user + "@" + where + ".\n" +
          "cPanel prefixes database users with your account name (acct_user, not user), and the user\n" +
          "must be added to the database with ALL PRIVILEGES under MySQL Databases.\n" +
          "A password with @ : / or % in it must be URL-encoded in DATABASE_URL."
      );
    }
    if (code === "ER_BAD_DB_ERROR" || err.errno === 1049) {
      fail(
        "Database " + JSON.stringify(options.database) + " does not exist on " + where + ".\n" +
          "cPanel prefixes database names with your account name, so the full name is\n" +
          "something like acct_news. Copy it exactly from MySQL Databases."
      );
    }
    fail("Could not connect to " + where + ":\n" + (err && err.message ? err.message : String(err)));
  }
}

// ---------------------------------------------------------------------------
// migrate

function localMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    fail("No migrations/ directory next to setup.js. The bundle is incomplete — rebuild and re-upload it.");
  }
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(MIGRATIONS_DIR, name, "migration.sql")))
    .sort()
    .map((name) => {
      const bytes = fs.readFileSync(path.join(MIGRATIONS_DIR, name, "migration.sql"));
      return { name, sql: bytes.toString("utf8"), checksum: sha256(bytes) };
    });
}

// Prisma writes one statement per line-terminated semicolon, with `--`
// comment lines between them.
function statementsOf(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((chunk) => chunk.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
}

async function migrationState(conn) {
  await conn.query(MIGRATIONS_TABLE);
  const rows = await conn.query(
    "SELECT migration_name, checksum, finished_at, rolled_back_at, logs FROM `_prisma_migrations` ORDER BY started_at"
  );
  const failed = rows.find((row) => !row.finished_at && !row.rolled_back_at);
  const applied = new Map();
  for (const row of rows) {
    if (row.finished_at && !row.rolled_back_at) applied.set(row.migration_name, row);
  }
  const local = localMigrations();
  const pending = local.filter((m) => !applied.has(m.name));
  const edited = local.filter((m) => applied.has(m.name) && applied.get(m.name).checksum !== m.checksum);
  return { local, applied, pending, failed, edited };
}

async function migrate(conn) {
  const resolveApplied = arg("resolve-applied");
  const resolveRolledBack = arg("resolve-rolled-back");
  if (resolveApplied || resolveRolledBack) {
    const name = resolveApplied || resolveRolledBack;
    const result = resolveApplied
      ? await conn.query(
          "UPDATE `_prisma_migrations` SET finished_at = now(3), logs = NULL WHERE migration_name = ? AND finished_at IS NULL AND rolled_back_at IS NULL",
          [name]
        )
      : await conn.query(
          "UPDATE `_prisma_migrations` SET rolled_back_at = now(3) WHERE migration_name = ? AND finished_at IS NULL AND rolled_back_at IS NULL",
          [name]
        );
    if (!result.affectedRows) fail("No failed migration named " + name + " to resolve.");
    console.log("Marked " + name + (resolveApplied ? " as applied." : " as rolled back; it will be re-applied now."));
    if (resolveApplied) return;
  }

  const state = await migrationState(conn);

  if (state.failed) {
    fail(
      "Migration " + state.failed.migration_name + " failed part-way through on a previous run:\n\n" +
        "  " + String(state.failed.logs || "(no error recorded)").split("\n").join("\n  ") + "\n\n" +
        "MySQL cannot roll back schema changes, so the database is in between two versions.\n" +
        "Either fix it by hand and run\n" +
        "  node setup.js migrate --resolve-applied " + state.failed.migration_name + "\n" +
        "if you completed the migration yourself, or undo what it did and run\n" +
        "  node setup.js migrate --resolve-rolled-back " + state.failed.migration_name + "\n" +
        "to have it applied again from the start."
    );
  }

  if (state.edited.length) {
    fail(
      "These migrations were changed after they were applied to this database:\n" +
        state.edited.map((m) => "  " + m.name).join("\n") + "\n\n" +
        "Refusing to continue: the database and the files no longer describe the same schema.\n" +
        "Migrations are never edited once applied; a change is a new migration."
    );
  }

  if (!state.pending.length) {
    console.log(
      "Database is up to date (" + state.applied.size + " migration" + (state.applied.size === 1 ? "" : "s") + " applied)."
    );
    return;
  }

  for (const migration of state.pending) {
    const id = randomUUID();
    await conn.query(
      "INSERT INTO `_prisma_migrations` (id, checksum, migration_name, started_at, applied_steps_count) VALUES (?, ?, ?, now(3), 0)",
      [id, migration.checksum, migration.name]
    );
    let steps = 0;
    try {
      for (const statement of statementsOf(migration.sql)) {
        await conn.query(statement);
        steps += 1;
        await conn.query("UPDATE `_prisma_migrations` SET applied_steps_count = ? WHERE id = ?", [steps, id]);
      }
      await conn.query("UPDATE `_prisma_migrations` SET finished_at = now(3) WHERE id = ?", [id]);
      console.log("applied " + migration.name + " (" + steps + " statements)");
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      await conn.query("UPDATE `_prisma_migrations` SET logs = ? WHERE id = ?", [message, id]);
      fail(
        "Migration " + migration.name + " failed at statement " + (steps + 1) + ":\n\n  " + message + "\n\n" +
          "It has been recorded as failed. Run `node setup.js migrate` again to see how to resolve it."
      );
    }
  }
  console.log("Done: " + state.pending.length + " migration" + (state.pending.length === 1 ? "" : "s") + " applied.");
}

// ---------------------------------------------------------------------------
// seed

async function seed(conn) {
  let created = 0;
  for (const category of CATEGORIES) {
    const result = await conn.query(
      "INSERT IGNORE INTO `Category` (id, slug, name, description) VALUES (?, ?, ?, ?)",
      [cuid(), category.slug, category.name, category.description]
    );
    created += result.affectedRows;
  }
  console.log(
    created
      ? "Created " + created + " categories."
      : "All " + CATEGORIES.length + " starter categories already exist; nothing changed."
  );
}

// ---------------------------------------------------------------------------
// admin  (mirrors scripts/bootstrap-staff.ts)

async function admin(conn) {
  const email = (arg("email") || "").toLowerCase();
  const role = (arg("role") || "ADMIN").toUpperCase();
  const name = arg("name") || "Newsroom Staff";

  if (!email.includes("@")) fail("Pass a real address: node setup.js admin --email you@yourdomain.com");
  if (role !== "ADMIN" && role !== "MODERATOR") fail("--role must be ADMIN or MODERATOR");

  const password = arg("password") || process.env.STAFF_PASSWORD || randomBytes(12).toString("base64url");
  const generated = !arg("password") && !process.env.STAFF_PASSWORD;
  if (password.length < 12) fail("Password must be at least 12 characters");

  // The role row behind the requested tier. Both are seeded by a
  // migration and cannot be deleted, so this resolves on any database
  // that has been migrated — and says so plainly on one that has not.
  const roleRow = (
    await conn.query("SELECT id FROM `UserRole` WHERE `key` = ?", [
      role === "ADMIN" ? "admin" : "moderator",
    ])
  )[0];
  if (!roleRow) {
    fail(
      "The built-in roles are missing. Run `node setup.js migrate` first, then try this again."
    );
  }
  const roleId = roleRow.id;

  const existing = (await conn.query("SELECT id, role, emailVerifiedAt FROM `User` WHERE email = ?", [email]))[0];

  if (existing) {
    // Promote the account they already registered; never touch its password.
    await conn.query(
      "UPDATE `User` SET role = ?, roleId = ?, status = 'ACTIVE', emailVerifiedAt = COALESCE(emailVerifiedAt, UTC_TIMESTAMP(3)), updatedAt = UTC_TIMESTAMP(3) WHERE id = ?",
      [role, roleId, existing.id]
    );
    console.log("\nPromoted " + email);
    console.log("  role:  " + role);
    console.log("  email: verified");
    console.log("  password: unchanged (existing account)");
  } else {
    const argon2 = requireFromBundle("argon2", "password hashing");
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    const handleBase = email.split("@")[0].replace(/[^a-z0-9_-]/g, "").slice(0, 24) || "staff";
    const taken = (await conn.query("SELECT 1 FROM `User` WHERE handle = ?", [handleBase])).length > 0;
    const handle = taken ? handleBase + "-" + randomBytes(2).toString("hex") : handleBase;

    // mustChangePassword: the site asks for a new password at first
    // sign-in, since this one was made up here rather than chosen.
    await conn.query(
      "INSERT INTO `User` (id, email, name, handle, passwordHash, role, roleId, emailVerifiedAt, mustChangePassword, createdAt, updatedAt) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [cuid(), email, name, handle, passwordHash, role, roleId]
    );
    console.log("\nCreated " + email);
    console.log("  role:  " + role);
    console.log("  email: verified");
    if (generated) {
      console.log("\n  password: " + password);
      console.log("  ^ shown once. Change it after your first login.");
    }
  }
  if (role === "ADMIN") {
    console.log("\nAdmins must set up two-factor auth before using the dashboard.");
    console.log("Log in and you'll be sent straight to /dashboard/mfa to scan a QR code.");
  }
}

// ---------------------------------------------------------------------------
// check

function nodeIsNewEnough() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
}

async function check(conn) {
  const problems = [];
  console.log("Node " + process.version + (nodeIsNewEnough() ? "" : "  <-- too old, needs 20.9+"));
  if (!nodeIsNewEnough()) {
    problems.push("Node " + process.version + " is too old. Pick 20.9 or newer in Setup Node.js App.");
  }

  const version = (await conn.query("SELECT VERSION() AS v"))[0].v;
  console.log("MySQL " + version + "  (connected)");

  const tokenSize = (await conn.query("SHOW VARIABLES LIKE 'innodb_ft_min_token_size'"))[0];
  const size = tokenSize ? Number(tokenSize.Value) : NaN;
  console.log(
    "innodb_ft_min_token_size = " + (Number.isNaN(size) ? "unknown" : size) + (size > 2 ? "  <-- see below" : "")
  );
  if (size > 2) {
    problems.push(
      "innodb_ft_min_token_size is " + size + ". Words shorter than that (AI, EU, US, UN) are unsearchable.\n" +
        "  Ask your host to set it to 2 in my.cnf and restart MySQL; it cannot be changed from here."
    );
  }

  const state = await migrationState(conn);
  if (state.failed) {
    console.log("migrations: FAILED at " + state.failed.migration_name);
    problems.push("A migration failed part-way. Run `node setup.js migrate` for the details.");
  } else if (state.pending.length) {
    console.log("migrations: " + state.pending.length + " pending  <-- run: node setup.js migrate");
    problems.push(state.pending.length + " migration(s) not applied yet. Run `node setup.js migrate`.");
  } else {
    console.log("migrations: up to date (" + state.applied.size + " applied)");
  }

  if (!state.pending.length && !state.failed) {
    const categories = Number((await conn.query("SELECT COUNT(*) AS n FROM `Category`"))[0].n);
    const staff = Number(
      (await conn.query("SELECT COUNT(*) AS n FROM `User` WHERE role IN ('ADMIN','MODERATOR')"))[0].n
    );
    console.log("categories: " + categories + (categories ? "" : "  <-- run: node setup.js seed"));
    console.log(
      "staff accounts: " + staff + (staff ? "" : "  <-- run: node setup.js admin --email you@yourdomain.com")
    );
  }

  for (const [key, hint] of [
    ["AUTH_SECRET", "openssl rand -base64 32"],
    ["NEXTAUTH_URL", "https://yourdomain.com"],
  ]) {
    const value = process.env[key];
    const bad = !value || value.includes("generate-with") || value.includes("example");
    console.log(key + ": " + (bad ? "MISSING  <-- set it in .env (" + hint + ")" : "set"));
    if (bad) problems.push(key + " is not set in .env.");
  }
  if (process.env.NEXTAUTH_URL && process.env.NEXTAUTH_URL.startsWith("http://localhost")) {
    problems.push("NEXTAUTH_URL still points at localhost. It must be the public https:// address of the site.");
  }

  if (problems.length) {
    console.log("\n" + problems.length + " thing" + (problems.length === 1 ? "" : "s") + " to fix:\n");
    for (const problem of problems) console.log("- " + problem);
    console.log("");
    process.exit(1);
  }
  console.log("\nEverything checks out. Restart the app in Setup Node.js App and open the site.\n");
}

// ---------------------------------------------------------------------------

const COMMANDS = { check, migrate, seed, admin };

async function main() {
  const command = process.argv[2];
  const run = Object.prototype.hasOwnProperty.call(COMMANDS, command) ? COMMANDS[command] : undefined;
  if (!run) {
    console.log(
      "Usage:\n  node setup.js check\n  node setup.js migrate\n  node setup.js seed\n" +
        '  node setup.js admin --email you@yourdomain.com [--role ADMIN|MODERATOR] [--name "Full Name"]\n'
    );
    process.exit(command ? 1 : 0);
  }
  loadEnv();
  const conn = await connect();
  try {
    await run(conn);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  fail(err && err.message ? err.message : String(err));
});
