import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Built by npm run build:cpanel: a copy of the compiled output plus
    // traced node_modules, so linting it means linting every dependency.
    "cpanel-dist/**",
    // The Prisma client is generated, not written.
    "src/generated/**",
  ]),
  {
    // CommonJS by necessity: this file is copied into the cPanel bundle
    // as setup.js and run there with plain `node`, alongside app.js,
    // which Passenger also loads as CommonJS. It require()s the driver
    // lazily so a missing package produces a message instead of a stack.
    files: ["scripts/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
]);

export default eslintConfig;
