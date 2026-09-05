import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
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
};

export default nextConfig;
