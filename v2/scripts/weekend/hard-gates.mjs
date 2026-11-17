// Pure & deterministic validation gates for Nianlife "Weekend Planner" (Phase 2/3).
// Enforces: near-30-day XHS notes relative to target weekend `from`, engagement thresholds
// (`signalStrength: "strong" | "weak"`), unavailable stop-publish triggers, excluded experience types,
// hotel <= 1000 RMB without fabricated price ranges, OSS `/api/weekend-media/` paths, root homepage
// URL downgrade to `unconfirmed`, `latestDepartureCutoff`, dynamic `ageOn`, and `totalTripBudget === null`.
import { ageBetween, ageOn } from "../../lib/time-signature.ts";

export const CHILD_BIRTH_DAY = "2025-01-03";
export const HOTEL_HARD_CAP_RMB = 1000;
export const XHS_MAX_AGE_DAYS = 30;
export const MIN_XHS_NOTES_PER_PROPOSAL = 2;
export const MIN_XHS_LIKES_THRESHOLD = 100;
export const MIN_XHS_COMMENTS_THRESHOLD = 10;
export const DEFAULT_WALK_CAP_KM = 1.2;
export const TIGHTENED_WALK_CAP_KM = 0.8;

export const ART_EXCLUSION_ALIASES = new Set(["art_museum_exhibition", "art_exhibition"]);
export const ART_EXCLUSION_PATTERN = /(美术馆|艺术展|当代艺术|看展|设计周|art_exhibition|art_museum_exhibition)/i;

