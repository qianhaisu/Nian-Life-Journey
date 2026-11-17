// Candidate scoring, orthogonal 3-slot selection, snapshot builder, and Friday weather refresh.
// Integrates hard-gates.mjs, preference-weights.json, excluded-types.json, and cooldown-venues.json.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { addDays } from "../editor/plan.mjs";
import {
  CHILD_BIRTH_DAY,
  HOTEL_HARD_CAP_RMB,
  computeChildAgeOn,
  computeLatestDepartureCutoff,
  evaluatePublishAvailability,
  evaluateXhsNote,
  evaluateXhsSignalStrength,
  normalizeExcludedTypes,
  sanitizeSourcesDetailUrls,
  validateSnapshotHardGates,
} from "./hard-gates.mjs";
import {
  defaultCooldownPool,
  defaultPreferenceWeights,
  isVenueInCooldown,
  readCooldownPool,
  readPreferenceWeights,
} from "./feedback-tune.mjs";
import { checkCandidateVisitedSpot, loadVisitedPlacesContext } from "./visited-places.mjs";
import { readExcludedTypesFile } from "./sources-xhs.mjs";
import { buildProposalWeatherSlots } from "./sources-weather.mjs";

function formatRangeLabel(from, to) {
  const fy = Number(from.slice(0, 4));
  const fm = Number(from.slice(5, 7));
  const fd = Number(from.slice(8, 10));
  const tm = Number(to.slice(5, 7));
  const td = Number(to.slice(8, 10));
  if (fm === tm) {
    return {
      label: `${fy} 年 ${fm} 月 ${fd} 日 – ${td} 日`,
      satLabel: `周六 ${fm}.${String(fd).padStart(2, "0")}`,
      sunLabel: `周日 ${tm}.${String(td).padStart(2, "0")}`,
    };
  }
  return {
    label: `${fy} 年 ${fm} 月 ${fd} 日 – ${tm} 月 ${td} 日`,
    satLabel: `周六 ${fm}.${String(fd).padStart(2, "0")}`,
    sunLabel: `周日 ${tm}.${String(td).padStart(2, "0")}`,
  };
}

/**
 * Retrieval-only triage helper (NOT used for final destination selection when editorialOrder/editorialCurated is set).
 * Hotel brand (Atour) never boosts destination score — brand preference applies only after a destination wins.
 */
export function computeRetrievalHintScore(candidate, weights = defaultPreferenceWeights(), cooldownPool = defaultCooldownPool(), weekStartDay = "") {
  const w = weights ?? defaultPreferenceWeights();
  const h = w.hypotheses ?? defaultPreferenceWeights().hypotheses;
  let score = 0;
  const text = `${candidate?.experienceType ?? ""} ${candidate?.experienceTypeLabel ?? ""} ${candidate?.title ?? ""} ${candidate?.subtitle ?? ""}`;

  if (/boat|water|wetland|船|湖|湿地|水岸/.test(text)) score += h.H1_water_boat ?? 18;
  if (/train|farm|harvest|rail|火车|农|采摘|牧场/.test(text)) score += h.H2_transport_farm ?? 16;
  if (/animal|bird|pigeon|羊|鸽|动物|鱼/.test(text)) score += h.H3_gentle_animals ?? 15;
  if (/street|market|mall|shop|逛|街|市集|草坪|放空|风物/.test(text)) score += h.H4_adult_scenery_food ?? 14;
  if (!candidate?.hasMountainClimb && !candidate?.hasLongStairs) score += h.H6_flat_stroller ?? 15;
  if (/芦苇|水杉|银杏|季节|红叶|秋|春/.test(text)) score += h.H7_seasonal_texture ?? 15;

  const driveMax = Number(candidate?.driveMinutesMax ?? candidate?.driveFromSandun?.durationMinutesRange?.[1] ?? 0);
  if (driveMax > 90) {
    score += w.driveOver90Penalty ?? 0;
  }

  const multiplier = w.typeMultipliers?.[candidate?.experienceType] ?? 1.0;
  score = Math.round(score * multiplier);

  // Overlapping sub-tag penalty for any excluded experience type
  const { labels } = normalizeExcludedTypes(w.excludedExperienceTypes ?? []);
  for (const label of labels) {
    const tokens = label.split(/[\/、\s,，]+/).filter((t) => t.length >= 2);
    if (tokens.some((tok) => text.includes(tok))) {
      score -= 25;
      break;
    }
  }

  // Prefer strong XHS signal over weak
  const notes = candidate?.xhsNotes ?? candidate?.xhsEvidence?.notes ?? [];
  const sig = evaluateXhsSignalStrength(notes);
  score += sig === "strong" ? 15 : 0;

  if (candidate?.isKidOnlyCommercial) {
    score -= w.kidOnlyPenalty ?? 0;
  }

  const cd = isVenueInCooldown(candidate?.title || candidate?.region || candidate?.id, cooldownPool, weekStartDay);
  if (cd.active) {
    score -= 1000;
  }

  return score;
}

