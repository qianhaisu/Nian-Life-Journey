"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const primary = [
  { href: "/", label: "首页", match: (path: string) => path === "/" },
  { href: "/memory", label: "记忆", match: (path: string) => path.startsWith("/memory") || path.startsWith("/events") },
  { href: "/about", label: "关于张年", match: (path: string) => path.startsWith("/about") },
];

export function SiteHeader() {
  const pathname = usePathname();
  return <>
    <header className="site-header" data-ai-id="app-header">
      <div className="header-inner">
        <Link className="brand" href="/" aria-label="张年的人生档案首页"><span className="brand-mark">年</span><span>张年的人生档案</span></Link>
        <nav className="desktop-nav" aria-label="主导航">
          {primary.map((item) => <Link className={item.match(pathname) ? "is-active" : ""} aria-current={item.match(pathname) ? "page" : undefined} href={item.href} key={item.href}>{item.label}</Link>)}
          <Link className="capture-link" href="/capture"><span aria-hidden="true">＋</span> 留下点什么</Link>
        </nav>
      </div>
    </header>
    <nav className="bottom-nav" aria-label="移动端主导航">
      {primary.slice(0, 2).map((item) => <Link className={item.match(pathname) ? "is-active" : ""} aria-current={item.match(pathname) ? "page" : undefined} href={item.href} key={item.href}>{item.label}</Link>)}
      <Link className={`bottom-capture ${pathname.startsWith("/capture") ? "is-active" : ""}`} href="/capture" aria-label="留下点什么"><span aria-hidden="true">＋</span><small>留下</small></Link>
      <Link className={primary[2].match(pathname) ? "is-active" : ""} aria-current={primary[2].match(pathname) ? "page" : undefined} href="/about">关于张年</Link>
    </nav>
  </>;
}
