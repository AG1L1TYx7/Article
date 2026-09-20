/**
 * Dependency audit with an explicit, reviewable exception list.
 *
 *   npm run audit
 *
 * Plain `npm audit` in CI has one of two failure modes: it blocks on
 * advisories nobody can fix, so the step gets disabled or ignored — or it
 * runs with `continue-on-error` and nobody reads it. Either way a real
 * vulnerability arrives unnoticed.
 *
 * This fails on anything that is not listed below. An exception has to be
 * written down with the reason it is safe, which makes it a decision
 * somebody made rather than a warning everyone stopped seeing. Anything
 * new is red.
 *
 * When an exception no longer applies — the dependency was dropped, or a
 * fix shipped — the script says so and fails, so stale entries do not
 * quietly accumulate.
 */
import { execSync } from "node:child_process";

/**
 * Advisories reviewed and accepted, with the reasoning.
 *
 * Before adding one, establish that it is genuinely unreachable — not
 * merely inconvenient to fix.
 */
const ACCEPTED = [
  // Empty at the time of writing. The advisories that used to sit here
  // (deepmerge-ts and mysql2 via the Prisma CLI, and the mariadb driver's
  // cleartext-credential issues) are resolved by the `overrides` block in
  // package.json, which pins patched versions until Prisma updates its
  // own pins. If Prisma later requires an older version, the override is
  // the first thing to look at.
];

const FAIL_AT = ["moderate", "high", "critical"];

function runAudit() {
  try {
    // A fixed command string rather than a binary plus an argument
    // array: npm is npm.cmd on Windows, which Node will not spawn without
    // a shell. Nothing here is interpolated, so there is no argument for
    // a shell to mangle.
    return JSON.parse(execSync("npm audit --json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch (error) {
    if (error.stdout) return JSON.parse(error.stdout);
    throw error;
  }
}

const report = runAudit();
const accepted = new Map(ACCEPTED.map((entry) => [entry.id, entry]));
const seen = new Set();
const unexpected = [];

for (const [name, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of vulnerability.via ?? []) {
    // A string entry means "vulnerable because a dependency is"; the real
    // advisory is reported against that dependency instead.
    if (typeof via !== "object") continue;
    if (!FAIL_AT.includes(via.severity)) continue;

    const id = /GHSA-[a-z0-9-]+/i.exec(via.url ?? "")?.[0];
    if (id && accepted.has(id)) {
      seen.add(id);
      continue;
    }
    unexpected.push({ name, severity: via.severity, title: via.title, url: via.url });
  }
}

const stale = ACCEPTED.filter((entry) => !seen.has(entry.id));

if (stale.length > 0) {
  console.log("These accepted advisories no longer appear. Remove them from");
  console.log("scripts/audit-dependencies.mjs so the list stays honest:\n");
  for (const entry of stale) console.log(`  ${entry.id}  (${entry.package})`);
  console.log("");
}

if (unexpected.length > 0) {
  console.error(`${unexpected.length} unreviewed advisory/advisories:\n`);
  for (const item of unexpected) {
    console.error(`  [${item.severity}] ${item.name} — ${item.title}`);
    console.error(`    ${item.url}\n`);
  }
  console.error("Fix it, or add it to ACCEPTED in scripts/audit-dependencies.mjs");
  console.error("with the reason it cannot be reached.");
  process.exit(1);
}

if (stale.length > 0) process.exit(1);

console.log(`No unreviewed advisories. ${ACCEPTED.length} known and documented:`);
for (const entry of ACCEPTED) console.log(`  ${entry.id}  ${entry.package}`);
