import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = { title: "Life is about a dream · 张年的人生档案", description: "张年的家庭人生档案。" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#f5efe4" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="zh-CN" data-scroll-behavior="smooth"><body><a className="skip-link" href="#main-content">跳到主要内容</a><SiteHeader /><main id="main-content" className="site-shell">{children}</main></body></html>; }
