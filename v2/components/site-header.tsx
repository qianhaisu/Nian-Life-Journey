import Link from "next/link";

export function SiteHeader() {
	return <>
		<header className="site-header">
			<div className="header-inner">
				<Link className="brand" href="/"><span className="brand-mark">张</span><span>张年的人生档案</span></Link>
				<nav className="desktop-nav" aria-label="主导航">
					<Link href="/">首页</Link>
					<Link href="/timeline">时间线</Link>
					<Link href="/#growth">成长</Link>
					<Link href="/archive">年鉴</Link>
					<Link href="/inbox">整理</Link>
					<span className="header-note">仅家庭可见 · 2026 年 8 月</span>
				</nav>
			</div>
		</header>
		<nav className="bottom-nav" aria-label="移动端主导航">
			<Link href="/">首页</Link>
			<Link href="/timeline">时间线</Link>
			<Link href="/inbox">收件箱</Link>
			<Link href="/archive">年鉴</Link>
		</nav>
	</>;
}
