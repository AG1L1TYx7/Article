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
};

export default nextConfig;
