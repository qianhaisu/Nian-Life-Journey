"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CrowdRiskLevel,
  DegradationBranch,
  DepartureKey,
  ExcludedExperienceTypeItem,
  VerificationStatus,
  WeekendHotelOption,
  WeekendPlannerSnapshot,
  WeekendProposal,
  WeekendStateFile,
  WeekendStateGetResponse,
  WeekendStatePostResponse,
} from "@/lib/weekend/types";

type EmergencyKey = "rain" | "childTired" | "crowded" | "returnEarly";

const CHECK_SECTION_TITLES: Record<
  keyof WeekendProposal["worthGoingChecks"],
  string
> = {
  coreAnchorAndReason: "核心体验",
  driveToContentRatio: "车程与游玩节奏",
  loop15MinAndRestWindow: "15 分钟随时歇脚",
  rainOrFailBackup: "变天室内备选",
  adultDelight: "大人的期待",
  notJustDiningCounterCheck: "不跑一趟只吃饭",
};

const CROWD_RISK_LABELS: Record<CrowdRiskLevel, string> = {
  low: "人流较少",
  low_to_medium: "适中偏静",
  medium: "局部热闹",
  high: "人流较多",
};

const TIMELINE_CATEGORY_LABELS: Record<string, string> = {
  transport: "车程抵达",
  lawn: "草坪水岸",
  shopping: "逛街买物",
  street_walk: "街区漫步",
  rest: "休整歇脚",
  rest_buffer: "休整歇脚",
  outdoor_walk: "户外散步",
  boat: "画舫游船",
  boat_nature: "画舫游船",
  market: "假日市集",
  farming: "田园农事",
  indoor_play: "室内休闲",
  dining: "用餐补给",
  hotel_rest: "回房休整",
  return: "返程回家",
  scenic: "游览逛园",
};

function formatTimelineCategory(raw?: string): string {
  if (!raw) return "时段安排";
  const mapped = TIMELINE_CATEGORY_LABELS[raw];
  if (mapped) return mapped;
  return /[\u4e00-\u9fff]/.test(raw) ? raw : "时段安排";
}

const EMERGENCY_BUTTONS: ReadonlyArray<{
  key: EmergencyKey;
  label: string;
  sub: string;
}> = [
  { key: "rain", label: "下雨 / 冷风", sub: "15 分钟内室内备选" },
  { key: "childTired", label: "孩子累了", sub: "马上就近歇脚" },
  { key: "crowded", label: "人太多", sub: "错峰散开路线" },
  { key: "returnEarly", label: "提前回家", sub: "随时折返指引" },
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

function verificationBadgeText(status: VerificationStatus): string {
  if (status === "verified") return "已确认";
  if (status === "estimated") return "预估";
  return "待确认";
}

function verificationBadgeClass(status: VerificationStatus): string {
  if (status === "verified") return "wd-badge wd-badge--mint";
  if (status === "estimated") return "wd-badge wd-badge--amber";
  return "wd-badge wd-badge--muted";
}

function formatLiveRates(liveRatesCny: WeekendHotelOption["liveRatesCny"]): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(liveRatesCny)) {
    if (k === "note") continue;
    if (typeof v === "number") {
      parts.push(`¥${v}`);
    } else if (typeof v === "string" && v.trim()) {
      parts.push(v.trim());
    }
  }
  const head = parts.length > 0 ? parts[0] : "";
  if (liveRatesCny.note && head && !liveRatesCny.note.includes(head)) {
    return `${head}（${liveRatesCny.note}）`;
  }
  return liveRatesCny.note || head || "以实时房态为准";
}

function buildDetailUrl(
  weekId: string,
  proposalId: string,
  departure: DepartureKey,
  mode: "plan" | "live"
): string {
  const params = new URLSearchParams();
  if (proposalId) params.set("proposal", proposalId);
  params.set("departure", departure);
  if (mode === "live") params.set("mode", "live");
  return `/travel/weekend/${encodeURIComponent(weekId)}?${params.toString()}`;
}