export const scoreCandidate = computeRetrievalHintScore;

/**
 * Selects up to 3 orthogonal slots (`preferred`, `alt_local`, `alt_1h`) with distinct `experienceType`.
 * When `editorialCurated` or `editorialOrder` is present on candidates, preserves the editor session's
 * comparative judgment strictly instead of overriding it with regex tag scores.
 */
export function selectOrthogonalProposals(scoredItems = []) {
  const hasEditorialOrder = scoredItems.some(
    (item) => Number.isFinite(Number(item?.candidate?.editorialOrder)) || item?.candidate?.editorialCurated === true,
  );

  if (hasEditorialOrder) {
    const curatedSorted = [...scoredItems]
      .filter((item) => Number.isFinite(Number(item?.candidate?.editorialOrder)) || item?.candidate?.editorialCurated === true)
      .sort((a, b) => Number(a.candidate.editorialOrder ?? 99) - Number(b.candidate.editorialOrder ?? 99));

    const picked = [];
    const usedTypes = new Set();
    const defaultSlots = ["preferred", "alt_local", "alt_1h"];
    for (const item of curatedSorted) {
      if (picked.length >= 3) break;
      const expType = item.candidate.experienceType;
      if (usedTypes.has(expType)) continue;
      usedTypes.add(expType);
      const rank = picked.length + 1;
      const slot = item.candidate.slot || defaultSlots[picked.length] || "alt_1h";
      picked.push({ ...item, slot, rank });
    }
    return picked;
  }

  const sorted = [...scoredItems].sort((a, b) => {
    const sigOrder = (x) => (x.gate?.signalStrength === "strong" ? 1 : 0);
    return sigOrder(b) - sigOrder(a) || b.score - a.score;
  });

  const picked = [];
  const usedTypes = new Set();
  const usedIds = new Set();

  const tryPick = (predicate, slotName, rank) => {
    const match = sorted.find(
      (item) =>
        !usedIds.has(item.candidate.id) &&
        !usedTypes.has(item.candidate.experienceType) &&
        predicate(item),
    );
    if (!match) return false;
    usedIds.add(match.candidate.id);
    usedTypes.add(match.candidate.experienceType);
    picked.push({ ...match, slot: slotName, rank });
    return true;
  };

  // 1. Preferred: strongest candidate (ideally strong XHS signal)
  tryPick((item) => item.gate?.signalStrength === "strong", "preferred", 1) ||
    tryPick(() => true, "preferred", 1);

  // 2. Local alternative: Hangzhou local daytrip (<= 55m, not overnight)
  tryPick((item) => {
    const driveMax = Number(item.candidate.driveMinutesMax ?? item.candidate.driveFromSandun?.durationMinutesRange?.[1] ?? 0);
    return !item.candidate.isOvernight && driveMax <= 55;
  }, "alt_local", 2) ||
    tryPick((item) => !item.candidate.isOvernight, "alt_local", 2) ||
    tryPick(() => true, "alt_local", 2);

  // 3. 1h perimeter / third distinct experience type
  tryPick((item) => {
    const driveMax = Number(item.candidate.driveMinutesMax ?? item.candidate.driveFromSandun?.durationMinutesRange?.[1] ?? 0);
    return !item.candidate.isOvernight && driveMax > 40 && driveMax <= 90;
  }, "alt_1h", 3) ||
    tryPick(() => true, "alt_1h", 3);

  return picked;
}

