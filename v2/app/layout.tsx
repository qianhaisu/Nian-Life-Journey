import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
// 中文圆体 NianRound：本地静态 woff2 分片，同源加载，不请求 Google Fonts。
// 分片与许可见 app/fonts.css 顶部注释与 public/fonts/nian-round/LICENSE.txt。
// 写在 globals 之前，@font-face 先于用到它的规则声明。
import "./fonts.css";
// 霞鹜文楷：只声明 @font-face，不给任何元素指定字体；真正用到它的只有 app/home.css 里
// .home-v2 作用域内的规则，所以其他页面的字体一个像素都不变（见 fonts-wenkai.css 顶部）。
import "./fonts-wenkai.css";
import "./globals.css";
import "./shadcn.css";
import { ScrollReveal } from "@/components/scroll-reveal";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SITE_NAME, SITE_URL } from "@/lib/site";

// Nunito, from files in the repository (app/fonts/nunito/, SIL OFL 1.1 — see OFL.txt there).
// It used to be next/font/google, which downloads the font while `next build` runs: on 2026-09-23 the
// ECS build failed on exactly that download. The file is the latin subset Google served that build
// (a variable font), declared at the same three fixed weights as before — so a `font-weight: 600`
// heading still resolves to the 800 face, exactly as it rendered with next/font/google.
const nunito = localFont({
  src: [
    { path: "./fonts/nunito/nunito-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/nunito/nunito-latin.woff2", weight: "500", style: "normal" },
    { path: "./fonts/nunito/nunito-latin.woff2", weight: "800", style: "normal" },
  ],
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
