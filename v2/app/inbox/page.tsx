import type { Metadata } from "next";
import { listMemoryCandidates } from "@/lib/organizer/candidate-store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "待确认的候选记录", robots: { index: false, follow: false } };

const STATUS_LABEL: Record<string, string> = {
  pending: "待处理",
  needs_review: "待人工确认",
  auto_accept: "已自动通过",
  deferred: "已延后",
  rejected: "已拒绝",
  failed: "处理失败",
};

function factsOf(candidate: Awaited<ReturnType<typeof listMemoryCandidates>>[number]) {
  const outcome = candidate.outcome;
  if (outcome.action === "life_event_candidate") return outcome.coreFacts.map((fact) => fact.statement);
  if (outcome.action === "daily_trace") return outcome.traceLines.map((line) => line.text);
  if (outcome.action === "care_observation") return outcome.symptomsVerbatim;
  return [];
}

// PAGE-0915-FULL-REMEDIATION-R1 C2：这是内部整理工作台，不是给家人看的页面——不接家庭导航
// （metadata.robots 已经是 noindex/nofollow），只读，不能在这里发布或修改正式记录。
// 去掉的都是面向实现的词："Organizer"「新证据流水线」「memory_candidates」「本阶段」——它们说的是
// 系统怎么运作，不是这一条候选本身是什么；换成候选来自哪里、还没定下来的意思是什么。
// 内部读者仍然需要能对上原始字段名去查代码/数据库，所以下面保留了英文字段名本身
// （proposedAction/finalAction/worthinessScore 等）——去掉的是包在它们外面的系统黑话，不是字段名。
export default async function InboxPage() {
  const candidates = await listMemoryCandidates();
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 16px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>待确认的候选记录</h1>
      <p style={{ color: "#666", fontSize: 13, marginBottom: 24 }}>
        内部整理工作台，只读。这里是还没定下来的候选，不是家人看的时间线；候选要不要收进正式记录，不在这个页面上做。
      </p>
      {candidates.length === 0 ? (
        <p style={{ color: "#999" }}>目前没有候选。</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          {candidates.map((candidate) => (
            <li key={candidate.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <strong>{STATUS_LABEL[candidate.status] ?? candidate.status}</strong>
                <span style={{ fontSize: 12, color: "#888" }}>
                  proposedAction: {candidate.proposedAction} → finalAction: {candidate.finalAction}
                </span>
              </div>
              <p style={{ fontSize: 13, color: "#555", margin: "8px 0" }}>{candidate.selectionReason}</p>
              {factsOf(candidate).length > 0 && (
                <ul style={{ fontSize: 13, margin: "4px 0 8px", paddingLeft: 20 }}>
                  {factsOf(candidate).map((fact, index) => (
                    <li key={index}>{fact}</li>
                  ))}
                </ul>
              )}
              <div style={{ fontSize: 11, color: "#999", display: "flex", gap: 12, flexWrap: "wrap" }}>
                <span>worthinessScore: {candidate.worthinessScore}</span>
                {candidate.degradeReason && <span>degradeReason: {candidate.degradeReason}</span>}
                {candidate.reasonCodes.length > 0 && <span>reasonCodes: {candidate.reasonCodes.join(", ")}</span>}
                <span>来源条数: {candidate.sourceIds.length}</span>
                <span>{candidate.updatedAt}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
