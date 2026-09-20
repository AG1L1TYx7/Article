/**
 * Dumps the database to a gzipped SQL file.
 *
 *   npm run db:backup                    # → backups/news_platform-2026-09-20T22-30-00Z.sql.gz
 *   npm run db:backup -- --out /path     # somewhere else
 *   npm run db:backup -- --keep 14       # delete older dumps beyond the newest 14
 *
 * Reads DATABASE_URL, so it backs up whatever the site is actually using.
 * Uses mysqldump (or mariadb-dump) from PATH; on cPanel both are present,
 * on Windows XAMPP ships it in C:\xampp\mysql\bin.
 *
 * --single-transaction takes a consistent snapshot of InnoDB tables
 * without locking them, so this is safe to run against a live site.
 * --routines/--triggers are included for completeness; the schema has
 * none today. Full-text indexes are recreated by the CREATE TABLE
 * statements in the dump, and the _prisma_migrations table travels with
 * everything else, so a restored database knows exactly which migrations
 * it has.
 *
 * Restore with scripts/restore-db.mjs. Practise that — see docs/operations.md.
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { createGzip } from "node:zlib";
import path from "node:path";
import { clientArgs, clientEnv, parseDatabaseUrl } from "./dbUrl.mjs";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

function findDumpTool() {
  const explicit = process.env.MYSQLDUMP;
  if (explicit) return explicit;
  for (const candidate of ["mysqldump", "mariadb-dump", "C:/xampp/mysql/bin/mysqldump.exe"]) {
    const probe = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (probe.status === 0) return candidate;
  }
  throw new Error("Could not find mysqldump or mariadb-dump on PATH. Set MYSQLDUMP to its full path.");
}

const conn = parseDatabaseUrl();
const outDir = path.resolve(arg("--out", "backups"));
const keep = Number(arg("--keep", "0"));
mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
const file = path.join(outDir, `${conn.database}-${stamp}.sql.gz`);
const tool = findDumpTool();

const dump = spawn(
  tool,
  [
    ...clientArgs(conn),
    "--single-transaction",
    "--quick",
    "--routines",
    "--triggers",
    "--set-gtid-purged=OFF",
    "--default-character-set=utf8mb4",
    conn.database,
  ],
  { env: clientEnv(conn), stdio: ["ignore", "pipe", "pipe"] }
);

let stderr = "";
dump.stderr.on("data", (d) => (stderr += d));

const out = createWriteStream(file);
dump.stdout.pipe(createGzip({ level: 6 })).pipe(out);

dump.on("close", (code) => {
  out.on("finish", () => {
    // MariaDB's dump tool does not know --set-gtid-purged and says so on
    // stderr but still exits 0 and dumps correctly; anything else is real.
    const noise = /unknown variable 'set-gtid-purged/i;
    if (code !== 0) {
      if (existsSync(file)) unlinkSync(file);
      console.error(stderr.trim() || `${tool} exited with ${code}`);
      process.exit(1);
    }
    if (stderr && !noise.test(stderr)) console.error(stderr.trim());

    const size = statSync(file).size;
    if (size < 200) {
      unlinkSync(file);
      console.error("The dump was empty — wrong database name, or no permission to read it?");
      process.exit(1);
    }
    console.log(`Backed up ${conn.database} → ${file} (${(size / 1024).toFixed(0)} KB)`);

    if (keep > 0) {
      const dumps = readdirSync(outDir)
        .filter((f) => f.startsWith(`${conn.database}-`) && f.endsWith(".sql.gz"))
        .sort()
        .reverse();
      for (const old of dumps.slice(keep)) {
        unlinkSync(path.join(outDir, old));
        console.log(`Removed old backup ${old}`);
      }
    }
  });
});

// Fail loudly if the tool cannot even start (not installed, wrong path).
dump.on("error", (err) => {
  console.error(`Could not run ${tool}: ${err.message}`);
  process.exit(1);
});