export function WeekendDetailView({
  weekId,
  snapshot,
  isExpired,
  initialProposalId,
  initialDeparture,
  initialMode,
  initialState,
  initialExcludedTypes,
}: {
  weekId: string;
  snapshot: WeekendPlannerSnapshot;
  isExpired: boolean;
  initialProposalId: string;
  initialDeparture: DepartureKey;
  initialMode: "plan" | "live";
  initialState: WeekendStateFile | null;
  initialExcludedTypes: ExcludedExperienceTypeItem[];
}) {
  const [proposalId, setProposalId] = useState<string>(initialProposalId);
  const [departure, setDeparture] = useState<DepartureKey>(initialDeparture);
  const [mode, setMode] = useState<"plan" | "live">(initialMode);
  const [weekState, setWeekState] = useState<WeekendStateFile | null>(initialState);
  const [excludedTypes, setExcludedTypes] =
    useState<ExcludedExperienceTypeItem[]>(initialExcludedTypes);
  const [liveSlotIndex, setLiveSlotIndex] = useState<number>(0);
  const [activeEmergency, setActiveEmergency] = useState<EmergencyKey | null>(null);
  const [savingHint, setSavingHint] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<boolean>(false);
  const mutationSeqRef = useRef(0);

  const proposal = useMemo(() => {
    return (
      snapshot.proposals.find((item) => item.id === proposalId) ??
      snapshot.proposals[0]
    );
  }, [snapshot.proposals, proposalId]);

  const activeDep = proposal
    ? proposal.departures[departure] ?? proposal.departures.sat_morning
    : null;

  useEffect(() => {
    let active = true;
    const refreshState = () => {
      const seq = mutationSeqRef.current;
      fetch(`/api/weekend-state?weekId=${encodeURIComponent(weekId)}`, {
        cache: "no-store",
      })
        .then((res) => (res.ok ? (res.json() as Promise<WeekendStateGetResponse>) : null))
        .then((data) => {
          if (!active || !data?.ok || mutationSeqRef.current !== seq) return;
          setWeekState(data.state);
          setExcludedTypes(data.excludedExperienceTypes);
        })
        .catch(() => {
          // 保持服务端初始快照，不阻断阅读
        });
    };
    if (!initialState) {
      refreshState();
    }
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) refreshState();
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      active = false;
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [weekId, initialState]);

  useEffect(() => {
    const syncFromLocation = () => {
      const sp = new URLSearchParams(window.location.search);
      const nextProposal = sp.get("proposal");
      const nextDep = sp.get("departure");
      const nextMode = sp.get("mode");
      if (nextProposal && snapshot.proposals.some((p) => p.id === nextProposal)) {
        setProposalId(nextProposal);
      }
      if (nextDep === "sat_morning" || nextDep === "sat_afternoon") {
        setDeparture(nextDep);
      }
      setMode(nextMode === "live" ? "live" : "plan");
    };
    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, [snapshot.proposals]);

  function replaceRouteUrl(
    nextProposalId: string,
    nextDeparture: DepartureKey,
    nextMode: "plan" | "live"
  ) {
    if (typeof window === "undefined") return;
    const url = buildDetailUrl(weekId, nextProposalId, nextDeparture, nextMode);
    window.history.replaceState(null, "", url);
  }

  async function persistProposalAndDeparture(
    nextProposalId: string,
    nextDeparture: DepartureKey,
    labelHint: string
  ) {
    mutationSeqRef.current += 1;
    setPendingAction(true);
    setSavingHint(null);
    try {
      const res = await fetch("/api/weekend-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "selectProposal",
          weekId,
          proposalId: nextProposalId,
          departure: nextDeparture,
        }),
      });
      const data = (await res.json()) as WeekendStatePostResponse;
      if (res.ok && data.ok) {
        if (data.state) setWeekState(data.state);
        setExcludedTypes(data.excludedExperienceTypes);
        setSavingHint(labelHint);
      } else {
        setSavingHint("保存未能完成，请稍后重试");
      }
    } catch {
      setSavingHint("网络波动，未能保存，请稍后重试");
    } finally {
      setPendingAction(false);
    }
  }

  function handleSelectProposal(nextId: string) {
    setProposalId(nextId);
    setLiveSlotIndex(0);
    setActiveEmergency(null);
    replaceRouteUrl(nextId, departure, mode);
    void persistProposalAndDeparture(nextId, departure, "已切换备选方案");
  }

  function handleSelectDeparture(nextDep: DepartureKey) {
    setDeparture(nextDep);
    setLiveSlotIndex(0);
    setActiveEmergency(null);
    replaceRouteUrl(proposal.id, nextDep, mode);
    const label =
      nextDep === "sat_morning" ? "已切换并保存：周六早出发" : "已切换并保存：周六午出发";
    void persistProposalAndDeparture(proposal.id, nextDep, label);
  }

  function handleSwitchMode(nextMode: "plan" | "live") {
    setMode(nextMode);
    setActiveEmergency(null);
    replaceRouteUrl(proposal.id, departure, nextMode);
  }

  async function handleToggleExcludeType(target: WeekendProposal) {
    mutationSeqRef.current += 1;
    const isAlreadyExcluded = excludedTypes.some(
      (item) => item.experienceType === target.experienceType
    );
    setPendingAction(true);
    setSavingHint(null);
    try {
      const res = await fetch("/api/weekend-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "excludeType",
          mode: isAlreadyExcluded ? "remove" : "add",
          experienceType: target.experienceType,
          label: target.experienceTypeLabel,
          weekId,
        }),
      });
      const data = (await res.json()) as WeekendStatePostResponse;
      if (res.ok && data.ok) {
        if (data.state) setWeekState(data.state);
        setExcludedTypes(data.excludedExperienceTypes);
        setSavingHint(
          isAlreadyExcluded
            ? `已恢复「${target.experienceTypeLabel}」推荐`
            : `后续将避开「${target.experienceTypeLabel}」`
        );
      } else {
        setSavingHint("操作未成功，请稍后再试");
      }
    } catch {
      setSavingHint("网络波动，操作未能保存");
    } finally {
      setPendingAction(false);
    }
  }

  if (!proposal || !activeDep) {
    return (
      <div className="wd-shell">
        <div className="wd-card">
          <p className="wd-empty">这一周暂无可展开的备选行程。</p>
          <Link href="/travel?view=plan" className="wd-btn wd-btn--primary">
            返回旅行页
          </Link>
        </div>
      </div>
    );
  }

  const isSelectedForWeek = weekState?.selectedProposalId === proposal.id;
  const isTypeExcluded = excludedTypes.some(
    (item) => item.experienceType === proposal.experienceType
  );

  // 场景 / 酒店图片：仅展示合法 OSS 路径
  const sceneGallery = (proposal.galleryImages ?? []).filter(
    (img) => isSafeWeekendMediaUrl(img.src) && img.src !== proposal.heroImage?.src
  );

  if (mode === "live") {
    const timeline = activeDep.timeline;
    const boundedIdx = Math.min(liveSlotIndex, Math.max(0, timeline.length - 1));
    const currentSlot = timeline[boundedIdx] ?? timeline[0];
    const nextSlot = timeline[boundedIdx + 1] ?? null;
    const activeBranch: DegradationBranch | null = activeEmergency
      ? proposal.degradationTree[activeEmergency]
      : null;
    const primaryHotel =
      proposal.hotel.required && proposal.hotel.options.length > 0
        ? proposal.hotel.options[0]
        : null;

    return (
      <div className="wd-shell wd-shell--live">
        <header className="wd-live-topbar">
          <button
            type="button"
            className="wd-btn wd-btn--quiet"
            onClick={() => handleSwitchMode("plan")}
          >
            ← 回到完整详情
          </button>
          <Link href="/travel?view=plan" className="wd-btn wd-btn--quiet">
            全部方案
          </Link>
        </header>

        <section className="wd-live-head">
          <div className="wd-badge-row">
            <span className="wd-badge wd-badge--blue">周六现场模式</span>
            <span className="wd-badge wd-badge--muted">{proposal.region}</span>
            <span className="wd-badge wd-badge--muted">{activeDep.label}</span>
          </div>
          <h1 className="wd-live-title">{proposal.title}</h1>
          <div className="wd-dep-switch wd-dep-switch--compact" role="group" aria-label="出发时段">
            <button
              type="button"
              className={`wd-dep-btn${departure === "sat_morning" ? " is-on" : ""}`}
              aria-pressed={departure === "sat_morning"}
              disabled={pendingAction}
              onClick={() => handleSelectDeparture("sat_morning")}
            >
              早出发 · {proposal.departures.sat_morning.departureTime}
            </button>
            <button
              type="button"
              className={`wd-dep-btn${departure === "sat_afternoon" ? " is-on" : ""}`}
              aria-pressed={departure === "sat_afternoon"}
              disabled={pendingAction}
              onClick={() => handleSelectDeparture("sat_afternoon")}
            >
              午出发 · {proposal.departures.sat_afternoon.departureTime}
            </button>
          </div>
          {savingHint ? (
            <p className="wd-save-hint" role="status">
              {savingHint}
            </p>
          ) : null}
        </section>

        <nav className="wd-live-slots" aria-label="切换当前时段">
          {timeline.map((item, idx) => (
            <button
              key={`${item.segmentKey}-${idx}`}
              type="button"
              className={`wd-live-slot-pill${idx === boundedIdx ? " is-on" : ""}`}
              aria-pressed={idx === boundedIdx}
              onClick={() => setLiveSlotIndex(idx)}
            >
              <span>第 {idx + 1} 段</span>
              <small>{item.timeWindow}</small>
            </button>
          ))}
        </nav>

        {currentSlot ? (
          <section className="wd-live-now" aria-label="当前时段重点">
            <div className="wd-live-now-top">
              <span className="wd-live-tag">
                正在进行 · {boundedIdx + 1}/{timeline.length}
              </span>
              <span className="wd-live-window">{currentSlot.timeWindow}</span>
            </div>
            <h2 className="wd-live-now-title">{currentSlot.title}</h2>
            <dl className="wd-live-facts">
              <div>
                <dt>定位与地点</dt>
                <dd>{currentSlot.location}</dd>
              </div>
              <div>
                <dt>停车与接驳</dt>
                <dd>{currentSlot.driveOrWalkNote}</dd>
              </div>
              <div>
                <dt>分段天气</dt>
                <dd>{currentSlot.slotWeather3h}</dd>
              </div>
              <div>
                <dt>推车与歇脚</dt>
                <dd>{currentSlot.strollerAndRestNote}</dd>
              </div>
            </dl>
            {nextSlot ? (
              <div className="wd-live-next">
                <span>下一段安排：</span>
                <strong>
                  {nextSlot.timeWindow} · {nextSlot.title}
                </strong>
              </div>
            ) : (
              <div className="wd-live-next">
                <span>返程参考：</span>
                <strong>{activeDep.returnTime}</strong>
              </div>
            )}
          </section>
        ) : null}

        {primaryHotel ? (
          <section className="wd-card wd-live-hotel">
            <div className="wd-card-head">
              <h2>今晚落脚酒店</h2>
              <span className="wd-badge wd-badge--mint">{primaryHotel.tag}</span>
            </div>
            <p className="wd-live-hotel-name">{primaryHotel.name}</p>
            <p className="wd-muted-text">{primaryHotel.address}</p>
            <div className="wd-kv-inline">
              <span>房型：{primaryHotel.recommendedRoom}</span>
              <span>停车：{primaryHotel.parkingPolicy}</span>
              <span>退改：{primaryHotel.freeCancellationDeadline}</span>
            </div>
          </section>
        ) : null}

        <section className="wd-card wd-live-emergency" aria-label="现场一键应急预案">
          <div className="wd-card-head">
            <h2>遇到变化怎么办</h2>
            <span className="wd-muted-small">点一下立刻看 15 分钟内替代点</span>
          </div>
          <div className="wd-emergency-grid">
            {EMERGENCY_BUTTONS.map((btn) => {
              const isOn = activeEmergency === btn.key;
              return (
                <button
                  key={btn.key}
                  type="button"
                  className={`wd-emergency-btn${isOn ? " is-on" : ""}`}
                  aria-pressed={isOn}
                  onClick={() =>
                    setActiveEmergency((prev) => (prev === btn.key ? null : btn.key))
                  }
                >
                  <strong>{btn.label}</strong>
                  <span>{btn.sub}</span>
                </button>
              );
            })}
          </div>

          {activeBranch ? (
            <div className="wd-emergency-panel" role="region" aria-live="polite">
              <h3>{activeBranch.triggerLabel}</h3>
              <p className="wd-emergency-summary">{activeBranch.actionSummary}</p>
              {activeBranch.nearbyAlternatives.length > 0 ? (
                <ul className="wd-alt-list">
                  {activeBranch.nearbyAlternatives.map((alt) => (
                    <li key={alt.name} className="wd-alt-item">
                      <div className="wd-alt-head">
                        <strong>{alt.name}</strong>
                        <span
                          className={`wd-badge ${
                            alt.indoor ? "wd-badge--blue" : "wd-badge--muted"
                          }`}
                        >
                          {alt.indoor ? "室内兜底" : "户外调整"} · {alt.driveOrWalk}
                        </span>
                      </div>
                      <p className="wd-alt-note">停车：{alt.parking}</p>
                      <p className="wd-alt-note">{alt.note}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="wd-return-hint">
                <strong>折返提醒：</strong>
                {activeBranch.returnRouteHint}
              </p>
            </div>
          ) : null}
        </section>
      </div>
    );
  }

  return (
    <div className="wd-shell">
      <div className="wd-topbar">
        <Link href="/travel?view=plan" className="wd-back-link">
          ← 返回周末方案对比
        </Link>
        <div className="wd-topbar-actions">
          <button
            type="button"
            className="wd-btn wd-btn--live"
            onClick={() => handleSwitchMode("live")}
          >
            切到周六现场
          </button>
          <button
            type="button"
            className={`wd-btn ${isTypeExcluded ? "wd-btn--secondary" : "wd-btn--ghost"}`}
            disabled={pendingAction}
            onClick={() => handleToggleExcludeType(proposal)}
          >
            {isTypeExcluded ? "已避开这类 · 点此恢复" : "不喜欢这类"}
          </button>
        </div>
      </div>

      {isExpired ? (
        <div className="wd-banner wd-banner--muted" role="status">
          <strong>当前浏览的是历史周末（{snapshot.weekendRange.label}）归档参考</strong>
          <p>仅作行程与路况回忆参考，已隐藏当周限时预订提醒。</p>
        </div>
      ) : snapshot.fridayAlert ? (
        <div
          className={`wd-banner ${
            snapshot.fridayAlert.severity === "adjust"
              ? "wd-banner--amber"
              : "wd-banner--blue"
          }`}
          role="status"
        >
          <strong>{snapshot.fridayAlert.headline}</strong>
          <p>{snapshot.fridayAlert.summary}</p>
          {snapshot.fridayAlert.swapSuggestion ? (
            <p className="wd-banner-sub">{snapshot.fridayAlert.swapSuggestion}</p>
          ) : null}
        </div>
      ) : null}

      <nav className="wd-proposal-tabs" aria-label="切换备选方案">
        {snapshot.proposals.map((item) => {
          const active = item.id === proposal.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`wd-proposal-tab${active ? " is-on" : ""}`}
              aria-pressed={active}
              onClick={() => handleSelectProposal(item.id)}
            >
              <span>{item.badge}</span>
              <strong>{item.region}</strong>
            </button>
          );
        })}
      </nav>

      {savingHint ? (
        <p className="wd-save-hint" role="status">
          {savingHint}
        </p>
      ) : null}

      <article className="wd-hero-card">
        {isSafeWeekendMediaUrl(proposal.heroImage?.src) ? (
          <div className="wd-hero-media">
            <Image
              src={proposal.heroImage.src}
              alt={proposal.heroImage.alt || proposal.title}
              width={960}
              height={540}
              unoptimized
              priority
              sizes="(max-width: 760px) 100vw, 960px"
            />
          </div>
        ) : null}
        <div className="wd-hero-body">
          <div className="wd-badge-row">
            <span className="wd-badge wd-badge--blue">{proposal.badge}</span>
            <span className="wd-badge wd-badge--lavender">
              {proposal.experienceTypeLabel}
            </span>
            <span className="wd-badge wd-badge--muted">{proposal.paceLabel}</span>
            <span className="wd-badge wd-badge--muted">
              {proposal.driveFromSandun.directionFromSandun} ·{" "}
              {proposal.driveFromSandun.durationLabel}
            </span>
            {isSelectedForWeek ? (
              <span className="wd-badge wd-badge--mint">当前选定方案</span>
            ) : null}
          </div>
          <h1 className="wd-title">{proposal.title}</h1>
          <p className="wd-subtitle">{proposal.subtitle}</p>
          <blockquote className="wd-reason">{proposal.oneLineReason}</blockquote>

          {proposal.hotelSummaryShort ? (
            <p className="wd-hero-hotel-line">
              <strong>住宿梗概：</strong>
              {proposal.hotelSummaryShort}
            </p>
          ) : null}

          <div className="wd-hero-actions">
            <button
              type="button"
              className={`wd-btn ${isSelectedForWeek ? "wd-btn--mint" : "wd-btn--primary"}`}
              disabled={pendingAction}
              onClick={() =>
                void persistProposalAndDeparture(
                  proposal.id,
                  departure,
                  "已选定为这周重点备选"
                )
              }
            >
              {isSelectedForWeek ? "已选为这周备选" : "就看这一案 · 标为本周末首选"}
            </button>
            <button
              type="button"
              className="wd-btn wd-btn--secondary"
              onClick={() => handleSwitchMode("live")}
            >
              进入周六现场模式 →
            </button>
          </div>
        </div>
      </article>

      {sceneGallery.length > 0 ? (
        <section className="wd-card" aria-label="实地场景参考">
          <div className="wd-card-head">
            <h2>场景与落脚点参考图</h2>
            <span className="wd-muted-small">实景图片仅供参考</span>
          </div>
          <div className="wd-gallery-grid">
            {sceneGallery.map((img) => (
              <figure key={img.src} className="wd-gallery-item">
                <div className="wd-gallery-frame">
                  <Image
                    src={img.src}
                    alt={img.alt}
                    width={400}
                    height={300}
                    unoptimized
                    sizes="(max-width: 760px) 50vw, 240px"
                  />
                </div>
                {img.caption || img.timeNote ? (
                  <figcaption>
                    {img.caption}
                    {img.timeNote ? `（${img.timeNote}）` : ""}
                  </figcaption>
                ) : null}
              </figure>
            ))}
          </div>
        </section>
      ) : null}

      <section
        className={`wd-card wd-cutoff-card ${
          proposal.latestDepartureCutoff.hasCutoff ? "is-strict" : "is-flexible"
        }`}
      >
        <div className="wd-card-head">
          <h2>最晚出发时限</h2>
          <span
            className={`wd-badge ${
              proposal.latestDepartureCutoff.hasCutoff
                ? "wd-badge--amber"
                : "wd-badge--mint"
            }`}
          >
            {proposal.latestDepartureCutoff.cutoffTime}
          </span>
        </div>
        <p className="wd-cutoff-headline">{proposal.latestDepartureCutoff.headline}</p>
        <dl className="wd-cutoff-grid">
          <div>
            <dt>核心闭园 / 营业时间</dt>
            <dd>{proposal.latestDepartureCutoff.anchorClosingTime}</dd>
          </div>
          {proposal.latestDepartureCutoff.eveningBackupClosingTime ? (
            <div>
              <dt>傍晚与夜间备份</dt>
              <dd>{proposal.latestDepartureCutoff.eveningBackupClosingTime}</dd>
            </div>
          ) : null}
          {proposal.latestDepartureCutoff.cutoffTimeRelaxed ? (
            <div>
              <dt>如果晚走一点</dt>
              <dd>{proposal.latestDepartureCutoff.cutoffTimeRelaxed}</dd>
            </div>
          ) : null}
          <div>
            <dt>来不及时怎么改</dt>
            <dd>{proposal.latestDepartureCutoff.fallbackAction}</dd>
          </div>
        </dl>
      </section>

      <section className="wd-card" id="timeline">
        <div className="wd-card-head wd-card-head--wrap">
          <div>
            <h2>周六出发时间轴</h2>
            <p className="wd-muted-small">
              切换早 / 午出发会自动裁减并重新排顺当日停靠点
            </p>
          </div>
          <div className="wd-dep-switch" role="group" aria-label="选择周六出发时间">
            <button
              type="button"
              className={`wd-dep-btn${departure === "sat_morning" ? " is-on" : ""}`}
              aria-pressed={departure === "sat_morning"}
              disabled={pendingAction}
              onClick={() => handleSelectDeparture("sat_morning")}
            >
              <span>周六早出发</span>
              <small>{proposal.departures.sat_morning.departureTime}</small>
            </button>
            <button
              type="button"
              className={`wd-dep-btn${departure === "sat_afternoon" ? " is-on" : ""}`}
              aria-pressed={departure === "sat_afternoon"}
              disabled={pendingAction}
              onClick={() => handleSelectDeparture("sat_afternoon")}
            >
              <span>周六午出发</span>
              <small>{proposal.departures.sat_afternoon.departureTime}</small>
            </button>
          </div>
        </div>

        <div className="wd-dep-summary">
          <div className="wd-dep-meta">
            <span>
              <strong>出发：</strong>
              {activeDep.departureTime}
            </span>
            <span>
              <strong>预计到达：</strong>
              {activeDep.arrivalEstimate}
            </span>
            <span>
              <strong>返程安排：</strong>
              {activeDep.returnTime}
            </span>
          </div>
          <p className="wd-dep-trim">{activeDep.trimNote}</p>
        </div>

        <ol className="wd-timeline">
          {activeDep.timeline.map((step, index) => (
            <li
              key={`${step.segmentKey}-${index}`}
              className={`wd-timeline-item${step.isRestBuffer ? " is-rest" : ""}`}
            >
              <div className="wd-timeline-rail">
                <span className="wd-timeline-time">{step.timeWindow}</span>
                {step.isRestBuffer ? (
                  <span className="wd-badge wd-badge--mint">弹性歇脚段</span>
                ) : (
                  <span className="wd-badge wd-badge--muted">
                    {formatTimelineCategory(step.category)}
                  </span>
                )}
              </div>
              <div className="wd-timeline-body">
                <h3>{step.title}</h3>
                <p className="wd-timeline-loc">{step.location}</p>
                <div className="wd-timeline-notes">
                  <p>
                    <strong>停车与接驳：</strong>
                    {step.driveOrWalkNote}
                  </p>
                  <p>
                    <strong>当段天气：</strong>
                    {step.slotWeather3h}
                  </p>
                  <p>
                    <strong>推车与休息：</strong>
                    {step.strollerAndRestNote}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="wd-card" id="hotel">
        <div className="wd-card-head">
          <h2>住哪里</h2>
          {proposal.hotel.required ? (
            <span className="wd-badge wd-badge--blue">
              {proposal.hotel.budgetConstraint}
            </span>
          ) : (
            <span className="wd-badge wd-badge--mint">当日往返</span>
          )}
        </div>

        {!proposal.hotel.required ? (
          <p className="wd-muted-text">{proposal.hotel.note}</p>
        ) : (
          <div className="wd-hotel-stack">
            {proposal.hotel.recommendationReason ? (
              <p className="wd-hotel-intro">{proposal.hotel.recommendationReason}</p>
            ) : null}
            {proposal.hotel.areaComparisonNote ? (
              <p className="wd-muted-text">{proposal.hotel.areaComparisonNote}</p>
            ) : null}

            <div className="wd-hotel-cards">
              {proposal.hotel.options.slice(0, 3).map((opt) => {
                const hotelImg =
                  (isSafeWeekendMediaUrl(opt.image?.src) && opt.image) ||
                  opt.galleryImages?.find((g) => isSafeWeekendMediaUrl(g.src));
                return (
                  <article key={opt.name} className="wd-hotel-card">
                    {hotelImg && isSafeWeekendMediaUrl(hotelImg.src) ? (
                      <div className="wd-hotel-media">
                        <Image
                          src={hotelImg.src}
                          alt={hotelImg.alt || opt.name}
                          width={480}
                          height={360}
                          unoptimized
                          sizes="(max-width: 760px) 100vw, 320px"
                        />
                      </div>
                    ) : null}
                    <div className="wd-hotel-card-body">
                      <div className="wd-badge-row">
                        <span className="wd-badge wd-badge--blue">{opt.tag}</span>
                        {opt.districtArea ? (
                          <span className="wd-badge wd-badge--muted">
                            {opt.districtArea}
                          </span>
                        ) : null}
                        <span className={verificationBadgeClass(opt.verificationStatus)}>
                          {verificationBadgeText(opt.verificationStatus)}
                        </span>
                      </div>
                      <h3>{opt.name}</h3>
                      <p className="wd-hotel-addr">
                        {opt.address} · 评分 {opt.rating}
                      </p>
                      <dl className="wd-hotel-dl">
                        <div>
                          <dt>房型与参考价</dt>
                          <dd>
                            {opt.recommendedRoom}
                            {opt.bedSpec ? `（${opt.bedSpec}）` : ""} ·{" "}
                            {formatLiveRates(opt.liveRatesCny)}
                          </dd>
                        </div>
                        <div>
                          <dt>儿童与早餐政策</dt>
                          <dd>{opt.childAndCribPolicy}</dd>
                        </div>
                        <div>
                          <dt>免费取消</dt>
                          <dd>{opt.freeCancellationDeadline}</dd>
                        </div>
                        <div>
                          <dt>停车与配套</dt>
                          <dd>
                            {opt.parkingPolicy}
                            {opt.poolSummary ? `；${opt.poolSummary}` : ""}
                          </dd>
                        </div>
                        {opt.routingNote ? (
                          <div>
                            <dt>动线说明</dt>
                            <dd>{opt.routingNote}</dd>
                          </div>
                        ) : null}
                      </dl>
                      {opt.bookingUrl ? (
                        <a
                          href={opt.bookingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="wd-ext-link"
                        >
                          查看携程房态与即时价 →
                        </a>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>

            <details className="wd-hotel-more">
              <summary>
                展开全部 {proposal.hotel.options.length} 家实查酒店对照与未入选原因
              </summary>
              <div className="wd-table-scroll">
                <table className="wd-hotel-table">
                  <thead>
                    <tr>
                      <th scope="col">酒店与区域</th>
                      <th scope="col">推荐房型与参考价</th>
                      <th scope="col">儿童与早餐政策</th>
                      <th scope="col">取消与停车</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proposal.hotel.options.map((opt) => (
                      <tr key={opt.name}>
                        <td>
                          <strong>{opt.name}</strong>
                          <div className="wd-table-sub">
                            {opt.tag}
                            {opt.districtArea ? ` · ${opt.districtArea}` : ""}
                          </div>
                        </td>
                        <td>
                          <div>{opt.recommendedRoom}</div>
                          <div className="wd-table-sub">
                            {formatLiveRates(opt.liveRatesCny)}
                          </div>
                        </td>
                        <td>{opt.childAndCribPolicy}</td>
                        <td>
                          <div>{opt.freeCancellationDeadline}</div>
                          <div className="wd-table-sub">{opt.parkingPolicy}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {proposal.hotel.eliminatedOptions.length > 0 ? (
                <div className="wd-elim-box">
                  <h3>同批核对后未入选酒店</h3>
                  <ul>
                    {proposal.hotel.eliminatedOptions.map((item) => (
                      <li key={item.name}>
                        <strong>{item.name}</strong>
                        <span>{item.priceFound}</span>
                        <p>{item.reason}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </details>
          </div>
        )}
      </section>

      {!isExpired && proposal.urgentBookingsTonight.length > 0 ? (
        <section className="wd-card wd-urgent-card">
          <div className="wd-card-head">
            <h2>行前先确认这几件事</h2>
            <span className="wd-badge wd-badge--amber">建议尽早留意</span>
          </div>
          <ul className="wd-urgent-list">
            {proposal.urgentBookingsTonight.map((task) => (
              <li key={task.item} className="wd-urgent-item">
                <div className="wd-urgent-top">
                  <strong>{task.item}</strong>
                  <span className={verificationBadgeClass(task.verificationStatus)}>
                    {verificationBadgeText(task.verificationStatus)}
                  </span>
                </div>
                <p className="wd-urgent-meta">
                  渠道：{task.channel} · 截止：{task.deadline}
                </p>
                <p className="wd-muted-text">{task.note}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="wd-card">
        <div className="wd-card-head">
          <h2>为什么值得出门</h2>
          <span className="wd-muted-small">六个角度交叉核对</span>
        </div>
        <div className="wd-checks-grid">
          {(
            Object.entries(CHECK_SECTION_TITLES) as Array<
              [keyof WeekendProposal["worthGoingChecks"], string]
            >
          ).map(([key, cleanTitle]) => {
            const item = proposal.worthGoingChecks[key];
            return (
              <div key={key} className="wd-check-item">
                <div className="wd-check-head">
                  <strong>{cleanTitle}</strong>
                  <span className={verificationBadgeClass(item.status)}>
                    {verificationBadgeText(item.status)}
                  </span>
                </div>
                <p>{item.detail}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="wd-card">
        <div className="wd-card-head">
          <h2>路况与客流参考</h2>
          <span className="wd-badge wd-badge--muted">
            {CROWD_RISK_LABELS[proposal.crowdAndTraffic.venueCrowd.riskLevel]}
          </span>
        </div>
        <div className="wd-two-col">
          <div className="wd-subbox">
            <h3>路况节奏（经验预估）</h3>
            <p>{proposal.crowdAndTraffic.roadPattern.summary}</p>
            <p className="wd-subbox-meta">
              建议出发：{proposal.crowdAndTraffic.roadPattern.bestDepartureWindow}
            </p>
            <p className="wd-subbox-meta">
              尽量避开：{proposal.crowdAndTraffic.roadPattern.avoidWindow}
            </p>
          </div>
          <div className="wd-subbox">
            <h3>现场拥挤度与错峰</h3>
            <p>{proposal.crowdAndTraffic.venueCrowd.offPeakTip}</p>
            <p className="wd-subbox-meta">
              重点高峰：{proposal.crowdAndTraffic.venueCrowd.peakHours}
            </p>
          </div>
        </div>
      </section>

      <section className="wd-card">
        <div className="wd-card-head">
          <h2>近期真实游记与评论参考</h2>
          <span className="wd-muted-small">文字摘要与原帖直链</span>
        </div>
        <p className="wd-xhs-digest">{proposal.xhsEvidence.digest}</p>
        <p className="wd-xhs-signals">{proposal.xhsEvidence.commentSignals}</p>
        <ul className="wd-xhs-list">
          {proposal.xhsEvidence.notes.map((note) => (
            <li key={`${note.seq}-${note.noteId}`} className="wd-xhs-item">
              <div className="wd-xhs-item-head">
                <span className="wd-xhs-seq">#{note.seq}</span>
                <a href={note.url} target="_blank" rel="noopener noreferrer">
                  {note.title}
                </a>
                <span className="wd-xhs-date">
                  {formatZhCalendarDate(note.publishedAt)}
                </span>
              </div>
              <p className="wd-xhs-stats">
                作者：{note.author} · {note.likes} 赞 · {note.collects} 收藏 ·{" "}
                {note.commentCountText}
              </p>
              <p className="wd-xhs-note">{note.keyTakeaway}</p>
              <p className="wd-xhs-comment">
                <strong>评论核实：</strong>
                {note.commentFeedback}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="wd-card">
        <div className="wd-card-head">
          <h2>临时变化应急预案</h2>
          <span className="wd-muted-small">下雨、困倦、拥挤或提前折返</span>
        </div>
        <div className="wd-degrad-grid">
          {(
            [
              ["rain", proposal.degradationTree.rain],
              ["childTired", proposal.degradationTree.childTired],
              ["crowded", proposal.degradationTree.crowded],
              ["returnEarly", proposal.degradationTree.returnEarly],
            ] as const
          ).map(([key, branch]) => (
            <div key={key} className="wd-degrad-card">
              <h3>{branch.triggerLabel}</h3>
              <p>{branch.actionSummary}</p>
              {branch.nearbyAlternatives.length > 0 ? (
                <ul className="wd-degrad-alts">
                  {branch.nearbyAlternatives.map((alt) => (
                    <li key={alt.name}>
                      <strong>{alt.name}</strong>（{alt.indoor ? "室内" : "户外"} ·{" "}
                      {alt.driveOrWalk}）— {alt.note}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="wd-degrad-return">折返路线：{branch.returnRouteHint}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="wd-card">
        <div className="wd-card-head">
          <h2>大致花费参考</h2>
          <span className="wd-muted-small">{proposal.costBreakdown.totalBudgetNote}</span>
        </div>
        <ul className="wd-cost-list">
          {proposal.costBreakdown.items.map((item) => (
            <li key={item.label} className="wd-cost-row">
              <div>
                <strong>{item.label}</strong>
                <p className="wd-muted-small">{item.note}</p>
              </div>
              <div className="wd-cost-right">
                <span>{item.amountText}</span>
                <span className={verificationBadgeClass(item.verificationStatus)}>
                  {verificationBadgeText(item.verificationStatus)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <details className="wd-sources-details">
        <summary>信息来源（点击展开核对链接与确认状态）</summary>
        <ul className="wd-sources-list">
          {proposal.sources.map((src) => (
            <li key={`${src.title}-${src.url}`}>
              <a href={src.url} target="_blank" rel="noopener noreferrer">
                {src.title}
              </a>
              <span className={verificationBadgeClass(src.verificationStatus)}>
                {verificationBadgeText(src.verificationStatus)}
              </span>
              {src.verifiedAt ? (
                <small>核对日期：{formatZhCalendarDate(src.verifiedAt)}</small>
              ) : null}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
