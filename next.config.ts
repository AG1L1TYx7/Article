import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone: the server plus only the node_modules actually
  // reached at runtime, traced from the build. Without it a container has
  // to carry the whole dependency tree, including every dev dependency.
  // See docs/deployment.md.
  output: "standalone",

  // Next.js advertises itself in an X-Powered-By header by default.
  // It tells an attacker which framework to look up exploits for and
  // does nothing for anyone else.
  poweredByHeader: false,

  // Keep the MySQL driver as a real package in .next/standalone/node_modules
  // instead of folding it into the server chunks. The cPanel bundle's
  // setup.js (scripts/cpanel-setup.cjs) runs migrations with the same
  // driver, and it can only require() what exists as a package.
  serverExternalPackages: ["mariadb"],
};

export default nextConfig;
