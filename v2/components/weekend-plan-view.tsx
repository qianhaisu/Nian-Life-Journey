"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ExcludedExperienceTypeItem,
  InspirationItem,
  SundayOutcome,
  WeekendCurrentBundle,
  WeekendPlannerSnapshot,
  WeekendProposal,
  WeekendStateFile,
  WeekendStateGetResponse,
  WeekendStatePostResponse,
  WeekendWeatherCity,
} from "@/lib/weekend/types";

const SUNDAY_OUTCOMES: ReadonlyArray<{
  key: SundayOutcome;
  label: string;
  tags: readonly string[];
}> = [
  {
    key: "went_loved",
    label: "去了 · 大人小孩都喜欢",
    tags: ["季节刚好", "不挤舒服", "酒店加分", "车船太爱了"],
  },
  {
    key: "went_adult_meh",
    label: "去了 · 娃开心大人无聊",
    tags: ["太亲子化", "没逛到想逛的", "吃住一般"],
  },
  {
    key: "went_tired",
    label: "去了 · 太赶太累 / 不便",
    tags: ["车程太久", "步行太多", "没地儿歇脚", "推车不友好"],
  },
  {
    key: "went_pitfall",
    label: "去了 · 踩雷人多或异味",
    tags: ["人太多排队", "闭馆白跑", "有异味闷热", "跑一趟只吃饭"],
  },
  {
    key: "stayed_home",
    label: "这周没去 · 在家歇了",
    tags: ["天气变化", "孩子/大人疲惫", "没抢到票/房", "临时有事"],
  },
];

function isSafeWeekendMediaUrl(src?: string): src is string {
  return typeof src === "string" && src.startsWith("/api/weekend-media/web/");
}

function formatZhCalendarDate(raw?: string | null): string {
  if (!raw) return "";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return raw;
  return `${Number(match[1])} 年 ${Number(match[2])} 月 ${Number(match[3])} 日`;
}

function resolveWeatherIconKind(icon?: string, text?: string): "sun" | "cloud_sun" | "cloud" | "rain" | "wind" {
  if (icon === "sun" || icon === "cloud_sun" || icon === "cloud" || icon === "rain" || icon === "wind") {
    return icon;
  }
  const source = text ?? "";
  if (source.includes("雨")) return "rain";
  if (source.includes("风")) return "wind";
  if (source.includes("晴") && source.includes("多云")) return "cloud_sun";
  if (source.includes("阴") || source.includes("多云")) return "cloud";
  return "sun";
}