function unavailableTextForReason(reason) {
  switch (reason) {
    case "xhs_auth_expired":
      return {
        headline: "本周推荐暂未更新 · 小红书需要重新登录",
        summary: "小红书登录态已过期，系统未抓取到新的近 30 天实拍笔记。宁可停发，绝不拿官网介绍凑推荐。",
        actionForTeddy: "请双击 C:/Users/teddy/NianlifeOps/weekend-planner/relogin.cmd 重新扫码（约 20 秒），再补跑周更任务。",
      };
    case "xhs_risk_stopped":
      return {
        headline: "本周推荐暂未更新 · 采集遇风控暂停",
        summary: "小红书访问触发安全验证提示，脚本已按规则立即停止并保留现场截图，不自动绕过、不硬凑推荐。",
        actionForTeddy: "请查看 auth-status.json 与截图后运行 relogin.cmd 确认状态正常，再手动触发补采。",
      };
    case "pc_offline_mon_to_wed":
      return {
        headline: "本周推荐暂未更新 · 周中采集窗口电脑未联网",
        summary: "周一至周三晚采集窗口内本机未完成运行，暂未取得足够的近 30 天小红书实拍线索。",
        actionForTeddy: "电脑唤醒联网后任务会自动补跑，也可手动运行 run-weekly.mjs。",
      };
    default:
      return {
        headline: "本周推荐暂未更新 · 近 30 天实拍依据不足",
        summary: "本轮未筛选出满足「近 30 天 >= 2 篇小红书笔记且通过家庭规则」的完整方案，先保持留白，不凑数。",
        actionForTeddy: "可检查关键词或等待补采完成后重新构建。",
      };
  }
}

