import type { Metadata } from "next";
import { healthPageRuntime } from "@/lib/health/page/runtime";
import { HealthView } from "./health-view";
import "./health.css";

// HEALTH-04 健康页：健康时间轴 / 病程分析 / 后续措施。没有健康登录，点“健康”直接进入（2026-09-21 Teddy 决定病历数据允许公开访问）。
// 每次请求都在服务端渲染，不进 ISR 缓存。
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "健康", robots: { index: false, follow: false } };

export default async function HealthPage() {
  const rt = healthPageRuntime();
  if (!rt.ok) return <div className="hp"><h1 className="hp-h1">健康</h1><p className="hp-muted">健康页还没有启用。</p></div>;
  const page = await rt.page.page();
  return <HealthView page={page} />;
}