export const RAIN_INDOOR_PRIORITY_TYPES = [
  "covered_market",
  "aquarium_animal",
  "train_transport",
  "large_bookstore",
  "indoor_botanical",
  "teahouse",
];

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const XHS_NOTE_URL_RE = /^https:\/\/www\.xiaohongshu\.com\/explore\/([a-zA-Z0-9]+)\?.*xsec_token=([^&#]+)/;
const OSS_MEDIA_PREFIX = "/api/weekend-media/";

export function isValidYmd(day) {
  if (typeof day !== "string" || !YMD_RE.test(day)) return false;
  const parsed = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return false;
  return new Date(parsed).toISOString().slice(0, 10) === day;
}

export function diffDaysYmd(laterDay, earlierDay) {
  if (!isValidYmd(laterDay) || !isValidYmd(earlierDay)) return Number.NaN;
  const laterMs = Date.parse(`${laterDay}T00:00:00Z`);
  const earlierMs = Date.parse(`${earlierDay}T00:00:00Z`);
  return Math.round((laterMs - earlierMs) / 86_400_000);
}

/**
 * Computes child's age label and Ctrip integer `ages` parameter dynamically via `ageOn` / `ageBetween`.
 */
export function computeChildAgeOn(targetDay, birthDay = CHILD_BIRTH_DAY) {
  if (!isValidYmd(targetDay) || !isValidYmd(birthDay)) {
    throw new Error(`Invalid date for age computation: targetDay=${targetDay}, birthDay=${birthDay}`);
  }
  const parts = ageBetween(birthDay, targetDay);
  const label = ageOn(birthDay, targetDay);
  if (!parts || !label) {
    throw new Error(`Target day ${targetDay} precedes birth day ${birthDay}`);
  }
  return {
    birthDay,
    targetDay,
    ageLabel: label,
    yearsInt: parts.years,
    monthsRemainder: parts.months,
    daysRemainder: parts.days,
    ageFormula: `ageOn("${birthDay}", "${targetDay}") = ${label}`,
  };
}

/**
 * Computes `latestDepartureCutoff` by subtracting experience, parking/ticket buffer, and max drive
 * minutes from `anchorLastEntryHHMM`.
 */
export function computeLatestDepartureCutoff({
  anchorLastEntryHHMM = null,
  minExperienceMinutes = 60,
  parkingAndTicketBufferMinutes = 15,
  driveMinutesMax = 0,
  fallbackAction = "",
} = {}) {
  if (!anchorLastEntryHHMM) {
    return {
      hasCutoff: false,
      anchorClosingTime: "开放式无硬性停入截止",
      cutoffTime: "全天自由发车",
      formulaNote: "无固定闭馆/尾班船闸门限制",
      headline: "无需卡点赶门，按宝宝起床或午睡状态自由发车",
      fallbackAction,
    };
  }
  const match = String(anchorLastEntryHHMM).trim().match(HHMM_RE);
  if (!match) {
    throw new Error(`Invalid anchorLastEntryHHMM format: ${anchorLastEntryHHMM}`);
  }
  const h = Number(match[1]);
  const m = Number(match[2]);
  const rawMin =
    h * 60 +
    m -
    Math.max(0, Number(minExperienceMinutes) || 0) -
    Math.max(0, Number(parkingAndTicketBufferMinutes) || 0) -
    Math.max(0, Number(driveMinutesMax) || 0);
  const feasible = rawMin >= 0;
  const clampedMin = Math.max(0, rawMin);
  const hh = String(Math.floor(clampedMin / 60)).padStart(2, "0");
  const mm = String(clampedMin % 60).padStart(2, "0");
  const hhmm = `${hh}:${mm}`;

  return {
    hasCutoff: true,
    feasible,
    anchorClosingTime: `${anchorLastEntryHHMM} 停止入场/尾班发车`,
    cutoffTime: feasible ? hhmm : `已超窗(${hhmm})`,
    formulaNote: `${anchorLastEntryHHMM} 停入 - ${minExperienceMinutes} 分钟体验 - ${parkingAndTicketBufferMinutes} 分钟停车进场 - ${driveMinutesMax} 分钟车程上限 = ${hhmm}`,
    headline: feasible
      ? `最晚 ${hhmm} 从三墩出发；若过点再出门，建议执行备选切线`
      : `当天出发窗口不足，建议直接执行备选切线`,
    fallbackAction,
  };
}

export function parseXhsCount(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.max(0, Math.floor(raw));
  const text = String(raw ?? "").trim();
  if (!text) return 0;
  const wanMatch = text.match(/(\d+(?:\.\d+)?)\s*万/);
  if (wanMatch) return Math.round(Number(wanMatch[1]) * 10000);
  const numMatch = text.match(/(\d+)/);
  return numMatch ? Number(numMatch[1]) : 0;
}

export function isValidXhsExploreUrl(url) {
  if (typeof url !== "string") return false;
  return XHS_NOTE_URL_RE.test(url.trim());
}

/**
 * Checks whether `publishedAt` is within 30 days relative to target weekend `from` (`targetFromDay`).
 */
export function isNoteWithin30Days(publishedAt, targetFromDay, maxDays = XHS_MAX_AGE_DAYS) {
  const diffDays = diffDaysYmd(targetFromDay, publishedAt);
  return {
    ok: Number.isFinite(diffDays) && diffDays >= 0 && diffDays <= maxDays,
    diffDays,
  };
}

export function evaluateXhsNote(note, targetFromDay, maxDays = XHS_MAX_AGE_DAYS) {
  const reasons = [];
  if (!note || typeof note !== "object") {
    return { ok: false, reasons: ["INVALID_XHS_NOTE_OBJECT"], diffDays: Number.NaN, likesNum: 0, commentsNum: 0 };
  }
  const publishedAt = note.publishedAt ?? note.publishDate ?? "";
  const age = isNoteWithin30Days(publishedAt, targetFromDay, maxDays);
  if (!age.ok) {
    reasons.push(`NOTE_OUTSIDE_30_DAYS:${publishedAt}:${age.diffDays}`);
  }
  if (note.within30Days === false) {
    reasons.push("NOTE_FLAGGED_NOT_WITHIN_30_DAYS");
  }
  const url = note.url ?? note.noteUrl ?? "";
  if (!isValidXhsExploreUrl(url)) {
    reasons.push("MISSING_VALID_XHS_EXPLORE_TOKEN_URL");
  }
  if (note.noImageUsed === false || Boolean(note.imageUrl) || (Array.isArray(note.images) && note.images.length > 0)) {
    reasons.push("FORBIDDEN_XHS_IMAGE_ATTACHED");
  }
  const likesNum = Math.max(parseXhsCount(note.likesNum), parseXhsCount(note.likes));
  const commentsNum = Math.max(
    parseXhsCount(note.totalCommentsNum),
    parseXhsCount(note.commentCountText),
    parseXhsCount(note.commentsCaptured),
  );
  return {
    ok: reasons.length === 0,
    reasons,
    diffDays: age.diffDays,
    likesNum,
    commentsNum,
    meetsEngagementThreshold: likesNum >= MIN_XHS_LIKES_THRESHOLD || commentsNum >= MIN_XHS_COMMENTS_THRESHOLD,
  };
}

export function evaluateXhsSignalStrength(notes = []) {
  const hasHighEngagement = notes.some((n) => {
    const likes = Math.max(parseXhsCount(n?.likesNum), parseXhsCount(n?.likes));
    const comments = Math.max(
      parseXhsCount(n?.totalCommentsNum),
      parseXhsCount(n?.commentCountText),
      parseXhsCount(n?.commentsCaptured),
    );
    return likes >= MIN_XHS_LIKES_THRESHOLD || comments >= MIN_XHS_COMMENTS_THRESHOLD;
  });
  return hasHighEngagement ? "strong" : "weak";
}

export function normalizeExcludedTypes(input) {
  const list = Array.isArray(input)
    ? input
    : Array.isArray(input?.excludedExperienceTypes)
      ? input.excludedExperienceTypes
      : Array.isArray(input?.items)
        ? input.items
        : [];
  const typeSet = new Set();
  const labels = [];
  for (const item of list) {
    if (typeof item === "string" && item.trim()) {
      const code = item.trim();
      typeSet.add(code);
      if (ART_EXCLUSION_ALIASES.has(code)) {
        typeSet.add("art_exhibition");
        typeSet.add("art_museum_exhibition");
      }
    } else if (item && typeof item === "object" && typeof item.experienceType === "string" && item.experienceType.trim()) {
      const code = item.experienceType.trim();
      typeSet.add(code);
      if (ART_EXCLUSION_ALIASES.has(code)) {
        typeSet.add("art_exhibition");
        typeSet.add("art_museum_exhibition");
      }
      if (typeof item.label === "string" && item.label.trim()) {
        labels.push(item.label.trim());
      }
    }
  }
  return { typeSet, labels };
}

export function matchesExcludedExperienceType(candidate, excludedExperienceTypes = ["art_museum_exhibition"]) {
  const { typeSet, labels } = normalizeExcludedTypes(excludedExperienceTypes);
  if (typeSet.size === 0 && labels.length === 0) return { excluded: false, matched: null };

  const expType = String(candidate?.experienceType ?? "").trim();
  if (expType && typeSet.has(expType)) {
    return { excluded: true, matched: expType };
  }

  const artExcluded = typeSet.has("art_exhibition") || typeSet.has("art_museum_exhibition");
  const textFields = [
    candidate?.experienceType,
    candidate?.experienceTypeLabel,
    candidate?.title,
    candidate?.subtitle,
    candidate?.adultDelight,
    candidate?.worthGoingChecks?.adultDelight?.detail,
    candidate?.worthGoingChecks?.coreAnchorAndReason?.detail,
  ]
    .filter((v) => typeof v === "string")
    .join(" ");

  if (artExcluded && ART_EXCLUSION_PATTERN.test(textFields)) {
    return { excluded: true, matched: "art_exhibition" };
  }

  for (const label of labels) {
    if (label && candidate?.experienceTypeLabel === label) {
      return { excluded: true, matched: label };
    }
  }
  return { excluded: false, matched: null };
}

/**
 * Returns true if a URL only points to a bare site root homepage (e.g. `https://hangzhou.gov.cn/`).
 */
export function isRootHomepageUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return true;
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return true;
  }
  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname || "/";
  const search = parsed.search || "";

  if ((pathname === "/" || /^\/(index\.(html?|php|aspx?)|home|default\.aspx)$/i.test(pathname)) && !search) {
    return true;
  }
  if (host.includes("xiaohongshu.com") && (pathname === "/explore" || pathname === "/explore/" || pathname.startsWith("/search_result"))) {
    return true;
  }
  if (host.includes("ctrip.com") && (pathname === "/" || pathname === "/hotels" || pathname === "/hotels/")) {
    return true;
  }
  return false;
}

