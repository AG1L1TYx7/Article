import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Direct database access for e2e setup and assertions.
 *
 * These tests need to do two things the application deliberately offers no
 * UI for — promoting an account to staff, and backdating a row — and to
 * check that a write really landed rather than trusting the screen. Both
 * are legitimate reasons to talk to Postgres directly.
 *
 * Connection details come from the environment so the suite runs against
 * whatever local database a contributor has, rather than assuming the
 * author's. `psql` is taken from PATH by default, which also means this
 * file is not Windows-only: an absolute path to psql.exe was previously
 * hardcoded in all eleven spec files, so nobody on macOS or Linux — or on
 * a different PostgreSQL version — could run the suite at all.
 *
 * Override with PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE, or
 * point E2E_PSQL at a specific binary.
 */
/**
 * Finds psql: an explicit override, then PATH, then the usual install
 * locations.
 *
 * The PATH step is what most machines will use, but a stock PostgreSQL
 * installer on Windows does not add its bin directory to PATH, so falling
 * back to the standard install path keeps the suite working there without
 * anyone having to configure anything.
 */
function resolvePsql(): string {
  if (process.env.E2E_PSQL) return process.env.E2E_PSQL;

  const onPath = spawnSync("psql", ["--version"], { stdio: "ignore" });
  if (onPath.status === 0) return "psql";

  const candidates = [
    ...[18, 17, 16, 15, 14].map((v) => `C:\\Program Files\\PostgreSQL\\${v}\\bin\\psql.exe`),
    "/usr/local/bin/psql",
    "/usr/bin/psql",
    "/opt/homebrew/bin/psql",
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    "Could not find psql. Add it to PATH, or set E2E_PSQL to its full path. " +
      "The e2e suite needs it for setup the application deliberately exposes no UI for."
  );
}

const PSQL = resolvePsql();
const HOST = process.env.PGHOST ?? "localhost";
const PORT = process.env.PGPORT ?? "5432";
const USER = process.env.PGUSER ?? "postgres";
const PASSWORD = process.env.PGPASSWORD ?? "postgres";
const DATABASE = process.env.PGDATABASE ?? "news_platform_dev";

function run(args: string[], query: string): string {
  return execFileSync(PSQL, ["-U", USER, "-h", HOST, "-p", PORT, "-d", DATABASE, ...args, "-c", query], {
    env: { ...process.env, PGPASSWORD: PASSWORD },
    encoding: "utf8",
  });
}

/** Runs a statement for its effect. */
export function sql(query: string): void {
  run([], query);
}

/** Runs a query and returns the single value it produced, as text. */
export function scalar(query: string): string {
  return run(["-t", "-A"], query).trim();
}

/** Runs a query and returns the single value it produced, as a number. */
export function count(query: string): number {
  return Number(scalar(query));
}
