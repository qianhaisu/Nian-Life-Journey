"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Three places, equal weight, on every screen. Capture keeps its route but is not a destination the
// family navigates to — the archive grows on its own.
const primary = [
  { href: "/", label: "首页", match: (path: string) => path === "/" },
  { href: "/memory", label: "记忆", match: (path: string) => path.startsWith("/memory") || path.startsWith("/events") },
  { href: "/about", label: "张年", match: (path: string) => path.startsWith("/about") },
];

function NavLinks({ pathname }: { pathname: string }) {
  return primary.map((item) => {
    const active = item.match(pathname);
    return <Link className={active ? "is-active" : ""} aria-current={active ? "page" : undefined} href={item.href} key={item.href}>{item.label}</Link>;
  });
}

export function SiteHeader() {
  const pathname = usePathname();
  return <>
    <header className="site-header" data-ai-id="app-header">
      <div className="header-inner">
        <Link className="brand" href="/" aria-label="Life is about a dream，张年的人生档案首页"><span className="brand-mark">年</span><span className="brand-copy"><strong>Life is about a dream</strong><small>张年的人生档案</small></span></Link>
        <nav className="desktop-nav" aria-label="主导航"><NavLinks pathname={pathname} /></nav>
      </div>
    </header>
    <nav className="bottom-nav" aria-label="移动端主导航"><NavLinks pathname={pathname} /></nav>
  </>;
}
