import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
// 中文圆体 NianRound：本地静态 woff2 分片，同源加载，不请求 Google Fonts。
// 分片与许可见 app/fonts.css 顶部注释与 public/fonts/nian-round/LICENSE.txt。
// 写在 globals 之前，@font-face 先于用到它的规则声明。
import "./fonts.css";
import "./globals.css";
import { ScrollReveal } from "@/components/scroll-reveal";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SITE_NAME, SITE_URL } from "@/lib/site";

// Self-hosted via Next.js font optimization — downloaded at build time, served from same origin,
// zero runtime requests to fonts.googleapis.com (不走 Google Fonts CDN，大陆不阻塞).
const nunito = Nunito({
  subsets: ["latin"],
  weight: ["400", "500", "800"],
  display: "swap",
  variable: "--font-nunito",
});

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
  return <html lang="zh-CN" data-scroll-behavior="smooth" className={nunito.variable}><body><a className="skip-link" href="#main-content">跳到主要内容</a><SiteHeader /><main id="main-content" className="site-shell">{children}</main><SiteFooter /><ScrollReveal /></body></html>;
}
