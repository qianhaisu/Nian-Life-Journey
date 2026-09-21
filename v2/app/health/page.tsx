import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { COOKIE, readSession } from "@/lib/health/record/auth";
import { healthPageRuntime } from "@/lib/health/page/runtime";
import { HealthView } from "./health-view";
import "./health.css";

// HEALTH-04 健康页：健康时间轴 / 病程分析 / 后续措施。只对已登录的妈妈/爸爸渲染内容；未登录只给一个登录入口，
// 不输出任何健康正文。每次请求都在服务端判断，不进 ISR 缓存。
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "健康", robots: { index: false, follow: false } };

export default async function HealthPage() {
  const rt = healthPageRuntime();
  if (!rt.ok) return <div className="hp"><h1 className="hp-h1">健康</h1><p className="hp-muted">健康页还没有启用。</p></div>;
  const jar = await cookies();
  const session = readSession(rt.config, `${COOKIE}=${jar.get(COOKIE)?.value ?? ""}`);
  if (!session) {
    return <div className="hp">
      <h1 className="hp-h1">健康</h1>
      <section className="hp-gate">
        <p>健康记录只给妈妈和爸爸看。</p>
        <Link className="hp-btn" href="/health/record">登录</Link>
      </section>
    </div>;
  }
  const page = await rt.page.page();
  return <HealthView page={page} who={session.label} />;
}
