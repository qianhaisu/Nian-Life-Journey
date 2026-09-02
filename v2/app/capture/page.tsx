import type { Metadata } from "next";
import { MemoryInbox } from "@/components/memory-inbox";

// Kept as a route and a capability, but no longer a destination in the family navigation.
export const metadata: Metadata = { title: "留下点什么", robots: { index: false, follow: false } };

export default function CapturePage() {
  return <div className="capture-page reading-wrap">
    <header className="page-masthead capture-masthead"><span className="section-mark">留下点什么</span><h1 className="serif">今天想留下<br /><em>些什么？</em></h1><p>放进来就好，之后会按日期归到该去的地方。</p></header>
    <MemoryInbox />
  </div>;
}
