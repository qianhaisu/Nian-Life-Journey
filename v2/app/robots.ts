import type { MetadataRoute } from "next";

// The archive is a private family publication. It is reachable by link, not by search.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
