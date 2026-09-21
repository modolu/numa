import type { NextConfig } from "next";

/**
 * Numa ships as a static export served by the Convex static-hosting
 * component (https://<deployment>.convex.site). All runtime behaviour lives
 * in Convex and is reached through the realtime client, so no server
 * rendering, route handlers or server actions are used.
 */
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
