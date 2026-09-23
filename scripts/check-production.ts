/**
 * npm run check:production
 *
 * Reads .env (via tsx --env-file-if-exists) and reports whether this
 * configuration is fit for the public: the same checks the server runs
 * at startup in production (src/instrumentation.ts), so a deploy that
 * would refuse to start is caught here first. Exit code 1 on a blocker.
 *
 * Pass --strict to treat warnings as failures too, for a pipeline that
 * should not ship on local fallbacks at all.
 */
import { assessReadiness, formatReadiness } from "../src/lib/productionReadiness";
import { isTranscodingConfigured } from "../src/lib/transcode";

const strict = process.argv.includes("--strict");
const report = assessReadiness(process.env, { ffmpegAvailable: isTranscodingConfigured() });

console.log("Production readiness\n");
console.log(formatReadiness(report));

if (report.blockers.length > 0) {
  console.log("\nThe server will refuse to start in production with these unresolved.");
  process.exit(1);
}
if (strict && report.warnings.length > 0) {
  console.log("\n--strict: warnings count as failures.");
  process.exit(1);
}
console.log("\nOK to deploy.");
