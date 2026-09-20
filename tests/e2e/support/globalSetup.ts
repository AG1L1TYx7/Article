import { execFileSync } from "node:child_process";

function run(script: string, args: string[] = []) {
  execFileSync("npm", ["run", script, ...(args.length ? ["--", ...args] : [])], {
    stdio: "inherit",
    shell: true,
  });
}

/**
 * Puts the database in a known state before the suite runs.
 *
 * These tests register real accounts and publish real articles, so a dev
 * database accumulates them run after run. That is not merely untidy: the
 * moderation queue renders at most 100 pending comments, so once enough
 * runs had piled up, a test's own comment fell off the end of the list and
 * the suite began failing on data from *previous* runs rather than
 * anything it had done. Starting clean keeps each run self-contained.
 *
 * Cleanup is scoped to @example.com by the script itself — a domain RFC
 * 2606 reserves for testing, so a real account can never be caught by it.
 */
export default function globalSetup() {
  run("cleanup:test-data", ["--confirm"]);
  run("e2e:fixture");
}
