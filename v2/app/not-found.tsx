import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "这一页不在档案里" };

export default function NotFound() {
  return <section className="reading-wrap not-found" aria-labelledby="not-found-title">
    <p className="section-mark">404</p>
    <h1 id="not-found-title">这一页不在档案里。</h1>
    <p className="lede">可能是链接旧了，也可能这段记忆还没有被整理出来。</p>
    <p className="not-found-links"><Link href="/memory">回到记忆</Link><Link href="/">回到首页</Link></p>
  </section>;
}
