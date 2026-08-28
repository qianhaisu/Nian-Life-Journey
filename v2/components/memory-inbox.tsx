"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import type { CandidateMemory, Contributor, Media, RawSource } from "@/lib/types";

const captureKinds = ["照片 / 视频", "聊天记录", "托班记录", "文档", "健康 / 就医资料", "写一句话"];
const sourceLabels: Record<RawSource["sourceType"], string> = { family_photo: "家庭照片", family_video: "家庭视频", daycare_photo: "托班照片", daycare_note: "老师记录", wechat: "微信", parent_note: "家庭备注", medical_document: "医疗文档", checkup_document: "儿保文档", growth_measurement: "成长测量", other_document: "其他文档" };
const contentLabels: Record<string, string> = { daily: "日常", daycare: "托班", travel: "旅行", milestone: "第一次", growth: "成长", language: "语言", motor: "运动", interest: "兴趣", food: "饮食", sleep: "睡眠", health: "健康", family: "家庭", funny_moment: "有趣时刻" };

export function MemoryInbox({ sources, media, candidate, contributors }: { sources: RawSource[]; media: Media[]; candidate: CandidateMemory; contributors: Contributor[] }) {
  const [selected, setSelected] = useState<string[]>(["照片 / 视频", "托班记录", "聊天记录"]);
  const [stage, setStage] = useState<"capture" | "organize" | "confirmed">("capture");
  const [result, setResult] = useState("");
  const contributorById = useMemo(() => new Map(contributors.map((item) => [item.id, item])), [contributors]);
  const mediaById = useMemo(() => new Map(media.map((item) => [item.id, item])), [media]);

  return <div className="capture-flow" data-ai-id="capture-organize-flow">
    <ol className="flow-steps" aria-label="整理进度"><li className={stage === "capture" ? "is-active" : "is-done"}>1 留下东西</li><li className={stage === "organize" ? "is-active" : stage === "confirmed" ? "is-done" : ""}>2 看看关联</li><li className={stage === "confirmed" ? "is-active" : ""}>3 确认成为记忆</li></ol>
    {stage === "capture" ? <section className="capture-question" aria-labelledby="capture-title">
      <div><span className="section-mark">先放进来</span><h2 id="capture-title" className="serif">这次想留下什么？</h2><p>照片、聊天或一句话都可以先放进来；这里不上传真实资料。</p></div>
      <div className="capture-kinds">{captureKinds.map((kind) => <button type="button" key={kind} className={selected.includes(kind) ? "is-selected" : ""} aria-pressed={selected.includes(kind)} onClick={() => setSelected((current) => current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind])}><span aria-hidden="true">{selected.includes(kind) ? "✓" : "＋"}</span>{kind}</button>)}</div>
      <div className="capture-batch"><span>这次准备留下</span><strong>12 张托班照片 · 1 段视频 · 2 张微信截图 · 1 条爸爸备注</strong><button className="primary-button" type="button" disabled={!selected.length} onClick={() => setStage("organize")}>看看它们之间的关联</button></div>
    </section> : <>
      <section className="candidate-memory" aria-labelledby="candidate-title">
        <div className="candidate-flag"><span>整理建议</span><small>等待爸爸妈妈确认</small></div>
        <div className="candidate-main">
          <p className="candidate-date">{candidate.occurredAt.replaceAll("-", ".")} · {candidate.contextLabel}</p>
          <h2 id="candidate-title" className="serif">{candidate.title}</h2>
          <p>{candidate.description}</p>
          <dl className="candidate-facts"><div><dt>建议归类</dt><dd>{candidate.suggestedTags.join(" · ")}</dd></div>{candidate.growthInsight ? <div><dt>可能的变化</dt><dd>{candidate.growthInsight}</dd></div> : null}<div><dt>整理草稿</dt><dd>“{candidate.storyDraft}”</dd></div></dl>
          <div className="candidate-actions"><button className="primary-button" type="button" onClick={() => { setStage("confirmed"); setResult("这段候选记忆已确认保存（演示）。"); }}>确认保存</button><button type="button" onClick={() => setResult("已进入修改状态（演示）。")}>修改</button><button type="button" onClick={() => setResult("已标记为需要拆开整理（演示）。")}>这些不是一件事</button><button type="button" onClick={() => setResult("已暂时保留在待整理区（演示）。")}>暂时不处理</button></div>
          {result ? <p className="action-result" role="status">{result}</p> : null}
        </div>
      </section>
      <section className="source-ledger" aria-labelledby="source-ledger-title"><div className="ledger-heading"><span className="section-mark">原始资料</span><h2 id="source-ledger-title" className="serif">那天真正留下的东西</h2><p>来源、内容和贡献者是三个不同维度；原始资料不会被整理草稿覆盖。</p></div>
        {sources.map((source) => { const sourceMedia = source.mediaIds.map((id) => mediaById.get(id)).filter((item): item is Media => Boolean(item)); const contributor = contributorById.get(source.contributorId); return <article className="source-row" key={source.id}><div className="source-meta"><time dateTime={source.capturedAt}>{source.capturedAt.slice(11, 16)}</time><strong>{contributor?.displayName ?? "家庭"}</strong><span>{sourceLabels[source.sourceType]}</span></div><div className="source-body">{source.text ? <blockquote>“{source.text}”</blockquote> : null}{sourceMedia.length ? <div className="source-thumbs">{sourceMedia.slice(0, 4).map((item, index) => <div key={item.id}><Image src={item.src} alt={item.alt} fill sizes="120px" />{index === 3 && sourceMedia.length > 4 ? <span>+{sourceMedia.length - 4}</span> : null}</div>)}</div> : null}<p>{source.contentTypes.map((type) => contentLabels[type]).join(" · ")}</p></div></article>; })}
      </section>
    </>}
  </div>;
}
