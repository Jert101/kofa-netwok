import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Prefer this app as tracing root when another lockfile exists higher in the tree (e.g. home folder).
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
