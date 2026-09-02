import type { Metadata } from "next";
import { listMemoryCandidates } from "@/lib/organizer/candidate-store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "候选记忆", robots: { index: false, follow: false } };

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

// Minimal read-only review list for the new evidence pipeline's MemoryCandidate output. This
// round only reads — accepting/rejecting a candidate, or promoting one to a real LifeEvent, is a
// Family Writer / auto-publish capability explicitly out of scope for this stage.
export default async function InboxPage() {
  const candidates = await listMemoryCandidates();
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 16px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>候选记忆</h1>
      <p style={{ color: "#666", fontSize: 13, marginBottom: 24 }}>
        这里只展示 Organizer 新证据流水线产出的候选（memory_candidates），不是最终时间线。本阶段候选只读，不能在此发布为正式记录。
      </p>
      {candidates.length === 0 ? (
        <p style={{ color: "#999" }}>暂无候选。</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          {candidates.map((candidate) => (
            <li key={candidate.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <strong>{STATUS_LABEL[candidate.status] ?? candidate.status}</strong>
                <span style={{ fontSize: 12, color: "#888" }}>
                  提议: {candidate.proposedAction} → 最终: {candidate.finalAction}
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
                <span>worthiness: {candidate.worthinessScore}</span>
                {candidate.degradeReason && <span>degrade: {candidate.degradeReason}</span>}
                {candidate.reasonCodes.length > 0 && <span>reasons: {candidate.reasonCodes.join(", ")}</span>}
                <span>sources: {candidate.sourceIds.length}</span>
                <span>{candidate.updatedAt}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