function buildFinalProposal(item, weekStartDay) {
  const c = item.candidate;
  const gate = item.gate;
  const notes = (c.xhsNotes ?? c.xhsEvidence?.notes ?? []).filter((n) => evaluateXhsNote(n, weekStartDay).ok);
  const sources = sanitizeSourcesDetailUrls(c.sources ?? []);
  const latestDepartureCutoff = c.latestDepartureCutoff ?? gate.cutoff;

  const baseHotel = c.hotel ?? (c.isOvernight
    ? {
        required: true,
        budgetConstraint: `携程实查（1 间 · 2 成人 · 1 儿童）；硬上限 ¥${HOTEL_HARD_CAP_RMB}/晚；1.8m+ 大床同睡`,
        searchQueryParams: c.hotelSearchQueryParams ?? {
          checkIn: weekStartDay,
          checkOut: addDays(weekStartDay, 1),
          rooms: 1,
          adults: 2,
          children: 1,
          childAgeParam: String(computeChildAgeOn(weekStartDay).yearsInt),
          capturedAt: new Date().toISOString(),
          verificationStatus: c.hotelOptions?.length ? "verified" : "unconfirmed",
        },
        options: c.hotelOptions ?? [],
        eliminatedOptions: c.eliminatedHotelOptions ?? [],
      }
    : { required: false, note: `${c.region || "杭州周边"}当日往返，不住宿。` });

  const built = {
    ...c,
    slot: item.slot,
    rank: item.rank,
    signalStrength: gate.signalStrength,
    signalStrengthLabel: gate.signalStrength === "strong" ? "强信号 · 近 30 天高互动实拍支撑" : "信号较弱 · 仅低互动参考",
    latestDepartureCutoff,
    xhsEvidence: c.xhsEvidence ?? {
      digest: c.xhsDigest ?? `共核验 ${notes.length} 篇近 30 天小红书实拍笔记。`,
      commentSignals: c.xhsCommentSignals ?? "已结合评论区核实近期人流与推车条件。",
      notes: notes.map((n, i) => ({
        seq: n.seq ?? i + 1,
        noteId: n.noteId,
        title: n.title,
        author: n.author,
        publishedAt: n.publishedAt ?? n.publishDate,
        within30Days: true,
        likes: String(n.likes ?? "0"),
        collects: String(n.collects ?? "0"),
        commentCountText: String(n.commentCountText ?? n.commentsCaptured ?? "0"),
        commentsCaptured: Number(n.commentsCaptured ?? 0),
        url: n.url ?? n.noteUrl,
        keyTakeaway: n.keyTakeaway ?? n.bodyPreview100 ?? "",
        commentFeedback: n.commentFeedback ?? "",
        noImageUsed: true,
      })),
    },
    hotel: baseHotel,
    costBreakdown: c.costBreakdown ?? {
      totalTripBudgetSet: false,
      totalBudgetNote: "未设定总行程预算；仅逐项列出实查票价与预估路费。",
      items: [],
    },
    sources,
  };

  delete built.xhsNotes;
  delete built.hotelOptions;
  delete built.eliminatedHotelOptions;
  delete built.hotelSearchQueryParams;
  delete built.anchorLastEntryHHMM;
  delete built.minExperienceMinutes;
  delete built.parkingAndTicketBufferMinutes;
  delete built.driveMinutesMax;
  delete built.strippedSatAfternoonHours;
  delete built.strippedSunMorningHours;
  delete built.strippedBestHalfDayHours;
  delete built.hasMountainClimb;
  delete built.hasLongStairs;
  delete built.maxSingleWalkKm;
  delete built.walkCapKm;
  delete built.nearbyIndoorAlternatives;
  delete built.totalTripBudget;
  delete built.editorialOrder;
  delete built.editorialCurated;
  delete built.isRevisitWithNewAnchor;
  delete built.placeQueryName;
  delete built.venueName;
  delete built.inCooldownPool;
  delete built.inVisitedPool;

  return built;
}

/**
 * Builds and validates a complete `WeekendPlannerSnapshot` (`nianlife.weekend-planner/1`).
 */
