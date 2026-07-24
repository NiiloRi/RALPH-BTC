import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server (.next/standalone) for a lean Docker image.
  output: "standalone",
  // Baseline security headers. CSP deliberately omitted: App Router hydration
  // and recharts would both require 'unsafe-inline', making it theater on a
  // fully-authenticated single-origin app with no third-party scripts.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
