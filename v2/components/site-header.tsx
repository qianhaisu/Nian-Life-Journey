"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Five places, equal weight, on every screen (HEALTH-04: 首页 / 记忆 / 健康 / 妈妈月报; 旅行 added
// 2026-09-25 between 健康 and 妈妈月报, Teddy's order). Capture keeps its route but is not a
// destination the family navigates to — the archive grows on its own.
const primary = [
  { href: "/", label: "首页", match: (path: string) => path === "/" },
  { href: "/memory", label: "记忆", match: (path: string) => path.startsWith("/memory") || path.startsWith("/events") },
  { href: "/health", label: "健康", match: (path: string) => path.startsWith("/health") },
  { href: "/travel", label: "旅行", match: (path: string) => path.startsWith("/travel") },
  { href: "/mom-reports", label: "妈妈月报", match: (path: string) => path.startsWith("/mom-reports") },
];

function NavLinks({ pathname }: { pathname: string }) {
  return primary.map((item) => {
    const active = item.match(pathname);
    return (
      <Link
        className={active ? "is-active" : ""}
        aria-current={active ? "page" : undefined}
        href={item.href}
        key={item.href}
      >
        {item.label}
      </Link>
    );
  });
}

export function SiteHeader() {
  const pathname = usePathname() ?? "/";
  const searchActive = pathname.startsWith("/memory/search");

  return (
    <>
      <header className="site-header" data-ai-id="app-header">
        <div className="header-inner">
          <Link className="brand" href="/" aria-label="Life is about a dream，张年的人生档案首页">
            <span className="brand-mark" aria-hidden="true">年</span>
            <span className="brand-copy">
              <strong>张年的人生档案</strong>
              <small>Life is about a dream</small>
            </span>
          </Link>
          <nav className="desktop-nav" aria-label="主导航">
            <NavLinks pathname={pathname} />
          </nav>
          <Link
            className={searchActive ? "header-search is-active" : "header-search"}
            href="/memory/search"
            aria-label="找一段往事"
            aria-current={searchActive ? "page" : undefined}
            prefetch={false}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.8-3.8" />
            </svg>
          </Link>
        </div>
      </header>
      <nav className="bottom-nav" aria-label="移动端主导航">
        <NavLinks pathname={pathname} />
      </nav>
    </>
  );
}
