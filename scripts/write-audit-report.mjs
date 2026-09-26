/**
 * Writes AUDIT.json into the deploy bundle: the known vulnerabilities in
 * the packages the site runs on, for the admin System health page.
 *
 *   node scripts/write-audit-report.mjs [outputDir]     (default cpanel-dist)
 *
 * Run at build time in CI, because the server cannot run it: the bundle
 * has no npm tooling, and the running site has no business calling the
 * npm registry. The page shows the report's age for the same reason: it
 * is a snapshot from the last deploy, not a live scan.
 *
 * Production dependencies only (--omit=dev). A flaw in a test runner
 * never reaches a reader. The CI gate (scripts/audit-dependencies.mjs)
 * is separate and decides whether a build may ship at all; this only
 * reports.
 *
 * Never fails the build: an audit that cannot reach the registry writes
 * a report saying so rather than blocking a deploy.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const outDir = process.argv[2] ?? "cpanel-dist";
const SEVERITY_ORDER = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };

// On Windows npm is a .cmd, which Node only runs through a shell; a fixed
// command string (nothing user-supplied) is the form Node accepts cleanly.
const windows = process.platform === "win32";
const run = spawnSync(windows ? "npm audit --omit=dev --json" : "npm", windows ? [] : ["audit", "--omit=dev", "--json"], {
  encoding: "utf8",
  shell: windows,
  maxBuffer: 64 * 1024 * 1024,
});

let report;
try {
  const data = JSON.parse(run.stdout);
  const meta = data.metadata?.vulnerabilities ?? {};
  const packages = Object.entries(data.vulnerabilities ?? {})
    .map(([name, v]) => {
      // `via` mixes advisory objects (with a title) and names of other
      // vulnerable packages that pulled this one in.
      const advisory = (v.via ?? []).find((x) => typeof x === "object" && x.title);
      return { name, severity: v.severity, ...(advisory ? { title: advisory.title } : {}) };
    })
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) || a.name.localeCompare(b.name));
  report = {
    generatedAt: new Date().toISOString(),
    commit: process.env.GITHUB_SHA ?? null,
    counts: {
      critical: meta.critical ?? 0,
      high: meta.high ?? 0,
      moderate: meta.moderate ?? 0,
      low: meta.low ?? 0,
      info: meta.info ?? 0,
    },
    packages,
  };
} catch {
  console.log("npm audit did not produce a report (registry unreachable?); nothing written.");
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "AUDIT.json"), JSON.stringify(report, null, 2) + "\n");
const c = report.counts;
console.log(
  `wrote ${join(outDir, "AUDIT.json")}: ${c.critical} critical, ${c.high} high, ${c.moderate} moderate, ${c.low} low`
);
