import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/v2",
  distDir: process.env.NEXT_DIST_DIR || ".next",
  images: {
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
