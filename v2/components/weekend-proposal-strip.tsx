import Link from "next/link";
import type {
  ExcludedExperienceTypeItem,
  WeekendCurrentBundle,
  WeekendPlannerSnapshot,
  WeekendProposal,
  WeekendStateFile,
} from "@/lib/weekend/types";

function formatShortRange(from: string, to: string): string {
  const m1 = Number(from.slice(5, 7));
  const d1 = Number(from.slice(8, 10));
  const m2 = Number(to.slice(5, 7));
  const d2 = Number(to.slice(8, 10));
  if ([m1, d1, m2, d2].some((n) => Number.isNaN(n))) return "";
  if (m1 === m2) return `${m1}.${String(d1).padStart(2, "0")}–${String(d2).padStart(2, "0")}`;
  return `${m1}.${String(d1).padStart(2, "0")}–${m2}.${String(d2).padStart(2, "0")}`;
}

function pickHighlightProposal(
  snapshot: WeekendPlannerSnapshot,
  state?: WeekendStateFile | null,
  excludedTypes?: readonly ExcludedExperienceTypeItem[],
): { proposal: WeekendProposal | null; remainingCount: number; allExcluded: boolean } {
  const excludedSet = new Set((excludedTypes ?? []).map((item) => item.experienceType));
  const available = snapshot.proposals.filter((p) => !excludedSet.has(p.experienceType));
  if (available.length === 0) {
    return { proposal: null, remainingCount: 0, allExcluded: snapshot.proposals.length > 0 };
  }
  const preferred =
    (state?.selectedProposalId
      ? available.find((p) => p.id === state.selectedProposalId)
      : undefined) ?? available[0];
  return {
    proposal: preferred,
    remainingCount: Math.max(0, available.length - 1),
    allExcluded: false,
  };
}

export function WeekendProposalStrip({
  bundle,
  state,
  excludedTypes,
}: {
  bundle: WeekendCurrentBundle;
  state?: WeekendStateFile | null;
  excludedTypes?: readonly ExcludedExperienceTypeItem[];
}) {
  const { effectiveStatus, isExpired, snapshot, historicalSnapshot, statusHeadline } = bundle;

  let tone: "ready" | "amber" | "mint" | "muted" = "ready";
  let pill = "周末去哪";
  let title = statusHeadline;
  let meta = "";
  let ctaLabel = "去旅行页";

  if (effectiveStatus === "published" && snapshot) {
    const shortRange = formatShortRange(snapshot.weekendRange.from, snapshot.weekendRange.to);
    const { proposal, remainingCount, allExcluded } = pickHighlightProposal(snapshot, state, excludedTypes);

    if (snapshot.fridayAlert) {
      tone = "amber";
      pill = "周五天气微调";
      title = snapshot.fridayAlert.headline;
      meta = proposal ? `${proposal.title} · ${snapshot.fridayAlert.summary}` : snapshot.fridayAlert.summary;
      ctaLabel = "查看方案";
    } else if (proposal) {
      tone = "ready";
      pill = shortRange ? `这周末 ${shortRange}` : "这周末";
      title = proposal.title;
      const firstWeather = proposal.weatherSlots[0]
        ? `${proposal.weatherSlots[0].slotLabel} ${proposal.weatherSlots[0].condition} ${proposal.weatherSlots[0].tempRangeC}`
        : "";
      const stayBrief = proposal.hotelSummaryShort || proposal.paceLabel;
      const parts = [
        stayBrief,
        remainingCount > 0 ? `另有 ${remainingCount} 套备选` : "",
        firstWeather,
      ].filter(Boolean);
      meta = parts.join(" · ");
      ctaLabel = "去看看";
    } else if (allExcluded) {
      tone = "muted";
      pill = shortRange ? `这周末 ${shortRange}` : "这周末";
      title = "已避开本周备选体验类型";
      meta = "可进旅行页恢复已避开类型，或翻看季节灵感库";
      ctaLabel = "去旅行页";
    }
  } else if (effectiveStatus === "collecting") {
    tone = "amber";
    const shortRange = snapshot ? formatShortRange(snapshot.weekendRange.from, snapshot.weekendRange.to) : "";
    pill = shortRange ? `这周末 ${shortRange}` : "本周整理中";
    title = statusHeadline;
    meta = "可先去旅行页看季节灵感库";
    ctaLabel = "去旅行页";
  } else if (effectiveStatus === "rest_recommended") {
    tone = "mint";
    const shortRange = snapshot ? formatShortRange(snapshot.weekendRange.from, snapshot.weekendRange.to) : "";
    pill = shortRange ? `这周末 ${shortRange}` : "就近轻出";
    title = statusHeadline;
    meta = bundle.statusDetail;
    ctaLabel = "看附近安排";
  } else if (isExpired && historicalSnapshot) {
    tone = "muted";
    const shortRange = formatShortRange(
      historicalSnapshot.weekendRange.from,
      historicalSnapshot.weekendRange.to,
    );
    pill = shortRange ? `上期 ${shortRange}` : "上期周末";
    title = "上周末已结束，可在旅行页记一下轻反馈";
    meta = "未确认成行前不会计入正式足迹";
    ctaLabel = "去记一下";
  } else {
    tone = "amber";
    pill = "本周暂未更新";
    title = statusHeadline;
    meta = historicalSnapshot
      ? `可回看 ${historicalSnapshot.weekendRange.label} 归档或常驻灵感`
      : "可先到旅行页浏览常驻灵感或足迹地图";
    ctaLabel = "去旅行页";
  }

  return (
    <aside className={`weekend-entry-strip weekend-entry-strip--${tone}`} aria-label="周末去哪入口">
      <div className="weekend-entry-main">
        <span className="weekend-entry-pill">{pill}</span>
        <span className="weekend-entry-copy">
          <strong className="weekend-entry-title">{title}</strong>
          {meta ? <span className="weekend-entry-meta">{meta}</span> : null}
        </span>
      </div>
      <Link className="weekend-entry-cta" href="/travel?view=plan">
        <span>{ctaLabel}</span>
        <span aria-hidden="true">→</span>
      </Link>
    </aside>
  );
}
