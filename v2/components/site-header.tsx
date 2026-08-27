import Link from "next/link";

export function SiteHeader() { return <header className="site-header"><div className="header-inner"><Link className="brand" href="/"><span className="brand-mark">张</span><span>张年的生活</span></Link><nav className="desktop-nav" aria-label="主导航"><Link href="/">首页</Link><Link href="/timeline">时间线</Link><Link href="/#growth">成长</Link><span className="header-note">2026 年 8 月 · 1 岁 7 个月</span></nav></div></header>; }
