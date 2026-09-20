import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Direct database access for e2e setup and assertions.
 *
 * These tests need to do two things the application deliberately offers no
 * UI for — promoting an account to staff, and backdating a row — and to
 * check that a write really landed rather than trusting the screen. Both
 * are legitimate reasons to talk to MySQL directly.
 *
 * Connection details come from the environment so the suite runs against
 * whatever local database a contributor has, rather than assuming the
 * author's. The client is taken from PATH by default, which also means
 * this file is not Windows-only.
 *
 * Override with MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD /
 * MYSQL_DATABASE, or point E2E_MYSQL at a specific binary.
 */

/**
 * Finds the mysql client: an explicit override, then PATH, then the usual
 * install locations.
 *
 * Neither XAMPP nor the MySQL installer puts its bin directory on PATH on
 * Windows, so falling back to the standard install paths keeps the suite
 * working there without anyone having to configure anything.
 */
function resolveMysql(): string {
  if (process.env.E2E_MYSQL) return process.env.E2E_MYSQL;

  const onPath = spawnSync("mysql", ["--version"], { stdio: "ignore" });
  if (onPath.status === 0) return "mysql";

  const candidates = [
    "C:/xampp/mysql/bin/mysql.exe",
    ...["8.4", "8.0"].map((v) => `C:/Program Files/MySQL/MySQL Server ${v}/bin/mysql.exe`),
    "/usr/local/bin/mysql",
    "/usr/bin/mysql",
    "/opt/homebrew/bin/mysql",
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    "Could not find the mysql client. Add it to PATH, or set E2E_MYSQL to its full path. " +
      "The e2e suite needs it for setup the application deliberately exposes no UI for."
  );
}

const MYSQL = resolveMysql();
const HOST = process.env.MYSQL_HOST ?? "127.0.0.1";
const PORT = process.env.MYSQL_PORT ?? "3307";
const USER = process.env.MYSQL_USER ?? "root";
const PASSWORD = process.env.MYSQL_PASSWORD ?? "";
const DATABASE = process.env.MYSQL_DATABASE ?? "news_platform";

function run(args: string[], query: string): string {
  return execFileSync(
    MYSQL,
    [
      "-u",
      USER,
      "-h",
      HOST,
      "-P",
      PORT,
      // Without this the client uses a named pipe on Windows and ignores
      // the port entirely, which quietly reaches the wrong server when
      // more than one is installed.
      "--protocol=TCP",
      ...(PASSWORD ? [`-p${PASSWORD}`] : []),
      ...args,
      DATABASE,
      "-e",
      query,
    ],
    { encoding: "utf8" }
  );
}

/** Runs a statement for its effect. */
export function sql(query: string): void {
  run([], query);
}

/**
 * Runs a query and returns the single value it produced, as text.
 *
 * -N drops the header row and -B gives tab-separated output, which
 * together are the equivalent of psql's -t -A.
 */
export function scalar(query: string): string {
  return run(["-N", "-B"], query).trim();
}

/** Runs a query and returns the single value it produced, as a number. */
export function count(query: string): number {
  return Number(scalar(query));
}
