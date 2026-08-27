import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/v2",
  images: {
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