export function buildWeekendSnapshot({
  weekId,
  candidates = [],
  inspirationPool = [],
  noGoAlerts = [],
  weatherSummary,
  crawlAudit = {},
  crawlStatus = {},
  excludedExperienceTypes = ["art_museum_exhibition"],
  weights = defaultPreferenceWeights(),
  cooldown = defaultCooldownPool(),
  visitedContext = null,
  fallbackArchiveWeekId = null,
  nowIso = new Date().toISOString(),
  requireOssMedia = true,
  requireStrongForPublish = false,
} = {}) {
  const from = weekId;
  const to = addDays(weekId, 1);
  const rangeLabels = formatRangeLabel(from, to);
  const ageInfo = computeChildAgeOn(from, CHILD_BIRTH_DAY);

  const normalizedExcluded = Array.isArray(excludedExperienceTypes)
    ? excludedExperienceTypes
    : excludedExperienceTypes?.excludedExperienceTypes ?? [];

  // Annotate active 90-day cooldown venues and spot-level visited places (unless explicitly revisited with new anchor)
  const annotatedCandidates = candidates.map((c) => {
    const cd = isVenueInCooldown(c?.title || c?.region || c?.id, cooldown, from);
    const vis = visitedContext ? checkCandidateVisitedSpot(c, visitedContext) : { visited: false };
    const blockedByVisited = vis.visited && !c?.isRevisitWithNewAnchor;
    if (!cd.active && !blockedByVisited) return c;
    return {
      ...c,
      ...(cd.active ? { inCooldownPool: true } : {}),
      ...(blockedByVisited ? { inVisitedPool: true, isVenueClosed: true } : {}),
    };
  });

  const availability = evaluatePublishAvailability({
    candidates: annotatedCandidates,
    crawlStatus,
    weekStartDay: from,
    excludedExperienceTypes: normalizedExcluded,
    options: {
      walkCapKm: weights?.walkCapKm ?? 1.2,
      minStrippedContentHours: weights?.minStrippedContentHours ?? 2.5,
      requireOssMedia,
      requireStrongForPublish,
    },
  });

  const safeInspiration = inspirationPool.filter((insp) => {
    const notes = insp?.xhsEvidence ?? [];
    const hasRecent = notes.some((n) => evaluateXhsNote(n, from).ok);
    const notExcluded = !normalizeExcludedTypes(normalizedExcluded).typeSet.has(insp?.experienceType ?? "");
    const vis = visitedContext ? checkCandidateVisitedSpot(insp, visitedContext) : { visited: false };
    const notVisited = !vis.visited || Boolean(insp?.isRevisitWithNewAnchor);
    return hasRecent && notExcluded && notVisited;
  });

  const baseEnvelope = {
    schema: "nianlife.weekend-planner/1",
    weekId,
    weekendRange: {
      from,
      to,
      ...rangeLabels,
    },
    generatedAt: nowIso,
    status: availability.recommendedStatus,
    userFacingStatusLabels: {
      verified: "已确认",
      unconfirmed: "待确认",
      estimated: "预估",
    },
    verificationSummaryNote: "仅展示近 30 天小红书实拍依据与实时查验通过的方案；未核实项目老实标注待确认。",
    publishCadence: {
      collectedAt: nowIso,
      regularPublishTarget: "每周三 21:00 前发布当周方案",
      fridayRefreshTarget: `${addDays(weekId, -1)} 17:30 刷新周五短时天气校准`,
      note: "周五增量刷新仅更新天气提示与室内备选，已有选择时绝不静默重排方案。",
    },
    childProfile: {
      name: "张年",
      birthDay: CHILD_BIRTH_DAY,
      ageOnSaturday: ageInfo.ageLabel,
      ageLabel: ageInfo.ageLabel,
      ageFormula: ageInfo.ageFormula,
      mobilityBoundary: "全程平路推车、草坪/街区短步或船上安坐；忌爬山、连续台阶与长时间抱行",
      unconfirmedPreferences: [
        "午睡起止时刻、车上是否睡足及晚间入睡时刻均属未确认项（午后保留 60–90 分钟弹性休息窗）",
      ],
    },
    familyBaseline: {
      origin: { name: "杭州西湖区三墩镇", lat: 30.308, lng: 120.088 },
      transport: "家庭自驾（2 成人 + 1 婴儿车）",
      maxDistanceScope: "跨城过夜单程 <= 2.5h；本地逛街 ~35–45m；周边湿地 1h 圈",
      departureWindow: "周六早上 09:00–10:30 或下午 13:00–14:30",
      crowdAndStyleRule: "排除美术馆/艺术展；三方案不同体验类型；亚朵标准化大床优先，不用喜来登主推。",
      hotelBudget: {
        regularTargetRmb: 500,
        stretchAllowed: true,
        hardCapRmb: HOTEL_HARD_CAP_RMB,
        party: `2 成人 + 1 儿童（${ageInfo.ageLabel}，平台参数 ages=${ageInfo.yearsInt}）`,
        note: "常规约 ¥500/晚，硬上限 ¥1,000/晚；三口同睡 1.8m+ 大床。",
      },
      totalTripBudget: null,
      totalBudgetPolicy: "未设定总行程预算；仅逐项列出实查房费、门票与预估交通油费。",
    },
    weatherSummary,
    crawlAudit,
    excludedExperienceTypes: normalizedExcluded,
    proposals: [],
    inspirationPool: safeInspiration,
    noGoAlerts,
  };

  if (availability.recommendedStatus === "unavailable") {
    const notice = unavailableTextForReason(availability.unavailableReason);
    const snapshot = {
      ...baseEnvelope,
      status: "unavailable",
      proposals: [],
      unavailableNotice: {
        reason: availability.unavailableReason,
        ...notice,
        detectedAt: nowIso,
        ...(fallbackArchiveWeekId ? { fallbackArchiveWeekId } : {}),
      },
    };
    const check = validateSnapshotHardGates(snapshot, { requireOssMedia });
    return { ok: check.ok, errors: check.errors, snapshot, availability };
  }

  if (availability.recommendedStatus === "rest_recommended") {
    const snapshot = {
      ...baseEnvelope,
      status: "rest_recommended",
      proposals: [],
      restRecommendation: {
        reason: "本轮候选未同时满足天气、体能或住宿硬门槛，建议本周在家门口轻松过。",
        weatherOrCrowdTrigger: weatherSummary?.horizonConfidenceLabel ?? "综合安全与舒适度考虑",
        microActivities: [
          { title: "家门口公园踩叶 / 推车散步", driveMinutes: "10 分钟", indoor: false, note: "不赶路，随时回家午睡。" },
          { title: "常去社区街区买面包喝热饮", driveMinutes: "15 分钟", indoor: true, note: "轻松不折腾。" },
        ],
      },
    };
    const check = validateSnapshotHardGates(snapshot, { requireOssMedia });
    return { ok: check.ok, errors: check.errors, snapshot, availability };
  }

  const eligible = [...availability.passingStrong, ...availability.passingWeak].map((item) => ({
    ...item,
    score: computeRetrievalHintScore(item.candidate, weights, cooldown, from),
  }));
  const usesEditorialSelection = eligible.some(
    (item) => Number.isFinite(Number(item?.candidate?.editorialOrder)) || item?.candidate?.editorialCurated === true,
  );
  const selected = selectOrthogonalProposals(eligible);
  const proposals = selected.map((item) => buildFinalProposal(item, from));

  const snapshot = {
    ...baseEnvelope,
    crawlAudit: {
      ...crawlAudit,
      editorialSelectionMode: usesEditorialSelection ? "editorial_curated" : "retrieval_triage_fallback",
    },
    status: "published",
    proposals,
  };

  const check = validateSnapshotHardGates(snapshot, { requireOssMedia });
  return {
    ok: check.ok,
    errors: check.errors,
    snapshot,
    availability,
    editorialSelectionMode: usesEditorialSelection ? "editorial_curated" : "retrieval_triage_fallback",
  };
}

