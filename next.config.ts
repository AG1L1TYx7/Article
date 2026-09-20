import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone: the server plus only the node_modules actually
  // reached at runtime, traced from the build. Without it a container has
  // to carry the whole dependency tree, including every dev dependency.
  // See docs/deployment.md.
  output: "standalone",
};

export default nextConfig;
