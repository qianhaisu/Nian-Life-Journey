import type { Metadata } from "next";
import { cookies } from "next/headers";
import { COOKIE, readSession } from "@/lib/health/record/auth";
import { loadHealthRecordConfig } from "@/lib/health/record/config";
import { RecordApp } from "./record-app";
import "./record.css";

// HEALTH-03 家长健康记录：爸妈手记 / 就医 / 已记录。只对已登录的妈妈/爸爸渲染；不读取任何全站存储。
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "健康记录", robots: { index: false, follow: false } };

export default async function HealthRecordPage() {
  const conf = loadHealthRecordConfig();
  if (!conf.ok) {
    return <div className="hr-root"><div className="hr-app"><h1 style={{ marginTop: 40 }}>健康记录</h1><p>这个功能还没有启用。</p></div></div>;
  }
  const jar = await cookies();
  const s = readSession(conf.config, `${COOKIE}=${jar.get(COOKIE)?.value ?? ""}`);
  return <div className="hr-root"><RecordApp initialWho={s ? { who: s.who, label: s.label } : null} /></div>;
}
