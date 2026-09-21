import type { Metadata } from "next";
import { loadHealthRecordConfig } from "@/lib/health/record/config";
import { RecordApp } from "./record-app";
import "./record.css";

// HEALTH-03 家长健康记录：爸妈手记 / 就医 / 已记录。没有健康登录；“妈妈 / 爸爸”只是录入人选择。不读取任何全站存储。
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "健康记录", robots: { index: false, follow: false } };

export default function HealthRecordPage() {
  const conf = loadHealthRecordConfig();
  if (!conf.ok) {
    return <div className="hr-root"><div className="hr-app"><h1 style={{ marginTop: 40 }}>健康记录</h1><p>这个功能还没有启用。</p></div></div>;
  }
  return <div className="hr-root"><RecordApp /></div>;
}
