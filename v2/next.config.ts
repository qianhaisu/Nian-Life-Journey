import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep client asset requests tied to the deployed release (including ECS builds).
  deploymentId: process.env.NIANLIFE_BUILD_SHA || process.env.VERCEL_GIT_COMMIT_SHA,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Standalone output is the ECS container's runtime — see Dockerfile. Does not affect
  // Vercel builds, which ignore this field.
  output: "standalone",
  // Let Caddy handle HTTP compression (zstd preferred over gzip) without double-compressing in Node.
  compress: false,
  outputFileTracingExcludes: {
    "*": ["./.data/**", "./.next-*/**", "./test/**"],
  },
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048],
  },
  // One address for the archive. www is accepted but sends readers to the apex domain.
  async redirects() {
    return [
      { source: "/:path*", has: [{ type: "host", value: "www.nianlife.cn" }], destination: "https://nianlife.cn/:path*", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/mom-reports/:path*.webp",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/mom-reports/:path(.+\\.(?:png|jpg|jpeg|avif|gif|svg))",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
    ];
  },
};

export default nextConfig;
