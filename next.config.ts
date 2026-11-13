import type { NextConfig } from "next";

// The browser suite swaps in a root-layout probe that can force a failure.
// Normal builds resolve the import to an empty component, so no test code is
// bundled in the production output.
const browserTest = process.env.KBS_BROWSER_TEST === "1";

const nextConfig: NextConfig = {
  /* config options here */
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  cacheComponents: true,
  partialPrefetching: true,
  // Produces .next/standalone for the production image (see Dockerfile).
  output: "standalone",
  turbopack: {
    root: process.cwd(),
    resolveAlias: {
      "@/components/root-failure-probe": browserTest
        ? "./src/components/root-failure-probe.tsx"
        : "./src/components/root-failure-probe-disabled.tsx",
    },
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
