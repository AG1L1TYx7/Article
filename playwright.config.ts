import { defineConfig } from "@playwright/test";
// The test process needs AUTH_SECRET (tests/e2e/support/staff.ts enrols
// staff accounts in MFA with the application's own encryption). Locally
// that lives in .env; CI sets it in the environment and .env is absent.
import "dotenv/config";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/support/globalSetup.ts",
  fullyParallel: false, // tests share one dev DB; keep them sequential within a file
  reporter: "list",
  // Site settings are global: a spec that flips comment moderation would
  // change what every other spec expects of a new reader's comment. So it
  // runs on its own, after everything else, and restores the default.
  projects: [
    { name: "main", testIgnore: /settings\.spec\.ts/ },
    { name: "settings", testMatch: /settings\.spec\.ts/, dependencies: ["main"] },
  ],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  webServer: {
    // Deliberately a production build, not `next dev`.
    //
    // `next dev` compiles routes on demand, so the first request to each
    // route under parallel load can take seconds — which produced
    // failures that looked like application bugs (a like that "didn't
    // persist", a registration that "didn't redirect") but were really
    // the dev server still compiling. The identical suite that failed 3
    // times out of 24 against `next dev` passed 24/24 against a
    // production build, and ran in a third of the time.
    //
    // reuseExistingServer means a server you already have running is used
    // as-is, so iterating locally doesn't pay for a rebuild each time.
    // Stop it first if you want the build to pick up your latest changes.
    // The build output is wiped first because this project lives in a
    // OneDrive-synced folder: OneDrive holds locks on files inside .next
    // mid-sync, and Next's own cleanup step then dies with
    // "EPERM: operation not permitted, unlink". Building from nothing
    // avoids the delete entirely. Removed with node rather than rm -rf so
    // it works in cmd.exe, which is the shell Playwright gets on Windows.
    command:
      "node -e \"require('fs').rmSync('.next',{recursive:true,force:true})\" && npm run build && npm start",
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
