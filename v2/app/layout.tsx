import type { Metadata } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = { title: "张年的数字人生档案", description: "张年，从每天开始记录。" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <><SiteHeader /><main className="site-shell">{children}</main></>; }