function WeatherSvg({ kind }: { kind: "sun" | "cloud_sun" | "cloud" | "rain" | "wind" }) {
  const base = {
    className: "wp-weather-ico",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (kind === "sun") {
    return (
      <svg {...base}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </svg>
    );
  }
  if (kind === "cloud_sun") {
    return (
      <svg {...base}>
        <path d="M12 2v2M4.93 4.93l1.41 1.41M20 12h2M19.07 4.93l-1.41 1.41M15.947 12.65a4 4 0 0 0-5.925-4.128" />
        <path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z" />
      </svg>
    );
  }
  if (kind === "rain") {
    return (
      <svg {...base}>
        <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
        <path d="M8 19v2M12 19v2M16 19v2" />
      </svg>
    );
  }
  if (kind === "wind") {
    return (
      <svg {...base}>
        <path d="M12.8 19.6A2 2 0 1 0 14 16H2" />
        <path d="M17.5 8a2.5 2.5 0 1 1 2 4H2" />
        <path d="M9.8 4.4A2 2 0 1 1 11 8H2" />
      </svg>
    );
  }
  return (
    <svg {...base}>
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    </svg>
  );
}

function selectWeatherCompareCities(snapshot: WeekendPlannerSnapshot): WeekendWeatherCity[] {
  const cities = snapshot.weatherSummary.cities;
  if (cities.length <= 3) return cities;

  const proposalCodes: string[] = [];
  for (const proposal of snapshot.proposals) {
    for (const src of proposal.sources) {
      const m = src.url.match(/\/weather\/(\d+)\.shtml/i);
      if (m && !proposalCodes.includes(m[1])) proposalCodes.push(m[1]);
    }
  }

  const matched = proposalCodes
    .map((code) => cities.find((c) => c.code === code))
    .filter((c): c is WeekendWeatherCity => Boolean(c));

  if (matched.length >= 3) return matched.slice(0, 3);

  const nonRef = cities.filter((c) => !c.city.includes("参考") && !matched.some((m) => m.code === c.code));
  return [...matched, ...nonRef].slice(0, 3);
}

function mapNodeCoords(proposal: WeekendProposal, index: number, total: number): { x: number; y: number } {
  const dir = proposal.driveFromSandun.directionFromSandun;
  const dist = proposal.driveFromSandun.distanceKmEstimate;
  if (dist >= 120 || dir.includes("上海") || dir.includes("东北")) {
    return { x: 516, y: 58 };
  }
  if (dir.includes("西北")) {
    return { x: 248, y: 38 };
  }
  if (dir.includes("东南") || dir.includes("西南")) {
    return { x: 248, y: 128 };
  }
  const fallbackY = total <= 1 ? 84 : 42 + index * 42;
  return { x: 270 + Math.min(240, Math.round(dist * 1.2)), y: fallbackY };
}

function compactDriveLabel(proposal: WeekendProposal): string {
  const [min, max] = proposal.driveFromSandun.durationMinutesRange;
  if (min >= 60) {
    const h1 = Math.floor(min / 60);
    const m1 = min % 60;
    const h2 = Math.floor(max / 60);
    const m2 = max % 60;
    const left = m1 ? `${h1}h${m1}m` : `${h1}h`;
    const right = m2 ? `${h2}h${m2}m` : `${h2}h`;
    return `${left}–${right}${proposal.isOvernight ? " · 过夜" : ""}`;
  }
  return `${min}–${max} 分钟${proposal.isOvernight ? " · 过夜" : " · 当日"}`;
}

function shortProposalLabel(proposal: WeekendProposal): string {
  const clean = proposal.title.split("（")[0]?.trim() || proposal.title;
  return clean.length > 18 ? `${clean.slice(0, 18)}…` : clean;
}

export function WeekendPlanView({
  bundle,
  initialState,
  initialExcludedTypes,
}: {
  bundle: WeekendCurrentBundle;
  initialState: WeekendStateFile | null;
  initialExcludedTypes: ExcludedExperienceTypeItem[];
}) {
  const router = useRouter();
  const { effectiveStatus, isExpired, snapshot, historicalSnapshot, statusHeadline, statusDetail } = bundle;
  const displaySnapshot = snapshot ?? historicalSnapshot;
  const activeWeekId = snapshot?.weekId ?? historicalSnapshot?.weekId ?? null;

  const [weekState, setWeekState] = useState<WeekendStateFile | null>(initialState);
  const [excludedTypes, setExcludedTypes] = useState<ExcludedExperienceTypeItem[]>(initialExcludedTypes);
  const [inspFilter, setInspFilter] = useState<"all" | "seasonal" | "evergreen">("all");
  const [openInsp, setOpenInsp] = useState<Record<string, boolean>>({});
  const [statusMessage, setStatusMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const didMutateRef = useRef(false);

  useEffect(() => {
    if (!activeWeekId) return;
    let alive = true;
    fetch(`/api/weekend-state?weekId=${encodeURIComponent(activeWeekId)}`, { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<WeekendStateGetResponse>) : null))
      .then((data) => {
        if (!alive || !data?.ok || didMutateRef.current) return;
        setWeekState(data.state);
        setExcludedTypes(data.excludedExperienceTypes);
      })
      .catch(() => {
        // Keep SSR-rendered state if network fetch is unavailable.
      });
    return () => {
      alive = false;
    };
  }, [activeWeekId]);

  const excludedSet = useMemo(
    () => new Set(excludedTypes.map((item) => item.experienceType)),
    [excludedTypes],
  );

  const activeProposals = useMemo(() => {
    if (effectiveStatus !== "published" || !snapshot) return [];
    return snapshot.proposals.filter((p) => !excludedSet.has(p.experienceType));
  }, [effectiveStatus, snapshot, excludedSet]);

  const inspirationItems = useMemo(() => {
    const rawPool: InspirationItem[] =
      snapshot?.inspirationPool ?? historicalSnapshot?.inspirationPool ?? [];
    return rawPool.filter((item) => {
      if (item.availabilityStatus === "blocked") return false;
      if (item.experienceType && excludedSet.has(item.experienceType)) return false;
      if (inspFilter === "seasonal") return item.poolKind === "seasonalLimited";
      if (inspFilter === "evergreen") return item.poolKind === "evergreen";
      return true;
    });
  }, [snapshot, historicalSnapshot, excludedSet, inspFilter]);

  const weatherCities = useMemo(() => {
    if (effectiveStatus !== "published" || !snapshot) return [];
    return selectWeatherCompareCities(snapshot);
  }, [effectiveStatus, snapshot]);

  const noGoAlerts = displaySnapshot?.noGoAlerts ?? [];

  async function postState(
    payload: Record<string, unknown>,
    key: string,
    successText: string,
  ): Promise<boolean> {
    didMutateRef.current = true;
    setBusyKey(key);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/weekend-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setStatusMessage({ tone: "error", text: "未能保存本次记录，请稍后再试。" });
        return false;
      }
      const data = (await res.json()) as WeekendStatePostResponse;
      if (!data.ok) {
        setStatusMessage({ tone: "error", text: "未能保存本次记录，请稍后再试。" });
        return false;
      }
      if (data.state) setWeekState(data.state);
      if (Array.isArray(data.excludedExperienceTypes)) {
        setExcludedTypes(data.excludedExperienceTypes);
      }
      setStatusMessage({ tone: "ok", text: successText });
      return true;
    } catch {
      setStatusMessage({ tone: "error", text: "网络暂时不可达，未能保存到服务端。" });
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  function handleExcludeType(experienceType: string, label: string) {
    void postState(
      {
        action: "excludeType",
        mode: "add",
        experienceType,
        label,
        addedBy: "parent",
        ...(activeWeekId ? { weekId: activeWeekId } : {}),
      },
      `exclude:${experienceType}`,
      `已避开「${label}」，可在页面底部随时撤销。`,
    );
  }

  function handleUndoExclude(item: ExcludedExperienceTypeItem) {
    void postState(
      {
        action: "excludeType",
        mode: "remove",
        experienceType: item.experienceType,
        ...(activeWeekId ? { weekId: activeWeekId } : {}),
      },
      `undo:${item.experienceType}`,
      `已恢复「${item.label}」。`,
    );
  }

  function handleSundayOutcome(outcome: SundayOutcome, nextTags?: string[]) {
    if (!activeWeekId) return;
    const currentOutcome = weekState?.sundayFeedback.outcome;
    const tags = nextTags ?? (currentOutcome === outcome ? weekState?.sundayFeedback.tags ?? [] : []);
    const proposalId = weekState?.selectedProposalId ?? activeProposals[0]?.id ?? null;
    void postState(
      {
        action: "submitSundayFeedback",
        weekId: activeWeekId,
        outcome,
        tags,
        proposalId,
        receiptKey: `fb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      },
      `feedback:${outcome}`,
      "已保存本周轻反馈。",
    );
  }

  function handleToggleFeedbackTag(tag: string) {
    const currentOutcome = weekState?.sundayFeedback.outcome;
    if (!currentOutcome || !activeWeekId) return;
    const currentTags = weekState?.sundayFeedback.tags ?? [];
    const nextTags = currentTags.includes(tag)
      ? currentTags.filter((t) => t !== tag)
      : [...currentTags, tag];
    handleSundayOutcome(currentOutcome, nextTags);
  }

  function handleAckFridayAlert() {
    if (!activeWeekId) return;
    void postState(
      { action: "ackFridayAlert", weekId: activeWeekId, adoptedSwap: true },
      "friday-ack",
      "已记下周五天气提醒。",
    );
  }

  const totalInspCount = (snapshot?.inspirationPool ?? historicalSnapshot?.inspirationPool ?? []).filter(
    (i) => i.availabilityStatus !== "blocked",
  ).length;
  const activeOutcome = weekState?.sundayFeedback.outcome ?? null;
  const activeOutcomeMeta = SUNDAY_OUTCOMES.find((o) => o.key === activeOutcome);
  const activeTags = weekState?.sundayFeedback.tags ?? [];

  return (
    <div className="wp-shell">
      {effectiveStatus === "published" && snapshot?.fridayAlert ? (
        <section
          className={`wp-banner ${snapshot.fridayAlert.severity === "adjust" ? "wp-banner--amber" : "wp-banner--blue"}`}
          aria-label="周五天气复核提示"
        >
          <div className="wp-banner-copy">
            <h2 className="wp-banner-title">{snapshot.fridayAlert.headline}</h2>
            <p className="wp-banner-desc">{snapshot.fridayAlert.summary}</p>
            {snapshot.fridayAlert.swapSuggestion ? (
              <p className="wp-banner-sub">{snapshot.fridayAlert.swapSuggestion}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="wp-btn wp-btn--secondary"
            disabled={busyKey === "friday-ack"}
            onClick={handleAckFridayAlert}
          >
            {weekState?.fridayAlertAck.adoptedSwap ? "已知晓提醒" : "知道了"}
          </button>
        </section>
      ) : null}

      {effectiveStatus === "collecting" ? (
        <section className="wp-banner wp-banner--amber" aria-label="本周提案整理状态">
          <div className="wp-banner-copy">
            <h2 className="wp-banner-title">{statusHeadline}</h2>
            <p className="wp-banner-desc">{statusDetail}</p>
            <p className="wp-banner-sub">
              整理步骤：核对周六日分段天气 → 翻近期真实实拍 → 筛掉拥挤与闭馆点
            </p>
          </div>
          {historicalSnapshot ? (
            <Link className="wp-btn wp-btn--secondary" href={`/travel/weekend/${historicalSnapshot.weekId}`}>
              只读看上期（{historicalSnapshot.weekendRange.satLabel}–{historicalSnapshot.weekendRange.sunLabel}）
            </Link>
          ) : null}
        </section>
      ) : null}

      {effectiveStatus === "unavailable" && isExpired && historicalSnapshot ? (
        <section className="wp-banner wp-banner--muted" aria-label="往期方案归档">
          <div className="wp-banner-copy">
            <h2 className="wp-banner-title">
              往期方案 · {historicalSnapshot.weekendRange.label}（已过周末）
            </h2>
            <p className="wp-banner-desc">
              本周末已结束，未确认实际成行前不会计入正式足迹；可在底部记一次周日轻反馈。
            </p>
          </div>
          <Link className="wp-btn wp-btn--secondary" href={`/travel/weekend/${historicalSnapshot.weekId}`}>
            只读回看 {historicalSnapshot.weekendRange.label} →
          </Link>
        </section>
      ) : null}

      {effectiveStatus === "unavailable" && !isExpired ? (
        <section className="wp-banner wp-banner--amber" aria-label="本周推荐暂未更新">
          <div className="wp-banner-copy">
            <h2 className="wp-banner-title">{statusHeadline}</h2>
            <p className="wp-banner-desc">{statusDetail}</p>
            {snapshot?.unavailableNotice?.actionForTeddy ? (
              <p className="wp-banner-sub">{snapshot.unavailableNotice.actionForTeddy}</p>
            ) : null}
          </div>
          {historicalSnapshot ? (
            <Link className="wp-btn wp-btn--secondary" href={`/travel/weekend/${historicalSnapshot.weekId}`}>
              查看往期归档（{historicalSnapshot.weekendRange.label}）→
            </Link>
          ) : null}
        </section>
      ) : null}

      {effectiveStatus === "rest_recommended" && snapshot ? (
        <section className="wp-panel wp-panel--mint" aria-label="本周就近轻出建议">
          <div className="wp-panel-head">
            <div>
              <h2 className="wp-panel-title">{statusHeadline}</h2>
              <p className="wp-panel-sub">
                {snapshot.restRecommendation?.reason || statusDetail}
                {snapshot.restRecommendation?.weatherOrCrowdTrigger
                  ? ` · ${snapshot.restRecommendation.weatherOrCrowdTrigger}`
                  : ""}
              </p>
            </div>
          </div>
          {snapshot.restRecommendation?.microActivities?.length ? (
            <div className="wp-micro-grid">
              {snapshot.restRecommendation.microActivities.map((act, idx) => (
                <article key={`${act.title}-${idx}`} className="wp-micro-card">
                  <div className="wp-badge-row">
                    <span className={`wp-badge ${act.indoor ? "wp-badge--blue" : "wp-badge--mint"}`}>
                      {act.indoor ? "室内兜底" : "家门口户外"}
                    </span>
                    <span className="wp-badge wp-badge--muted">{act.driveMinutes}</span>
                  </div>
                  <h3>{act.title}</h3>
                  <p>{act.note}</p>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {effectiveStatus === "published" && snapshot && weatherCities.length > 0 ? (
        <section className="wp-weather-panel" aria-label="周末三地天气比较">
          <div className="wp-weather-grid">
            {weatherCities.map((city) => {
              const sat = city.daysSummary[0];
              const sun = city.daysSummary[1];
              const combinedText = `${sat?.summary ?? ""} ${sun?.summary ?? ""} ${city.weekendTip ?? ""}`;
              const hasCaution = /陡降|降温|起风|大风|小雨|中雨|大雨|阵雨/.test(combinedText);
              const iconKind = resolveWeatherIconKind(sat?.icon, sat?.conditionShort ?? sat?.summary);
              return (
                <div key={city.code || city.city} className="wp-weather-item">
                  <span className={`wp-weather-ico-wrap ${hasCaution ? "is-warn" : ""}`} aria-hidden="true">
                    <WeatherSvg kind={iconKind} />
                  </span>
                  <div className="wp-weather-body">
                    <div className="wp-weather-city">{city.city}</div>
                    <div className="wp-weather-lines">
                      {sat ? (
                        <div className="wp-weather-line">
                          <span>{sat.dayLabel}</span>：{sat.summary}
                        </div>
                      ) : null}
                      {sun ? (
                        <div className="wp-weather-line">
                          <span>{sun.dayLabel}</span>：{sun.summary}
                        </div>
                      ) : null}
                    </div>
                    {city.weekendTip ? (
                      <div className={`wp-weather-tip ${hasCaution ? "is-warn" : ""}`}>
                        {city.weekendTip}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          {snapshot.weatherSummary.precipProbabilityPct === null && snapshot.weatherSummary.precipProbabilityNote ? (
            <p className="wp-weather-footnote">
              {snapshot.weatherSummary.horizonConfidenceLabel} · 短时降水概率待周五更新（预估）
            </p>
          ) : null}
        </section>
      ) : null}

      {effectiveStatus === "published" && snapshot ? (
        <>
          {activeProposals.length === 0 ? (
            <div className="wp-panel wp-empty-panel">
              <p>当前已将本周全部体验类型加入「已避开」，可在页面底部点「撤销」恢复推荐。</p>
            </div>
          ) : (
            <>
              {(() => {
                const lead = activeProposals[0];
                const backups = activeProposals.slice(1);
                const leadMedia = isSafeWeekendMediaUrl(lead.heroImage?.src) ? lead.heroImage : null;
                const leadDetailHref = `/travel/weekend/${snapshot.weekId}?proposal=${encodeURIComponent(lead.id)}`;
                const leadLiveHref = `${leadDetailHref}&mode=live`;
                return (
                  <>
                    <article className="wp-lead-card" aria-label={lead.title}>
                      <div className="wp-lead-media">
                        {leadMedia ? (
                          <Image
                            src={leadMedia.src}
                            alt={leadMedia.alt || lead.title}
                            width={1280}
                            height={720}
                            sizes="(max-width: 820px) 100vw, 540px"
                            priority
                            unoptimized
                          />
                        ) : null}
                      </div>
                      <div className="wp-lead-body">
                        <div className="wp-badge-row">
                          <span className="wp-badge wp-badge--blue">{lead.badge}</span>
                          <span className="wp-badge wp-badge--mint">{lead.experienceTypeLabel}</span>
                          {lead.signalStrength === "weak" ? (
                            <span className="wp-badge wp-badge--amber">信号较弱</span>
                          ) : null}
                          {weekState?.selectedProposalId === lead.id ? (
                            <span className="wp-badge wp-badge--lavender">本周关注</span>
                          ) : null}
                        </div>
                        <h2 className="wp-card-title">{lead.title}</h2>
                        <p className="wp-card-reason">{lead.oneLineReason}</p>
                        <dl className="wp-kv-list">
                          <div className="wp-kv-row">
                            <dt>三墩车程</dt>
                            <dd>{lead.driveFromSandun.durationLabel}</dd>
                          </div>
                          <div className="wp-kv-row">
                            <dt>时段天气</dt>
                            <dd>
                              {lead.weatherSlots
                                .map((w) => `${w.slotLabel} ${w.condition} ${w.tempRangeC}`)
                                .join(" · ")}
                            </dd>
                          </div>
                          <div className="wp-kv-row">
                            <dt>{lead.isOvernight ? "住宿安排" : "当日安排"}</dt>
                            <dd>
                              {lead.hotelSummaryShort ||
                                (lead.hotel.required ? lead.hotel.options[0]?.name : lead.hotel.note)}
                            </dd>
                          </div>
                          {lead.latestDepartureCutoff.hasCutoff ? (
                            <div className="wp-kv-row">
                              <dt>出发提醒</dt>
                              <dd>{lead.latestDepartureCutoff.headline}</dd>
                            </div>
                          ) : null}
                        </dl>
                        <blockquote className="wp-quote">
                          {lead.crowdAndTraffic.roadPattern.summary}
                        </blockquote>
                        <div className="wp-actions">
                          <Link className="wp-btn wp-btn--primary" href={leadDetailHref}>
                            看详情{lead.isOvernight ? "与酒店" : ""}
                          </Link>
                          <Link className="wp-btn wp-btn--secondary" href={leadLiveHref}>
                            周六现场
                          </Link>
                          <button
                            type="button"
                            className="wp-btn wp-btn--ghost"
                            disabled={busyKey === `exclude:${lead.experienceType}`}
                            onClick={() => handleExcludeType(lead.experienceType, lead.experienceTypeLabel)}
                          >
                            不喜欢这类
                          </button>
                        </div>
                      </div>
                    </article>

                    {backups.length > 0 ? (
                      <div className="wp-backups-grid">
                        {backups.map((item) => {
                          const media = isSafeWeekendMediaUrl(item.heroImage?.src) ? item.heroImage : null;
                          const detailHref = `/travel/weekend/${snapshot.weekId}?proposal=${encodeURIComponent(item.id)}`;
                          const liveHref = `${detailHref}&mode=live`;
                          return (
                            <article key={item.id} className="wp-backup-card" aria-label={item.title}>
                              <div className="wp-backup-media">
                                {media ? (
                                  <Image
                                    src={media.src}
                                    alt={media.alt || item.title}
                                    width={1160}
                                    height={870}
                                    sizes="(max-width: 760px) 100vw, 520px"
                                    unoptimized
                                  />
                                ) : null}
                              </div>
                              <div className="wp-backup-body">
                                <div className="wp-badge-row">
                                  <span className="wp-badge wp-badge--muted">{item.badge}</span>
                                  <span className="wp-badge wp-badge--mint">{item.experienceTypeLabel}</span>
                                  {item.signalStrength === "weak" ? (
                                    <span className="wp-badge wp-badge--amber">信号较弱</span>
                                  ) : null}
                                  {weekState?.selectedProposalId === item.id ? (
                                    <span className="wp-badge wp-badge--lavender">本周关注</span>
                                  ) : null}
                                </div>
                                <h3 className="wp-card-title wp-card-title--sub">{item.title}</h3>
                                <p className="wp-card-reason">{item.oneLineReason}</p>
                                <dl className="wp-kv-list">
                                  <div className="wp-kv-row">
                                    <dt>车程与天气</dt>
                                    <dd>
                                      {item.driveFromSandun.durationLabel} ·{" "}
                                      {item.weatherSlots
                                        .map((w) => `${w.slotLabel} ${w.condition} ${w.tempRangeC}`)
                                        .join(" / ")}
                                    </dd>
                                  </div>
                                  <div className="wp-kv-row">
                                    <dt>节奏与贴士</dt>
                                    <dd>
                                      {item.latestDepartureCutoff.hasCutoff
                                        ? item.latestDepartureCutoff.headline
                                        : item.paceLabel}
                                    </dd>
                                  </div>
                                </dl>
                                <blockquote className="wp-quote">
                                  {item.crowdAndTraffic.roadPattern.summary}
                                </blockquote>
                                <div className="wp-actions wp-actions--footer">
                                  <Link className="wp-btn wp-btn--secondary" href={detailHref}>
                                    看详情
                                  </Link>
                                  <Link className="wp-btn wp-btn--quiet" href={liveHref}>
                                    周六现场
                                  </Link>
                                  <button
                                    type="button"
                                    className="wp-btn wp-btn--ghost"
                                    disabled={busyKey === `exclude:${item.experienceType}`}
                                    onClick={() => handleExcludeType(item.experienceType, item.experienceTypeLabel)}
                                  >
                                    不喜欢这类
                                  </button>
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    ) : null}
                  </>
                );
              })()}

              <section className="wp-panel wp-route-panel" aria-label="杭州三墩出发相对方位与车程图">
                <div className="wp-panel-head">
                  <div>
                    <h2 className="wp-panel-title">三墩出发相对方位与车程</h2>
                    <p className="wp-panel-sub">点任一目的地，直接查看详细时间轴与应急替代</p>
                  </div>
                </div>
                <svg
                  className="wp-route-svg"
                  viewBox="0 0 640 168"
                  role="img"
                  aria-label="从杭州三墩出发到各备选目的地的相对方位与车程示意"
                >
                  {activeProposals.map((p, idx) => {
                    const pos = mapNodeCoords(p, idx, activeProposals.length);
                    const stroke =
                      p.slot === "preferred"
                        ? "#2563EB"
                        : p.slot === "alt_1h"
                          ? "#047857"
                          : "#C2410C";
                    return (
                      <line
                        key={`line-${p.id}`}
                        x1="88"
                        y1="96"
                        x2={pos.x}
                        y2={pos.y}
                        stroke={stroke}
                        strokeWidth={p.slot === "preferred" ? 2.5 : 2}
                        strokeOpacity={p.slot === "preferred" ? 0.85 : 0.45}
                      />
                    );
                  })}

                  <circle cx="88" cy="96" r="6.5" fill="#0F172A" />
                  <text x="88" y="80" textAnchor="middle" fill="#0F172A" fontSize="12" fontWeight="700">
                    杭州三墩
                  </text>

                  {activeProposals.map((p, idx) => {
                    const pos = mapNodeCoords(p, idx, activeProposals.length);
                    const fill =
                      p.slot === "preferred"
                        ? "#2563EB"
                        : p.slot === "alt_1h"
                          ? "#047857"
                          : "#C2410C";
                    const href = `/travel/weekend/${snapshot.weekId}?proposal=${encodeURIComponent(p.id)}`;
                    const labelText = shortProposalLabel(p);
                    const isRightEdge = pos.x > 420;
                    const textAnchor = isRightEdge ? "middle" : "start";
                    const tx = isRightEdge ? pos.x : pos.x + 12;
                    const ty = isRightEdge ? pos.y - 14 : pos.y - 2;
                    const subY = isRightEdge ? pos.y + 22 : pos.y + 14;
                    return (
                      <g
                        key={p.id}
                        className="wp-map-node"
                        role="link"
                        tabIndex={0}
                        aria-label={`查看 ${p.title}`}
                        onClick={() => router.push(href)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            router.push(href);
                          }
                        }}
                      >
                        <circle cx={pos.x} cy={pos.y} r="7" fill={fill} />
                        <text x={tx} y={ty} textAnchor={textAnchor} fill="#0F172A" fontSize="12" fontWeight="700">
                          {labelText}
                        </text>
                        <text x={tx} y={subY} textAnchor={textAnchor} fill="#526075" fontSize="11">
                          {compactDriveLabel(p)}
                        </text>
                      </g>
                    );
                  })}
                </svg>
                <div className="wp-route-links">
                  {activeProposals.map((p) => (
                    <Link
                      key={`link-${p.id}`}
                      className="wp-route-chip"
                      href={`/travel/weekend/${snapshot.weekId}?proposal=${encodeURIComponent(p.id)}`}
                    >
                      <span>{shortProposalLabel(p)}</span>
                      <span aria-hidden="true">→</span>
                    </Link>
                  ))}
                </div>
              </section>
            </>
          )}
        </>
      ) : null}

      <section className="wp-panel wp-insp-panel" aria-label="季节灵感库">
        <div className="wp-panel-head">
          <div>
            <h2 className="wp-panel-title">季节灵感库（{totalInspCount} 处实景备选）</h2>
            <p className="wp-panel-sub">
              留给换口味或临时起意出门，默认只保留真实配图、完整理由与避坑提醒，按需展开开放门票与小红书参考
            </p>
          </div>
          <div className="wp-filter-pills" role="group" aria-label="筛选季节灵感库">
            <button
              type="button"
              className={`wp-filter-btn ${inspFilter === "all" ? "is-active" : ""}`}
              onClick={() => setInspFilter("all")}
            >
              全部 ({totalInspCount})
            </button>
            <button
              type="button"
              className={`wp-filter-btn ${inspFilter === "seasonal" ? "is-active" : ""}`}
              onClick={() => setInspFilter("seasonal")}
            >
              应季限定
            </button>
            <button
              type="button"
              className={`wp-filter-btn ${inspFilter === "evergreen" ? "is-active" : ""}`}
              onClick={() => setInspFilter("evergreen")}
            >
              常驻
            </button>
          </div>
        </div>

        {inspirationItems.length === 0 ? (
          <p className="wp-empty-copy">当前筛选下暂无未避开的灵感条目。</p>
        ) : (
          <div className="wp-insp-grid">
            {inspirationItems.map((item) => {
              const isOpen = Boolean(openInsp[item.id]);
              const media = isSafeWeekendMediaUrl(item.image?.src) ? item.image : null;
              const isSeasonal = item.poolKind === "seasonalLimited";
              const kf = item.keyFacts;
              const openingHours = kf?.openingHours?.trim() || "待确认";
              const ticketSummary = kf?.ticketSummary?.trim() || "待确认";
              const bookingChannel = kf?.bookingChannel?.trim() || "待确认";
              const strollerNote = kf?.strollerNote?.trim() || "待确认";
              const nonXhsSources = (item.sources ?? []).filter(
                (url) => !String(url).includes("xiaohongshu.com"),
              );
              const expType = item.experienceType;
              const expLabel = item.experienceTypeLabel || item.title;

              return (
                <article key={item.id} className="wp-insp-card">
                  <div className="wp-insp-media">
                    {media ? (
                      <Image
                        src={media.src}
                        alt={media.alt || item.title}
                        width={1080}
                        height={675}
                        sizes="(max-width: 720px) 100vw, 480px"
                        unoptimized
                      />
                    ) : null}
                  </div>
                  <div className="wp-insp-body">
                    <div className="wp-badge-row">
                      <span className={`wp-badge ${isSeasonal ? "wp-badge--mint" : "wp-badge--muted"}`}>
                        {isSeasonal ? "应季限定" : "常驻备选"}
                      </span>
                      {item.signalStrength === "weak" ? (
                        <span className="wp-badge wp-badge--amber">信号较弱</span>
                      ) : null}
                    </div>
                    <h3 className="wp-insp-title">{item.title}</h3>
                    <p className="wp-insp-meta">
                      <span>{item.region}</span>
                      <span> · 车程：{item.driveFromSandun || "待确认"}</span>
                    </p>
                    <p className="wp-insp-why">{item.whyThisWeek}</p>
                    {item.caveat ? <div className="wp-insp-caveat">{item.caveat}</div> : null}
                    <div className="wp-insp-actions">
                      <button
                        type="button"
                        className="wp-btn wp-btn--secondary"
                        aria-expanded={isOpen}
                        onClick={() =>
                          setOpenInsp((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                        }
                      >
                        {isOpen ? "收起详情" : "查看开放门票与小红书"}
                      </button>
                      {expType ? (
                        <button
                          type="button"
                          className="wp-btn wp-btn--ghost"
                          disabled={busyKey === `exclude:${expType}`}
                          onClick={() => handleExcludeType(expType, expLabel)}
                        >
                          不喜欢这类
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {isOpen ? (
                    <div className="wp-insp-expanded">
                      <dl className="wp-facts-grid">
                        <div>
                          <dt>开放时间</dt>
                          <dd>{openingHours}</dd>
                        </div>
                        <div>
                          <dt>门票与预约</dt>
                          <dd>
                            {ticketSummary}（{bookingChannel}）
                          </dd>
                        </div>
                        <div>
                          <dt>推车与停车</dt>
                          <dd>{strollerNote}</dd>
                        </div>
                      </dl>

                      {item.xhsEvidence.length > 0 ? (
                        <div className="wp-xhs-list">
                          <strong>小红书近期实拍（文字参考与直跳链接）</strong>
                          {item.xhsEvidence.map((note) => (
                            <div key={note.noteId || note.seq} className="wp-xhs-row">
                              <div className="wp-xhs-head">
                                <span className="wp-xhs-seq">#{note.seq}</span>
                                <a href={note.url} target="_blank" rel="noopener noreferrer">
                                  {note.title}
                                </a>
                              </div>
                              <div className="wp-xhs-stats">
                                {note.author} · {formatZhCalendarDate(note.publishedAt)} · {note.likes} 赞 /{" "}
                                {note.collects} 藏 / {note.commentCountText}
                              </div>
                              <div className="wp-xhs-note">
                                {note.keyTakeaway}
                                {note.commentFeedback ? `；${note.commentFeedback}` : ""}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {nonXhsSources.length > 0 ? (
                        <div className="wp-insp-refs">
                          <strong>参考来源：</strong>
                          {nonXhsSources.map((url, idx) => (
                            <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                              参考链接 {idx + 1}
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {noGoAlerts.length > 0 ? (
        <details className="wp-nogo-details">
          <summary>本周已避开的拥挤与踩坑提醒（{noGoAlerts.length} 条）</summary>
          <ul className="wp-nogo-list">
            {noGoAlerts.map((alert) => (
              <li key={alert.id} className="wp-nogo-item">
                <div className="wp-nogo-head">
                  <strong>{alert.venue}</strong>
                  <span className="wp-badge wp-badge--muted">{alert.blockedRange}</span>
                </div>
                <p>{alert.reason}</p>
                {alert.sourceUrl ? (
                  <a href={alert.sourceUrl} target="_blank" rel="noopener noreferrer">
                    查看参考实拍
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <section id="sunday-feedback" className="wp-panel wp-feedback-panel" aria-label="周日轻反馈与已避开类型">
        <div className="wp-panel-head">
          <div>
            <h2 className="wp-panel-title">周日轻反馈</h2>
            <p className="wp-panel-sub">
              点一下真实感受即可，只用于微调下周推荐口味，不会写进正式旅行足迹
            </p>
          </div>
          {statusMessage ? (
            <span
              role="status"
              className={`wp-save-status ${statusMessage.tone === "error" ? "is-error" : "is-ok"}`}
            >
              {statusMessage.text}
            </span>
          ) : null}
        </div>

        <div className="wp-feedback-row">
          {SUNDAY_OUTCOMES.map((item) => {
            const isSelected = activeOutcome === item.key;
            return (
              <button
                key={item.key}
                type="button"
                disabled={!activeWeekId || busyKey === `feedback:${item.key}`}
                className={`wp-btn wp-btn--secondary ${isSelected ? "is-selected" : ""}`}
                aria-pressed={isSelected}
                onClick={() => handleSundayOutcome(item.key)}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {activeOutcomeMeta ? (
          <div className="wp-feedback-tags" aria-label="补充具体感受标签">
            <span className="wp-feedback-tags-label">补充标签（可选）：</span>
            {activeOutcomeMeta.tags.map((tag) => {
              const selected = activeTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  className={`wp-tag-pill ${selected ? "is-selected" : ""}`}
                  aria-pressed={selected}
                  disabled={!activeWeekId || busyKey !== null}
                  onClick={() => handleToggleFeedbackTag(tag)}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="wp-excluded-bar" aria-label="已避开体验类型">
          <span className="wp-excluded-label">已避开类型：</span>
          {excludedTypes.length > 0 ? (
            <div className="wp-excluded-chips">
              {excludedTypes.map((item) => (
                <span key={item.experienceType} className="wp-excluded-chip">
                  <span>{item.label}</span>
                  <button
                    type="button"
                    className="wp-undo-btn"
                    disabled={busyKey === `undo:${item.experienceType}`}
                    onClick={() => handleUndoExclude(item)}
                  >
                    撤销
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <span className="wp-excluded-empty">暂无（点击方案或灵感卡上的「不喜欢这类」即可加入）</span>
          )}
        </div>
      </section>
    </div>
  );
}
