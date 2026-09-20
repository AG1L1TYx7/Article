/**
 * Restores a dump made by backup-db.mjs into the database DATABASE_URL
 * points at.
 *
 *   npm run db:restore -- --file backups/news_platform-2026-09-20T22-30-00Z.sql.gz
 *   npm run db:restore -- --file ... --confirm
 *
 * Without --confirm it only says what it would do. With it, every table
 * in the target database is dropped and recreated from the dump — this
 * is a restore, not a merge. Restoring into the live database is the
 * disaster case; the routine use is a restore into an empty scratch
 * database to prove the backup is good (docs/operations.md).
 *
 * The dump's own CREATE TABLE statements carry the schema, so no
 * migration step is needed afterwards; _prisma_migrations comes back
 * with everything else and `prisma migrate deploy` will report nothing
 * to do.
 */
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { clientArgs, clientEnv, parseDatabaseUrl } from "./dbUrl.mjs";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

function findClient() {
  const explicit = process.env.MYSQL;
  if (explicit) return explicit;
  for (const candidate of ["mysql", "mariadb", "C:/xampp/mysql/bin/mysql.exe"]) {
    const probe = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (probe.status === 0) return candidate;
  }
  throw new Error("Could not find the mysql client on PATH. Set MYSQL to its full path.");
}

const file = arg("--file");
if (!file || !existsSync(file)) {
  console.error("Pass --file <path to a .sql or .sql.gz dump>.");
  process.exit(2);
}
const confirm = process.argv.includes("--confirm");
const conn = parseDatabaseUrl();
const client = findClient();

console.log(`Restore ${file} (${(statSync(file).size / 1024).toFixed(0)} KB)`);
console.log(`   into ${conn.database} on ${conn.host}:${conn.port} as ${conn.user}`);

if (!confirm) {
  console.log("\nDry run. Every table in that database would be replaced by the dump's contents.");
  console.log("Re-run with --confirm to do it.");
  process.exit(0);
}

// Make sure the database exists (a scratch restore usually starts from
// nothing), then stream the dump in. The dump itself drops and recreates
// each table.
const create = spawnSync(
  client,
  [...clientArgs(conn), "-e", `CREATE DATABASE IF NOT EXISTS \`${conn.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`],
  { env: clientEnv(conn), encoding: "utf8" }
);
if (create.status !== 0) {
  console.error(create.stderr.trim() || "Could not create the database.");
  process.exit(1);
}

const restore = spawn(client, [...clientArgs(conn), "--default-character-set=utf8mb4", conn.database], {
  env: clientEnv(conn),
  stdio: ["pipe", "inherit", "pipe"],
});
let stderr = "";
restore.stderr.on("data", (d) => (stderr += d));

const source = createReadStream(file);
(file.endsWith(".gz") ? source.pipe(createGunzip()) : source).pipe(restore.stdin);

restore.on("close", (code) => {
  if (code !== 0) {
    console.error(stderr.trim() || `${client} exited with ${code}`);
    process.exit(1);
  }
  if (stderr) console.error(stderr.trim());

  // Prove it: count the tables and the migrations that came back.
  const check = spawnSync(
    client,
    [
      ...clientArgs(conn),
      "-N",
      "-B",
      conn.database,
      "-e",
      "SELECT (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()), (SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL);",
    ],
    { env: clientEnv(conn), encoding: "utf8" }
  );
  const [tables, migrations] = (check.stdout || "").trim().split(/\s+/);
  console.log(`Restored: ${tables} tables, ${migrations} applied migrations recorded.`);
});

restore.on("error", (err) => {
  console.error(`Could not run ${client}: ${err.message}`);
  process.exit(1);
});
