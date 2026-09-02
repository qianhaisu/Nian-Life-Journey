import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { SITE_NAME, SITE_URL } from "@/lib/site";

// A private family archive: readable by whoever has the link, but never something search engines
// should index (see app/robots.ts). Pages set their own `title`; the template keeps the site name.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `Life is about a dream · ${SITE_NAME}`, template: `%s · ${SITE_NAME}` },
  description: "张年的家庭人生档案。",
  robots: { index: false, follow: false },
  alternates: { canonical: "./" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#f5efe4" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" data-scroll-behavior="smooth"><body><a className="skip-link" href="#main-content">跳到主要内容</a><SiteHeader /><main id="main-content" className="site-shell">{children}</main></body></html>;
}