export function sanitizeSourcesDetailUrls(sources = []) {
  if (!Array.isArray(sources)) return [];
  return sources.map((src) => {
    if (!src || typeof src !== "object") return src;
    if (src.verificationStatus === "verified" && isRootHomepageUrl(src.url)) {
      return {
        ...src,
        verificationStatus: "unconfirmed",
        sanitizedFromRootHomepage: true,
      };
    }
    return { ...src };
  });
}

export function validateOssMediaPath(src) {
  if (typeof src !== "string" || !src.trim()) return false;
  const trimmed = src.trim();
  if (/xhscdn|xiaohongshu|r2\.dev|^\.\//i.test(trimmed)) return false;
  return trimmed.startsWith(OSS_MEDIA_PREFIX) && trimmed.length > OSS_MEDIA_PREFIX.length;
}

function extractMinBreakfastRate(option) {
  if (!option || typeof option !== "object") return null;
  if (typeof option.minRateWithBreakfastCny === "number" && Number.isFinite(option.minRateWithBreakfastCny)) {
    return option.minRateWithBreakfastCny;
  }
  const rates = option.liveRatesCny;
  if (!rates || typeof rates !== "object") return null;
  const breakfastKeys = Object.entries(rates).filter(
    ([k, v]) => typeof v === "number" && Number.isFinite(v) && /breakfast/i.test(k) && !/nobreakfast/i.test(k),
  );
  if (breakfastKeys.length > 0) {
    return Math.min(...breakfastKeys.map(([, v]) => v));
  }
  const anyNumeric = Object.values(rates).filter((v) => typeof v === "number" && Number.isFinite(v));
  return anyNumeric.length > 0 ? Math.min(...anyNumeric) : null;
}

export function validateHotelGate(candidateOrProposal) {
  const reasons = [];
  const isOvernight = Boolean(candidateOrProposal?.isOvernight ?? candidateOrProposal?.hotel?.required);
  if (!isOvernight) return { ok: true, reasons, validOptions: [] };

  const hotel = candidateOrProposal?.hotel;
  const rawOptions = Array.isArray(candidateOrProposal?.hotelOptions)
    ? candidateOrProposal.hotelOptions
    : Array.isArray(hotel?.options)
      ? hotel.options
      : [];

  const summaryTexts = [
    candidateOrProposal?.hotelSummaryShort,
    hotel?.budgetConstraint,
    hotel?.recommendationReason,
  ]
    .filter((v) => typeof v === "string")
    .join(" ");

  if (/(参考区间|历史参考价|估算区间|预估每晚)/.test(summaryTexts) && rawOptions.length === 0) {
    reasons.push("FABRICATED_HOTEL_PRICE_RANGE");
  }

  const validOptions = [];
  for (const opt of rawOptions) {
    if (!opt || typeof opt !== "object") continue;
    const rate = extractMinBreakfastRate(opt);
    const hasCapturedSource = Boolean(opt.capturedAt || hotel?.searchQueryParams?.capturedAt || opt.bookingUrl);
    if (rate === null && /(参考|约\s*\d+\s*[-–~]\s*\d+)/.test(String(opt.liveRatesCny?.note ?? ""))) {
      reasons.push("FABRICATED_HOTEL_PRICE_RANGE");
      continue;
    }
    if (!hasCapturedSource && opt.verificationStatus === "verified") {
      reasons.push("UNVERIFIED_HOTEL_RATE_MARKED_VERIFIED");
      continue;
    }
    if (!opt.soldOut && rate !== null && rate <= HOTEL_HARD_CAP_RMB) {
      validOptions.push({ option: opt, minRateWithBreakfastCny: rate });
    }
  }

  if (validOptions.length === 0) {
    reasons.push("NO_AFFORDABLE_HOTEL_UNDER_1000");
  } else {
    const primary = rawOptions[0];
    if (primary && /喜来登|sheraton/i.test(String(primary.name ?? ""))) {
      reasons.push("DISLIKED_HOTEL_BRAND_AS_PRIMARY");
    }
  }

  return { ok: reasons.length === 0, reasons: [...new Set(reasons)], validOptions };
}

export function validateRainIndoorBackup(alternatives = [], excludedExperienceTypes = ["art_museum_exhibition"]) {
  const reasons = [];
  if (!Array.isArray(alternatives) || alternatives.length === 0) {
    return { ok: false, reasons: ["MISSING_INDOOR_FALLBACK"], sortedAlternatives: [] };
  }
  const { typeSet } = normalizeExcludedTypes(excludedExperienceTypes);
  const artExcluded = typeSet.has("art_exhibition") || typeSet.has("art_museum_exhibition");

  const scored = alternatives.map((alt) => {
    const name = String(alt?.name ?? "");
    const note = String(alt?.note ?? "");
    const isArt = Boolean(alt?.isArtVenue) || ART_EXCLUSION_PATTERN.test(`${name} ${note}`);
    const priorityIdx = RAIN_INDOOR_PRIORITY_TYPES.indexOf(alt?.indoorType ?? "");
    const rank = isArt ? 999 : priorityIdx >= 0 ? priorityIdx : 50;
    if (artExcluded && isArt && !/这是艺术类场馆，你们可能不感兴趣/.test(note)) {
      reasons.push("ART_BACKUP_MISSING_CAVEAT");
    }
    return { alt, rank, isArt };
  });

  scored.sort((a, b) => a.rank - b.rank);
  const hasNonArtIndoor = scored.some((item) => !item.isArt && item.alt?.indoor !== false);
  if (!hasNonArtIndoor && reasons.includes("ART_BACKUP_MISSING_CAVEAT")) {
    reasons.push("NO_NON_ART_INDOOR_BACKUP_WITH_CAVEAT");
  }
  return {
    ok: reasons.length === 0,
    reasons: [...new Set(reasons)],
    sortedAlternatives: scored.map((s) => s.alt),
  };
}

/**
 * Full per-candidate hard gate evaluator (XHS 30-day + engagement + excluded types + hotel <= 1000
 * + Strip-Food test + mobility/odor/cooldown + indoor backup + detail URLs + OSS media).
 */
export function passesXhsAndHardGates(
  candidate,
  weekStartDay,
  excludedExperienceTypes = ["art_museum_exhibition"],
  options = {},
) {
  const reasons = [];
  const warnings = [];
  const walkCapKm = Number(options.walkCapKm ?? candidate?.walkCapKm ?? DEFAULT_WALK_CAP_KM);
  const allowWeak = Boolean(options.allowWeak);

  const excl = matchesExcludedExperienceType(candidate, excludedExperienceTypes);
  if (excl.excluded) {
    reasons.push(`EXCLUDED_EXPERIENCE_TYPE:${excl.matched}`);
  }

  const rawNotes = Array.isArray(candidate?.xhsNotes)
    ? candidate.xhsNotes
    : Array.isArray(candidate?.xhsEvidence?.notes)
      ? candidate.xhsEvidence.notes
      : [];

  const validNotes = [];
  for (const n of rawNotes) {
    const ev = evaluateXhsNote(n, weekStartDay);
    if (ev.ok) validNotes.push(n);
  }
  if (validNotes.length < MIN_XHS_NOTES_PER_PROPOSAL) {
    reasons.push("MISSING_MIN_2_RECENT_XHS_NOTES");
  }

  const signalStrength = evaluateXhsSignalStrength(validNotes);
  if (signalStrength === "weak") {
    if (allowWeak) warnings.push("WEAK_XHS_ENGAGEMENT_SIGNAL");
    else reasons.push("WEAK_XHS_ENGAGEMENT_SIGNAL");
  }

  const hotelCheck = validateHotelGate(candidate);
  if (!hotelCheck.ok) {
    reasons.push(...hotelCheck.reasons);
  }

  const isOvernight = Boolean(candidate?.isOvernight);
  const driveMin = Number(candidate?.driveMinutesMax ?? candidate?.driveFromSandun?.durationMinutesRange?.[1] ?? 0);
  const minContentHours = Number(options.minStrippedContentHours ?? 2.5);
  if (isOvernight) {
    if (driveMin > 150 && !candidate?.allowHighwayVarianceOver150) {
      reasons.push("DRIVE_OVER_2_5H_WARNING");
    }
    const satH = Number(candidate?.strippedSatAfternoonHours ?? 0);
    const sunH = Number(candidate?.strippedSunMorningHours ?? 0);
    if (satH < minContentHours || sunH < minContentHours) {
      reasons.push("STRIPPED_CONTENT_BELOW_2_5H");
    }
  } else {
    if (driveMin > 90) reasons.push("DAYTRIP_OVER_1_5H");
    const halfH = Number(candidate?.strippedBestHalfDayHours ?? 0);
    if (halfH < minContentHours) reasons.push("DAYTRIP_STRIPPED_BELOW_2_5H");
  }

  const maxWalk = Number(candidate?.maxSingleWalkKm ?? 0);
  if (candidate?.hasMountainClimb || candidate?.hasLongStairs || maxWalk > walkCapKm) {
    reasons.push("MOBILITY_VIOLATION");
  }
  if (candidate?.hasSevereOdorRisk || candidate?.isVenueClosed || candidate?.inCooldownPool) {
    reasons.push("VENUE_PITFALL_OR_COOLDOWN_BLOCKED");
  }

  const indoorAlts = Array.isArray(candidate?.nearbyIndoorAlternatives)
    ? candidate.nearbyIndoorAlternatives
    : Array.isArray(candidate?.degradationTree?.rain?.nearbyAlternatives)
      ? candidate.degradationTree.rain.nearbyAlternatives
      : [];
  const indoorCheck = validateRainIndoorBackup(indoorAlts, excludedExperienceTypes);
  if (!indoorCheck.ok) {
    reasons.push(...indoorCheck.reasons);
  }

  if (options.requireOssMedia) {
    const imgs = [
      candidate?.heroImage?.src,
      ...(Array.isArray(candidate?.galleryImages) ? candidate.galleryImages.map((g) => g?.src) : []),
    ].filter(Boolean);
    if (imgs.some((src) => !validateOssMediaPath(src))) {
      reasons.push("INVALID_MEDIA_SOURCE_NOT_OSS");
    }
  }

  if (Array.isArray(candidate?.sources)) {
    const badVerifiedRoot = candidate.sources.some(
      (s) => s?.verificationStatus === "verified" && isRootHomepageUrl(s.url),
    );
    if (badVerifiedRoot) {
      reasons.push("ROOT_HOMEPAGE_MARKED_VERIFIED");
    }
  }

  if (candidate?.totalTripBudget !== undefined && candidate.totalTripBudget !== null) {
    reasons.push("TOTAL_TRIP_BUDGET_NOT_NULL");
  }
  if (candidate?.costBreakdown && candidate.costBreakdown.totalTripBudgetSet !== false) {
    reasons.push("TOTAL_TRIP_BUDGET_NOT_NULL");
  }

  const cutoff = computeLatestDepartureCutoff({
    anchorLastEntryHHMM: candidate?.anchorLastEntryHHMM ?? null,
    minExperienceMinutes: candidate?.minExperienceMinutes ?? 60,
    parkingAndTicketBufferMinutes: candidate?.parkingAndTicketBufferMinutes ?? 15,
    driveMinutesMax: driveMin,
    fallbackAction: candidate?.fallbackAction ?? candidate?.latestDepartureCutoff?.fallbackAction ?? "",
  });

  return {
    ok: reasons.length === 0,
    signalStrength,
    meetsMinimumNotes: validNotes.length >= MIN_XHS_NOTES_PER_PROPOSAL,
    validNoteCount: validNotes.length,
    validNotes,
    reasons: [...new Set(reasons)],
    warnings: [...new Set(warnings)],
    cutoff,
  };
}

/**
 * Decides whether the weekly build can publish or must trigger `unavailable` / `rest_recommended`.
 * Zero fallback to official pages or LLM impressions when XHS evidence is insufficient.
 */
export function evaluatePublishAvailability({
  candidates = [],
  crawlStatus = {},
  weekStartDay,
  excludedExperienceTypes = ["art_museum_exhibition"],
  options = {},
}) {
  if (crawlStatus?.authExpired) {
    return {
      canPublish: false,
      recommendedStatus: "unavailable",
      unavailableReason: "xhs_auth_expired",
      passingStrong: [],
      passingWeak: [],
      rejected: [],
    };
  }
  if (crawlStatus?.riskStopped) {
    return {
      canPublish: false,
      recommendedStatus: "unavailable",
      unavailableReason: "xhs_risk_stopped",
      passingStrong: [],
      passingWeak: [],
      rejected: [],
    };
  }
  if (crawlStatus?.pcOffline) {
    return {
      canPublish: false,
      recommendedStatus: "unavailable",
      unavailableReason: "pc_offline_mon_to_wed",
      passingStrong: [],
      passingWeak: [],
      rejected: [],
    };
  }

  const passingStrong = [];
  const passingWeak = [];
  const rejected = [];
  let anyHasMin2RecentNotes = false;

  for (const candidate of candidates) {
    const strictRes = passesXhsAndHardGates(candidate, weekStartDay, excludedExperienceTypes, {
      ...options,
      allowWeak: false,
    });
    const weakAllowedRes = passesXhsAndHardGates(candidate, weekStartDay, excludedExperienceTypes, {
      ...options,
      allowWeak: true,
    });
    if (strictRes.meetsMinimumNotes) anyHasMin2RecentNotes = true;

    if (strictRes.ok) {
      passingStrong.push({ candidate, gate: strictRes });
    } else if (weakAllowedRes.ok) {
      passingWeak.push({ candidate, gate: weakAllowedRes });
    } else {
      rejected.push({ candidate, gate: strictRes });
    }
  }

  if (!anyHasMin2RecentNotes || (passingStrong.length === 0 && passingWeak.length === 0 && rejected.every((r) => r.gate.reasons.includes("MISSING_MIN_2_RECENT_XHS_NOTES")))) {
    return {
      canPublish: false,
      recommendedStatus: "unavailable",
      unavailableReason: "insufficient_recent_notes",
      passingStrong,
      passingWeak,
      rejected,
    };
  }

  if (passingStrong.length === 0 && passingWeak.length === 0) {
    return {
      canPublish: false,
      recommendedStatus: "rest_recommended",
      unavailableReason: null,
      passingStrong,
      passingWeak,
      rejected,
    };
  }

  if (options.requireStrongForPublish && passingStrong.length === 0) {
    return {
      canPublish: false,
      recommendedStatus: "unavailable",
      unavailableReason: "insufficient_recent_notes",
      passingStrong,
      passingWeak,
      rejected,
    };
  }

  return {
    canPublish: true,
    recommendedStatus: "published",
    unavailableReason: null,
    passingStrong,
    passingWeak,
    rejected,
  };
}

/**
 * Validates an assembled `WeekendPlannerSnapshot` JSON against all production hard gates.
 */
export function validateSnapshotHardGates(snapshot, options = {}) {
  const errors = [];
  if (!snapshot || typeof snapshot !== "object") {
    return { ok: false, errors: ["SNAPSHOT_NOT_OBJECT"] };
  }
  if (snapshot.schema !== "nianlife.weekend-planner/1") errors.push("INVALID_SCHEMA");
  const weekStartDay = snapshot.weekendRange?.from ?? snapshot.weekId;
  if (!isValidYmd(weekStartDay)) errors.push("INVALID_WEEK_START_DAY");

  if (snapshot.childProfile?.birthDay !== CHILD_BIRTH_DAY) {
    errors.push("INVALID_CHILD_BIRTH_DAY");
  } else if (isValidYmd(weekStartDay)) {
    const expectedAge = ageOn(CHILD_BIRTH_DAY, weekStartDay);
    if (snapshot.childProfile?.ageOnSaturday !== expectedAge) {
      errors.push(`AGE_MISMATCH:got=${snapshot.childProfile?.ageOnSaturday}:want=${expectedAge}`);
    }
  }

  if (snapshot.familyBaseline?.hotelBudget?.hardCapRmb !== HOTEL_HARD_CAP_RMB) {
    errors.push("INVALID_HOTEL_HARD_CAP");
  }
  if (snapshot.familyBaseline?.totalTripBudget !== null) {
    errors.push("TOTAL_TRIP_BUDGET_MUST_BE_NULL");
  }

  if ("wechatShareTemplates" in snapshot || "actors" in snapshot || "votes" in snapshot || "consensus" in snapshot) {
    errors.push("FORBIDDEN_LEGACY_TOP_LEVEL_KEYS");
  }

  const excludedTypes = snapshot.excludedExperienceTypes ?? ["art_museum_exhibition"];

  if (snapshot.status === "unavailable") {
    if (!snapshot.unavailableNotice?.reason) errors.push("MISSING_UNAVAILABLE_NOTICE");
    if (Array.isArray(snapshot.proposals) && snapshot.proposals.length > 0) {
      errors.push("UNAVAILABLE_SNAPSHOT_MUST_NOT_HAVE_PROPOSALS");
    }
    return { ok: errors.length === 0, errors };
  }

  if (snapshot.status === "rest_recommended") {
    if (!snapshot.restRecommendation?.reason) errors.push("MISSING_REST_RECOMMENDATION");
    return { ok: errors.length === 0, errors };
  }

  if (snapshot.status === "published") {
    const proposals = snapshot.proposals ?? [];
    if (!Array.isArray(proposals) || proposals.length === 0 || proposals.length > 3) {
      errors.push("PUBLISHED_PROPOSALS_COUNT_INVALID");
    } else {
      for (const p of proposals) {
        const prefix = `proposal[${p?.id ?? "?"}]`;
        const excl = matchesExcludedExperienceType(p, excludedTypes);
        if (excl.excluded) errors.push(`${prefix}:EXCLUDED_TYPE:${excl.matched}`);

        const notes = p?.xhsEvidence?.notes ?? [];
        const validNotes = notes.filter((n) => evaluateXhsNote(n, weekStartDay).ok);
        if (validNotes.length < MIN_XHS_NOTES_PER_PROPOSAL) {
          errors.push(`${prefix}:MISSING_MIN_2_RECENT_XHS_NOTES`);
        }
        const expectedSig = evaluateXhsSignalStrength(validNotes);
        if (expectedSig === "weak" && p?.signalStrength === "strong") {
          errors.push(`${prefix}:SIGNAL_STRENGTH_OVERSTATED:got=strong:want=weak`);
        }

        const hotelGate = validateHotelGate(p);
        if (!hotelGate.ok) {
          for (const r of hotelGate.reasons) errors.push(`${prefix}:${r}`);
        }

        if (p?.costBreakdown?.totalTripBudgetSet !== false) {
          errors.push(`${prefix}:TOTAL_TRIP_BUDGET_SET_MUST_BE_FALSE`);
        }

        if (options.requireOssMedia !== false) {
          const imgs = [
            p?.heroImage?.src,
            ...(Array.isArray(p?.galleryImages) ? p.galleryImages.map((g) => g?.src) : []),
          ].filter(Boolean);
          for (const src of imgs) {
            if (!validateOssMediaPath(src)) {
              errors.push(`${prefix}:NON_OSS_MEDIA:${src}`);
            }
          }
        }

        for (const src of p?.sources ?? []) {
          if (src?.verificationStatus === "verified" && isRootHomepageUrl(src.url)) {
            errors.push(`${prefix}:ROOT_HOMEPAGE_VERIFIED:${src.url}`);
          }
        }
      }
    }
  }

  for (const insp of snapshot.inspirationPool ?? []) {
    const prefix = `inspiration[${insp?.id ?? "?"}]`;
    const excl = matchesExcludedExperienceType(insp, excludedTypes);
    if (excl.excluded) errors.push(`${prefix}:EXCLUDED_TYPE:${excl.matched}`);
    if (insp?.image?.src && options.requireOssMedia !== false && !validateOssMediaPath(insp.image.src)) {
      errors.push(`${prefix}:NON_OSS_MEDIA:${insp.image.src}`);
    }
    const notes = insp?.xhsEvidence ?? [];
    if (!Array.isArray(notes) || notes.length === 0) {
      errors.push(`${prefix}:MISSING_XHS_EVIDENCE`);
    } else {
      const hasValid = notes.some((n) => evaluateXhsNote(n, weekStartDay).ok);
      if (!hasValid) errors.push(`${prefix}:NO_RECENT_XHS_EVIDENCE`);
    }
  }

  return { ok: errors.length === 0, errors };
}
