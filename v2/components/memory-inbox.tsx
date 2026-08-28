"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { captureSources, undoCapture } from "@/app/actions";

const kinds = [{ value: "family_photo", label: "照片 / 视频" }, { value: "wechat", label: "聊天记录" }, { value: "daycare", label: "托班记录" }, { value: "medical_document", label: "文档 / 就医资料" }, { value: "parent_note", label: "写一句话" }];

export function MemoryInbox() {
  const [kind, setKind] = useState("family_photo"); const [isPending, startTransition] = useTransition(); const [message, setMessage] = useState(""); const [result, setResult] = useState<{ eventId: string; count: number; action: string } | null>(null);
  return <div className="capture-flow" data-ai-id="capture-organize-flow">
    <div className="capture-kinds" role="list" aria-label="资料类型">{kinds.map((item) => <button type="button" role="listitem" className={kind === item.value ? "is-selected" : ""} key={item.value} onClick={() => setKind(item.value)} aria-pressed={kind === item.value}><span aria-hidden="true">{kind === item.value ? "✓" : "＋"}</span>{item.label}</button>)}</div>
    {!result ? <form className="capture-form" action={(formData) => { setMessage(""); startTransition(async () => { try { const value = await captureSources(formData); setResult({ eventId: value.result.eventId, count: value.count, action: value.result.action }); } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败，请重试"); } }); }}>
      <input type="hidden" name="kind" value={kind} /><label>选择资料<input name="files" type="file" multiple accept={kind === "medical_document" ? ".pdf,image/jpeg,image/png" : "image/*,video/mp4,video/quicktime"} /></label><div className="capture-form-grid"><label>日期<input name="capturedAt" type="date" defaultValue="2026-08-28" required /></label><label>谁留下的<select name="contributorId" defaultValue="contributor-dad"><option value="contributor-dad">爸爸</option><option value="contributor-mom">妈妈</option><option value="contributor-teacher">老师</option><option value="contributor-hospital">医院</option></select></label></div><label>补充一句（可选）<textarea name="text" rows={3} placeholder="比如：今天回来一直在说车车。" /></label><label>可见范围<select name="visibility" defaultValue="family"><option value="family">家庭可见</option><option value="private">仅自己</option><option value="public">公开（需之后主动设置）</option></select></label><button className="primary-button" type="submit" disabled={isPending}>{isPending ? "正在收好…" : "上传并自动整理"}</button>{message ? <p className="form-error" role="alert">{message}</p> : null}</form> : <section className="capture-done" aria-live="polite"><span className="section-mark">已经收好了</span><h2 className="serif">今天留下了 {result.count} 项东西。</h2><p>系统已经自动整理，原始资料和媒体会一直保留。</p><div className="done-summary"><strong>{result.action === "attach_to_existing_memory" ? "已接入已有记忆" : result.action === "care_episode" ? "已归入照护记录" : "已形成当天记录"}</strong><span>Organizer 已按日期、来源和内容完成整理。</span></div><div className="candidate-actions"><Link className="primary-button" href={`/events/${result.eventId}`}>看看整理结果 ↗</Link><button type="button" onClick={() => setResult(null)}>继续留下东西</button></div></section>}
    <p className="capture-privacy">医疗资料自动保持 private；公开展示需要家庭成员之后主动设置。自动整理出错时可在记忆详情中重新整理或撤销，原始资料不会被删除。</p>
  </div>;
}
