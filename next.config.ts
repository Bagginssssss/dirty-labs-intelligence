import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Never serve stale RSC payloads for dynamic (force-dynamic) pages.
    // Prevents period-navigation returning wrong period's data from Router Cache.
    staleTimes: { dynamic: 0, static: 300 },
  },
};

export default nextConfig;