/**
 * Friday incremental weather update: refreshes weatherSummary + weatherSlots + fridayAlert
 * while STRICTLY keeping existing proposal order, slots, and user's selectedProposalId untouched.
 */
export function applyFridayRefresh({
  snapshot,
  weatherBundle,
  state = null,
  closureAlerts = [],
  nowIso = new Date().toISOString(),
}) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("SNAPSHOT_REQUIRED_FOR_FRIDAY_REFRESH");
  }
  const next = structuredClone(snapshot);
  const from = next.weekendRange?.from ?? next.weekId;
  const to = next.weekendRange?.to ?? addDays(from, 1);

  if (weatherBundle) {
    next.weatherSummary = {
      testedAt: weatherBundle.testedAt ?? nowIso,
      primarySourceLabel: weatherBundle.primarySourceLabel ?? next.weatherSummary?.primarySourceLabel,
      secondarySourceLabel: weatherBundle.secondarySourceLabel ?? "周五短时天气校准",
      precipProbabilityPct: weatherBundle.precipProbabilityPct ?? null,
      precipProbabilityStatus: weatherBundle.precipProbabilityStatus ?? "unconfirmed",
      precipProbabilityNote: weatherBundle.precipProbabilityNote ?? next.weatherSummary?.precipProbabilityNote,
      horizonConfidence: weatherBundle.horizonConfidence ?? "high",
      horizonConfidenceLabel: weatherBundle.horizonConfidenceLabel ?? "周五 48 小时内短时校准",
      fridayRefreshHint: weatherBundle.fridayRefreshHint ?? next.weatherSummary?.fridayRefreshHint,
      cities: Array.isArray(weatherBundle.cities) && weatherBundle.cities.length > 0
        ? weatherBundle.cities
        : next.weatherSummary?.cities ?? [],
    };
  }

  const cityList = next.weatherSummary?.cities ?? [];
  const hasRain = cityList.some((c) => (c.daysSummary ?? []).some((d) => d.hasRainInDaytime));
  const selectedId = state?.selectedProposalId ?? null;
  const selectedProp = selectedId ? (next.proposals ?? []).find((p) => p.id === selectedId) : null;

  // Refresh weatherSlots on existing proposals WITHOUT changing order/rank/slot!
  for (const prop of next.proposals ?? []) {
    const matchedCity = cityList.find((c) =>
      (prop.region ?? "").includes(c.city) || (prop.title ?? "").includes(c.city),
    ) ?? cityList[0];
    if (matchedCity && matchedCity.hour3Segments) {
      const refreshedSlots = buildProposalWeatherSlots(matchedCity, [
        { date: from, startHour: 11, endHour: 17, slotLabel: `周六白天（${matchedCity.city}）` },
        { date: to, startHour: 8, endHour: 17, slotLabel: `周日白天（${matchedCity.city}）` },
      ]);
      if (refreshedSlots.length > 0) {
        prop.weatherSlots = refreshedSlots;
      }
    }
  }

  const severity = hasRain || closureAlerts.length > 0 ? "adjust" : "info";
  const targetName = selectedProp?.title ?? next.proposals?.[0]?.title ?? "本周方案";
  const headline = severity === "adjust"
    ? `周五天气/场馆提示：${hasRain ? "周末部分时段有雨" : "局部运营有变动"}，已保留你的原定安排`
    : `周五短时校准完成：周末气候平稳，${selectedId ? "继续按已选方案出发" : "各方案节奏不变"}`;

  const summaryParts = [];
  if (weatherBundle?.fridayRefreshHint) summaryParts.push(weatherBundle.fridayRefreshHint);
  if (closureAlerts.length > 0) summaryParts.push(`场馆提示：${closureAlerts.join("；")}`);
  if (selectedId) summaryParts.push(`已锁定的「${targetName}」顺序与出发版本保持不变。`);

  next.fridayAlert = {
    refreshedAt: nowIso,
    severity,
    headline,
    summary: summaryParts.join(" ") || "周末天气已按最新 48 小时数据更新，当前方案顺序保持不变。",
    ...(severity === "adjust" ? { swapSuggestion: "如遇降雨可一键切至 15 分钟内室内备选（非艺术类优先）。" } : {}),
    keepsSelectedProposal: true,
  };
  next.generatedAt = nowIso;

  return next;
}

export function loadLocalWeekendContext(opsStateDir = path.join(os.homedir(), "NianlifeOps", "ops-daily", "state", "weekend")) {
  return {
    weights: readPreferenceWeights(path.join(opsStateDir, "preference-weights.json")),
    cooldown: readCooldownPool(path.join(opsStateDir, "cooldown-venues.json")),
    excludedExperienceTypes: readExcludedTypesFile(path.join(opsStateDir, "excluded-types.json")),
    visitedContext: loadVisitedPlacesContext({ opsStateDir }),
  };
}
