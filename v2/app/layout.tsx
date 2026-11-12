import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./shadcn.css";
import { ScrollReveal } from "@/components/scroll-reveal";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SITE_NAME, SITE_URL } from "@/lib/site";

// Self-hosted Nunito variable latin subset (SIL OFL 1.1 — see app/fonts/nunito/OFL.txt).
// Never import next/font/google: ECS Docker builds run offline without Google Fonts access.
const nunito = localFont({
  src: [
    { path: "./fonts/nunito/nunito-latin.woff2", weight: "400 800", style: "normal" },
  ],
  display: "swap",
  variable: "--font-nunito",
});

// Self-hosted Poppins latin subset for headings, UI chrome, and lining tabular numerals
// (SIL OFL 1.1 — see app/fonts/poppins/OFL.txt). Weight 700 maps to the crisp 600 face so browsers
// never synthesize faux-bold on Latin numerals while CJK system sans renders native bold weights.
const poppins = localFont({
  src: [
    { path: "./fonts/poppins/poppins-latin-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/poppins/poppins-latin-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/poppins/poppins-latin-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/poppins/poppins-latin-600.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-poppins",
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F3F5F9",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" data-scroll-behavior="smooth" className={`${nunito.variable} ${poppins.variable}`}><body><a className="skip-link" href="#main-content">跳到主要内容</a><SiteHeader /><main id="main-content" className="site-shell">{children}</main><SiteFooter /><ScrollReveal /></body></html>;
}
