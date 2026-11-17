import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  computeChildAgeOn,
  computeLatestDepartureCutoff,
  evaluatePublishAvailability,
  evaluateXhsNote,
  evaluateXhsSignalStrength,
  isRootHomepageUrl,
  matchesExcludedExperienceType,
  passesXhsAndHardGates,
  sanitizeSourcesDetailUrls,
  validateOssMediaPath,
  validateSnapshotHardGates,
} from "../scripts/weekend/hard-gates.mjs";
import {
  WEATHER_STATIONS,
  buildProposalWeatherSlots,
  fetchWeatherComCnCity,
  fetchWeekendWeatherBundle,
  parseWeatherComCnHtml,
} from "../scripts/weekend/sources-weather.mjs";
import {
  crawlXhsBatch,
  detectXhsBlockSignals,
  generateStage1OpenKeywords,
  generateStage2PlaceKeywords,
  keywordContainsSpecificPlace,
  keywordHitsExcludedTerm,
  loadReusableRawNotes,
  normalizeXhsCardHref,
  selectSearchCardsToOpen,
} from "../scripts/weekend/sources-xhs.mjs";
import {
  buildCtripHotelUrl,
  detectCtripAuthExpired,
  parseCtripHotelDetail,
  selectAndRankHotels,
  verifyOfficialSources,
} from "../scripts/weekend/sources-official-ota.mjs";
import {
  applyFeedbackAndExclusions,
  defaultCooldownPool,
  defaultPreferenceWeights,
  isVenueInCooldown,
} from "../scripts/weekend/feedback-tune.mjs";
import {
  applyFridayRefresh,
  buildWeekendSnapshot,
  selectOrthogonalProposals,
} from "../scripts/weekend/rank-and-build.mjs";
import {
  checkCandidateVisitedSpot,
  loadVisitedPlacesContext,
} from "../scripts/weekend/visited-places.mjs";
import {
  loadOverlappingTripHints,
  writeCandidateTripHint,
} from "../scripts/weekend/candidate-trip-hint.mjs";
import { sendWeekendWebhook } from "../scripts/weekend/notify-webhook.mjs";
import { resolveTargetWeekId, runWeeklyStage } from "../scripts/weekend/run-weekly.mjs";

const V2_ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

function makeNote(overrides = {}) {
  return {
    seq: 1,
    noteId: "6ade0c83000000002c037eb0",
    title: "周末草坪放空实拍",
    author: "tester",
    publishedAt: "2026-11-10",
    within30Days: true,
    likes: "150",
    collects: "80",
    commentCountText: "共 12 条评论",
    commentsCaptured: 12,
    url: "https://www.xiaohongshu.com/explore/6ade0c83000000002c037eb0?xsec_token=TOKEN123&xsec_source=pc_search",
    keyTakeaway: "平路推车友好",
    commentFeedback: "周末早上不挤",
    noImageUsed: true,
    ...overrides,
  };
}

function makeCandidate(overrides = {}) {
  return {
    id: "2026-11-21-deqing-wetland",
    title: "德清下渚湖湿地船游",
    subtitle: "推车上画舫穿芦苇",
    region: "浙江德清",
    experienceType: "wetland_boat_folk_craft",
    experienceTypeLabel: "湿地船游与民俗手作",
    isOvernight: false,
    paceLabel: "50m 当日往返",
    oneLineReason: "近期芦花盛放，画舫平顺可推车。",
    driveMinutesMax: 65,
    strippedBestHalfDayHours: 3.0,
    hasMountainClimb: false,
    hasLongStairs: false,
    maxSingleWalkKm: 0.7,
    anchorLastEntryHHMM: "16:00",
    minExperienceMinutes: 90,
    parkingAndTicketBufferMinutes: 15,
    fallbackAction: "只逛免费庾村广场",
    heroImage: {
      src: "/api/weekend-media/web/deqing-xiazhuhu.jpg",
      alt: "下渚湖湿地",
      caption: "下渚湖芦苇",
      sourcePage: "prototype-v3/assets/SOURCES.md",
    },
    xhsNotes: [
      makeNote({ noteId: "aaaa1111bbbb2222cccc3333", publishedAt: "2026-11-15", likes: "180" }),
      makeNote({ noteId: "bbbb1111cccc2222dddd4444", publishedAt: "2026-11-16", likes: "12", commentCountText: "共 2 条评论", commentsCaptured: 2 }),
    ],
    nearbyIndoorAlternatives: [
      { name: "非遗手作室内教室", driveOrWalk: "步行 5 分钟", indoor: true, parking: "游客车场", note: "避雨手作" },
    ],
    sources: [
      {
        title: "下渚湖官网线路",
        url: "http://www.xzhfjq.com/line/list.html",
        sourceType: "official_site",
        verificationStatus: "verified",
        verifiedAt: "2026-11-17T01:00:00.000Z",
      },
    ],
    driveFromSandun: {
      distanceKmEstimate: 52,
      durationMinutesRange: [50, 65],
      durationLabel: "约 50–65 分钟",
      directionFromSandun: "西北方向",
      verificationStatus: "estimated",
    },
    weatherSlots: [{ slotLabel: "周六白天", condition: "晴", tempRangeC: "13–17℃", wind: "<3级", precipRiskNote: "无雨" }],
    worthGoingChecks: {
      coreAnchorAndReason: { label: "核心理由", status: "verified", detail: "画舫穿芦苇" },
      driveToContentRatio: { label: "车程内容比", status: "verified", detail: "50m 换 3h" },
      loop15MinAndRestWindow: { label: "15m 闭环", status: "verified", detail: "平缓可歇脚" },
      rainOrFailBackup: { label: "雨天备选", status: "verified", detail: "有顶市集" },
      adultDelight: { label: "大人期待", status: "verified", detail: "芦花与热鱼汤饭" },
      notJustDiningCounterCheck: { label: "非纯吃饭", status: "verified", detail: "乘船与手作" },
    },
    urgentBookingsTonight: [],
    departures: {
      sat_morning: { label: "早", departureTime: "09:30", arrivalEstimate: "10:30", trimNote: "早班", returnTime: "16:30", timeline: [{ timeWindow: "10:30-13:30", segmentKey: "boat", title: "画舫", location: "下渚湖", slotWeather3h: "晴 15℃", driveOrWalkNote: "平路", strollerAndRestNote: "推车上船", isRestBuffer: false, category: "boat_nature" }] },
      sat_afternoon: { label: "午", departureTime: "13:00", arrivalEstimate: "14:00", trimNote: "午班", returnTime: "17:00", timeline: [{ timeWindow: "14:00-16:30", segmentKey: "boat_pm", title: "午后画舫", location: "下渚湖", slotWeather3h: "晴 14℃", driveOrWalkNote: "平路", strollerAndRestNote: "船上小睡", isRestBuffer: true, category: "boat_nature" }] },
    },
    degradationTree: {
      rain: { triggerLabel: "下雨", actionSummary: "进室内", nearbyAlternatives: [{ name: "非遗手作教室", driveOrWalk: "5m", indoor: true, parking: "地面", note: "室内" }], returnRouteHint: "杭长回" },
      childTired: { triggerLabel: "累了", actionSummary: "船头小睡", nearbyAlternatives: [], returnRouteHint: "直回" },
      crowded: { triggerLabel: "人多", actionSummary: "去庾村", nearbyAlternatives: [], returnRouteHint: "直回" },
      returnEarly: { triggerLabel: "早回", actionSummary: "随时撤", nearbyAlternatives: [], returnRouteHint: "50m" },
    },
    crowdAndTraffic: {
      roadPattern: { basis: "historical_weekend_pattern", isEstimate: true, summary: "畅通", bestDepartureWindow: "09:30", avoidWindow: "17:00" },
      venueCrowd: { riskLevel: "low_to_medium", isEstimate: true, peakHours: "12:00-14:00", offPeakTip: "早班船", signals: ["实拍可推车"] },
    },
    costBreakdown: { totalTripBudgetSet: false, totalBudgetNote: "未设定总预算", items: [] },
    ...overrides,
  };
}

test("hard-gates: dynamic ageOn, latestDepartureCutoff, and real 2026-11-21 fixture validation", () => {
  const ageNov = computeChildAgeOn("2026-11-21");
  assert.equal(ageNov.ageLabel, "1 岁 10 个月");
  assert.equal(ageNov.yearsInt, 1);

  const ageJan = computeChildAgeOn("2027-01-03");
  assert.equal(ageJan.ageLabel, "2 岁");
  assert.equal(ageJan.yearsInt, 2);

  const cutoff = computeLatestDepartureCutoff({
    anchorLastEntryHHMM: "16:00",
    minExperienceMinutes: 90,
    parkingAndTicketBufferMinutes: 15,
    driveMinutesMax: 65,
    fallbackAction: "转庾村广场",
  });
  assert.equal(cutoff.hasCutoff, true);
  assert.equal(cutoff.cutoffTime, "13:10");

  const openCutoff = computeLatestDepartureCutoff({ anchorLastEntryHHMM: null, fallbackAction: "随时出发" });
  assert.equal(openCutoff.hasCutoff, false);
  assert.equal(openCutoff.cutoffTime, "全天自由发车");

  const fixturePath = path.join(V2_ROOT, "test", "fixtures", "weekend-2026-11-21.json");
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const fixtureCheck = validateSnapshotHardGates(fixture);
  assert.equal(fixtureCheck.ok, true, `fixture failed: ${fixtureCheck.errors.join(", ")}`);
});

test("hard-gates: 30-day XHS validation relative to target `from`, signalStrength, and unavailable stop-publish", () => {
  // Exact 30 days passes; 31 days fails
  assert.equal(evaluateXhsNote(makeNote({ publishedAt: "2026-10-22" }), "2026-11-21").ok, true);
  assert.equal(evaluateXhsNote(makeNote({ publishedAt: "2026-10-21" }), "2026-11-21").ok, false);
  assert.equal(evaluateXhsNote(makeNote({ url: "https://www.xiaohongshu.com/explore/abc123" }), "2026-11-21").ok, false);
  assert.equal(evaluateXhsNote(makeNote({ noImageUsed: false }), "2026-11-21").ok, false);

  // Weak vs strong engagement threshold
  assert.equal(evaluateXhsSignalStrength([makeNote({ likes: "40", commentCountText: "共 4 条评论", commentsCaptured: 4 })]), "weak");
  assert.equal(evaluateXhsSignalStrength([makeNote({ likes: "100", commentCountText: "0", commentsCaptured: 0 })]), "strong");
  assert.equal(evaluateXhsSignalStrength([makeNote({ likes: "5", commentCountText: "共 10 条评论", commentsCaptured: 5 })]), "strong");

  // Only 1 recent note -> hard gate rejects & publish triggers `unavailable` (no official fallback)
  const oneNoteCand = makeCandidate({ xhsNotes: [makeNote({ publishedAt: "2026-11-16" }), makeNote({ publishedAt: "2026-10-10" })] });
  const gate1 = passesXhsAndHardGates(oneNoteCand, "2026-11-21");
  assert.equal(gate1.ok, false);
  assert.ok(gate1.reasons.includes("MISSING_MIN_2_RECENT_XHS_NOTES"));

  const avail = evaluatePublishAvailability({
    candidates: [oneNoteCand],
    weekStartDay: "2026-11-21",
    excludedExperienceTypes: ["art_museum_exhibition"],
  });
  assert.equal(avail.canPublish, false);
  assert.equal(avail.recommendedStatus, "unavailable");
  assert.equal(avail.unavailableReason, "insufficient_recent_notes");

  // Two recent low-engagement notes -> marked weak, cannot pass strict primary gate
  const weakCand = makeCandidate({
    xhsNotes: [
      makeNote({ noteId: "w1", publishedAt: "2026-11-15", likes: "12", commentCountText: "2", commentsCaptured: 2 }),
      makeNote({ noteId: "w2", publishedAt: "2026-11-16", likes: "8", commentCountText: "1", commentsCaptured: 1 }),
    ],
  });
  const weakGate = passesXhsAndHardGates(weakCand, "2026-11-21");
  assert.equal(weakGate.signalStrength, "weak");
  assert.equal(weakGate.ok, false);
  assert.ok(weakGate.reasons.includes("WEAK_XHS_ENGAGEMENT_SIGNAL"));
});

test("hard-gates: excluded types, hotel <=1000 without Sheraton/fabricated ranges, OSS media, root URL downgrade, totalTripBudget===null", () => {
  // Art exhibition blocked regardless of alias (`art_exhibition` vs `art_museum_exhibition`)
  assert.equal(matchesExcludedExperienceType({ experienceType: "art_exhibition", title: "周末看展" }, ["art_museum_exhibition"]).excluded, true);
  assert.equal(matchesExcludedExperienceType({ experienceType: "art_museum_exhibition", title: "城市漫步" }, ["art_exhibition"]).excluded, true);

  // Overnight hotel > 1000 or Sheraton primary rejected
  const overBudget = makeCandidate({
    isOvernight: true,
    driveMinutesMax: 135,
    strippedSatAfternoonHours: 3,
    strippedSunMorningHours: 3,
    hotelOptions: [{ name: "某高价酒店", soldOut: false, liveRatesCny: { king2Breakfast: 1040 }, capturedAt: "2026-11-17T00:00:00Z", bookingUrl: "https://hotels.ctrip.com/hotels/detail/?hotelId=1" }],
  });
  assert.ok(passesXhsAndHardGates(overBudget, "2026-11-21").reasons.includes("NO_AFFORDABLE_HOTEL_UNDER_1000"));

  const sheratonPrimary = makeCandidate({
    isOvernight: true,
    driveMinutesMax: 135,
    strippedSatAfternoonHours: 3,
    strippedSunMorningHours: 3,
    hotelOptions: [{ name: "上海外高桥喜来登酒店", soldOut: false, liveRatesCny: { king2Breakfast: 731 }, capturedAt: "2026-11-17T00:00:00Z", bookingUrl: "https://hotels.ctrip.com/hotels/detail/?hotelId=426531" }],
  });
  assert.ok(passesXhsAndHardGates(sheratonPrimary, "2026-11-21").reasons.includes("DISLIKED_HOTEL_BRAND_AS_PRIMARY"));

  // OSS media validation
  assert.equal(validateOssMediaPath("/api/weekend-media/web/atour-metro-ext.jpg"), true);
  assert.equal(validateOssMediaPath("https://sns-webpic-qc.xhscdn.com/foo.jpg"), false);
  assert.equal(validateOssMediaPath("./assets/foo.jpg"), false);
  assert.equal(validateOssMediaPath("https://pub-xxx.r2.dev/foo.jpg"), false);

  // Root homepage URL downgrade
  assert.equal(isRootHomepageUrl("https://hangzhou.gov.cn/"), true);
  assert.equal(isRootHomepageUrl("https://www.xiaohongshu.com/explore"), true);
  assert.equal(isRootHomepageUrl("http://www.xzhfjq.com/line/list.html"), false);
  const cleaned = sanitizeSourcesDetailUrls([
    { title: "杭州官网", url: "https://www.hangzhou.gov.cn/", sourceType: "official_site", verificationStatus: "verified" },
    { title: "下渚湖线路", url: "http://www.xzhfjq.com/line/list.html", sourceType: "official_site", verificationStatus: "verified" },
  ]);
  assert.equal(cleaned[0].verificationStatus, "unconfirmed");
  assert.equal(cleaned[1].verificationStatus, "verified");

  // Non-null totalTripBudget blocked
  const badBudget = makeCandidate({ totalTripBudget: 1500 });
  assert.ok(passesXhsAndHardGates(badBudget, "2026-11-21").reasons.includes("TOTAL_TRIP_BUDGET_NOT_NULL"));
});

test("sources-weather: parses hour3data, enforces <title> city match, 6h cache, Friday wttr.in/QWeather, and disables open-meteo", async (t) => {
  assert.equal(WEATHER_STATIONS["101210204"].city, "德清");
  assert.equal(WEATHER_STATIONS["101210102"].city, "萧山");
  assert.equal(WEATHER_STATIONS["101210107"].city, "临安");
  assert.equal(WEATHER_STATIONS["101210101"].city, "杭州");
  assert.equal(WEATHER_STATIONS["101020100"].city, "上海");
  assert.equal(WEATHER_STATIONS["101020600"].city, "浦东");

  // City mismatch throws (e.g. Changxing title returned for Deqing code)
  assert.throws(
    () => parseWeatherComCnHtml(
      "<title>长兴天气预报,长兴7天天气预报</title><script>var hour3data={\"7d\":[[\"21日14时,d00,晴,15℃,北风,<3级,3\"]]};</script>",
      { code: "101210204", expectedCity: "德清", anchorYmd: "2026-11-17" },
    ),
    /WEATHER_CITY_MISMATCH/,
  );

  // Month rollover + hour3 parsing
  const rolloverParsed = parseWeatherComCnHtml(
    "<title>德清天气预报</title><script>var hour3data={\"7d\":[[\"30日14时,d00,晴,14℃,北风,<3级,3\"],[\"01日14时,d01,多云,12℃,东风,<3级,3\"]]};</script>",
    { code: "101210204", expectedCity: "德清", anchorYmd: "2026-11-29" },
  );
  assert.equal(rolloverParsed.hour3Segments["2026-11-30"][0].condition, "晴");
  assert.equal(rolloverParsed.hour3Segments["2026-12-01"][0].condition, "多云");

  const slots = buildProposalWeatherSlots(rolloverParsed, [
    { date: "2026-11-30", startHour: 11, endHour: 17, slotLabel: "周日午后" },
  ]);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].tempRangeC, "14℃");

  // 6h cache + Friday wttr.in calibration + open-meteo disabled
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nianlife-weather-test-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  let fetchCalls = 0;
  const mockFetch = async (url) => {
    fetchCalls += 1;
    if (url.includes("weather.com.cn")) {
      const code = url.match(/\/(\d+)\.shtml/)[1];
      const city = WEATHER_STATIONS[code].titleMustInclude;
      const html = `<title>${city}天气预报</title><script>var hour3data={"7d":[["21日11时,d00,晴,13℃,北风,<3级,3"],["21日14时,d00,晴,16℃,北风,<3级,3"],["22日14时,d01,多云,15℃,东风,<3级,3"]]};</script>`;
      return { ok: true, status: 200, text: async () => html };
    }
    if (url.includes("wttr.in")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          weather: [
            { date: "2026-11-21", hourly: [{ time: "1200", tempC: "16", chanceofrain: "10", precipMM: "0.0", weatherDesc: [{ value: "Sunny" }] }] },
            { date: "2026-11-22", hourly: [{ time: "1200", tempC: "15", chanceofrain: "20", precipMM: "0.0", weatherDesc: [{ value: "Cloudy" }] }] },
          ],
        }),
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const t0 = Date.parse("2026-11-18T12:00:00+08:00");
  const first = await fetchWeatherComCnCity("101210204", { cacheDir: tmpDir, nowMs: t0, fetchImpl: mockFetch });
  assert.equal(first.fromCache, false);
  const second = await fetchWeatherComCnCity("101210204", { cacheDir: tmpDir, nowMs: t0 + 2 * 3600_000, fetchImpl: mockFetch });
  assert.equal(second.fromCache, true);
  assert.equal(fetchCalls, 1);
  const third = await fetchWeatherComCnCity("101210204", { cacheDir: tmpDir, nowMs: t0 + 7 * 3600_000, fetchImpl: mockFetch });
  assert.equal(third.fromCache, false);
  assert.equal(fetchCalls, 2);

  // Midweek without QWeather/Friday -> precipProbabilityPct is strictly null
  const midweekBundle = await fetchWeekendWeatherBundle({
    satDay: "2026-11-21",
    sunDay: "2026-11-22",
    stationCodes: ["101210204"],
    isFridayRefresh: false,
    cacheDir: tmpDir,
    nowMs: t0 + 7 * 3600_000,
    fetchImpl: mockFetch,
  });
  assert.equal(midweekBundle.precipProbabilityPct, null);
  assert.equal(midweekBundle.precipProbabilityStatus, "unconfirmed");

  // Friday calibration via wttr.in fills estimated precipProbabilityPct
  const fridayBundle = await fetchWeekendWeatherBundle({
    satDay: "2026-11-21",
    sunDay: "2026-11-22",
    stationCodes: ["101210204"],
    isFridayRefresh: true,
    qweatherApiKey: "",
    cacheDir: tmpDir,
    forceRefresh: true,
    nowMs: Date.parse("2026-11-20T17:30:00+08:00"),
    fetchImpl: mockFetch,
  });
  assert.equal(fridayBundle.precipProbabilityPct, 20);
  assert.equal(fridayBundle.precipProbabilityStatus, "estimated");

  // open-meteo explicitly blocked
  await assert.rejects(
    () => import("../scripts/weekend/sources-weather.mjs").then((m) => m.assertAllowedWeatherUrl("https://api.open-meteo.com/v1/forecast")),
    /FORBIDDEN_WEATHER_SOURCE/,
  );
});

test("sources-xhs: Stage 1 open discovery, raw reuse, calibrated circuit breaker stops immediately & writes auth-status.json", async (t) => {
  const s1Keywords = generateStage1OpenKeywords({
    excludedTypes: [
      { experienceType: "art_museum_exhibition", label: "美术馆/艺术展" },
      { experienceType: "rural_farming_harvest", label: "农事采摘" },
    ],
    maxKeywords: 8,
  });
  assert.ok(s1Keywords.length > 0);
  for (const kw of s1Keywords) {
    assert.equal(keywordContainsSpecificPlace(kw), false, `Stage 1 keyword must not name specific place: ${kw}`);
    assert.equal(keywordHitsExcludedTerm(kw, ["art_museum_exhibition", "rural_farming_harvest"]), false, `Stage 1 keyword leaked excluded term: ${kw}`);
  }

  // Stage 2 excludes cooldown venues
  const s2Keywords = generateStage2PlaceKeywords({
    candidatePlaces: [
      { name: "德清下渚湖", experienceType: "wetland_boat_folk_craft" },
      { name: "踩雷景区", experienceType: "lawn_waterfront" },
    ],
    cooldownVenueNames: ["踩雷景区"],
    excludedTypes: ["art_museum_exhibition"],
  });
  assert.equal(s2Keywords.length, 1);
  assert.match(s2Keywords[0], /德清下渚湖/);

  // Carousel `[class*="slider"]` does NOT trigger false positive when bodyText is normal
  assert.equal(detectXhsBlockSignals({ url: "https://www.xiaohongshu.com/explore/123", bodyText: "公园大草坪带娃晒太阳", noteCardCount: 1 }).blocked, false);
  assert.equal(detectXhsBlockSignals({ url: "https://www.xiaohongshu.com/explore/123", bodyText: "请拖动滑块完成验证" }).kind, "xhs_risk_stopped");
  assert.equal(detectXhsBlockSignals({ url: "https://www.xiaohongshu.com/login", bodyText: "" }).kind, "xhs_auth_expired");

  // Simulate raw reuse + captcha circuit breaker halts without retry
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "nianlife-xhs-base-"));
  const tmpOps = fs.mkdtempSync(path.join(os.tmpdir(), "nianlife-xhs-ops-"));
  t.after(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true });
    fs.rmSync(tmpOps, { recursive: true, force: true });
  });

  const oldRawDir = path.join(tmpBase, "raw", "2026-11-14");
  fs.mkdirSync(oldRawDir, { recursive: true });
  fs.writeFileSync(
    path.join(oldRawDir, "note-01-6ade0c83000000002c037eb0.json"),
    JSON.stringify(makeNote({ publishDate: "2026-11-10", within30Days: false, noteUrl: makeNote().url })),
  );
  fs.writeFileSync(
    path.join(oldRawDir, "note-02-deadbeef0000000011112222.json"),
    JSON.stringify(makeNote({ noteId: "deadbeef0000000011112222", publishDate: "2026-10-21", within30Days: true, noteUrl: "https://www.xiaohongshu.com/explore/deadbeef0000000011112222?xsec_token=TOKEN999" })),
  );
  const reused = loadReusableRawNotes({ rawRoot: path.join(tmpBase, "raw"), targetFromDay: "2026-11-21" });
  assert.equal(reused.length, 1);
  assert.equal(reused[0].noteId, "6ade0c83000000002c037eb0");
  assert.equal(reused[0].within30Days, true);

  let gotoCount = 0;
  const mockBrowserFactory = async () => ({
    pages: () => [{
      url: () => "https://www.xiaohongshu.com/search_result",
      goto: async () => { gotoCount += 1; },
      evaluate: async () => ({
        title: "安全验证",
        bodyText: "访问过于频繁，请拖动滑块完成安全验证",
        hasLoginModal: false,
        hasCaptchaIframe: true,
        cards: [],
      }),
      screenshot: async ({ path: p }) => { fs.writeFileSync(p, "PNG"); },
    }],
    close: async () => {},
  });

  const crawlRes = await crawlXhsBatch({
    weekId: "2026-11-21",
    targetFromDay: "2026-11-21",
    todayYmd: "2026-11-17",
    baseDir: tmpBase,
    opsStateDir: tmpOps,
    minDelayMs: 1,
    maxDelayMs: 1,
    sleepImpl: async () => {},
    webhookEnvPath: path.join(tmpOps, "nonexistent-weekend.env"),
    browserFactory: mockBrowserFactory,
  });

  assert.equal(crawlRes.stoppedByRiskOrAuth, true);
  assert.equal(gotoCount, 1, "must halt on first captcha without retrying");
  const authWritten = JSON.parse(fs.readFileSync(path.join(tmpOps, "auth-status.json"), "utf8"));
  assert.equal(authWritten.ok, false);
  assert.equal(authWritten.status, "xhs_risk_stopped");
  assert.equal(crawlRes.webhookResult.sent, false);
  assert.equal(crawlRes.webhookResult.status, "webhook_not_configured");
});

test("sources-official-ota: Ctrip dynamic ages, Atour priority, >1000/soldOut/Sheraton elimination, auth check", () => {
  const urlNov = buildCtripHotelUrl({ hotelId: "113000369", checkIn: "2026-11-21", checkOut: "2026-11-22" });
  assert.match(urlNov, /adult=2&children=1&crn=1&ages=1/);
  const urlJan = buildCtripHotelUrl({ hotelId: "113000369", checkIn: "2027-01-09", checkOut: "2027-01-10" });
  assert.match(urlJan, /ages=2/);

  const atour = parseCtripHotelDetail({
    name: "上海浦东金桥地铁站亚朵酒店",
    hotelId: "113000369",
    lines: [
      "上海浦东新区金湘路268号",
      "4.8",
      "超棒",
      "1,846条点评",
      "公共停车场免费",
      "高级大床房",
      "1张1.8米大床",
      "26平方米",
      "2份早餐",
      "入住当天12:00前可免费取消",
      "¥560",
    ],
  });
  const sheraton = parseCtripHotelDetail({
    name: "上海外高桥喜来登酒店",
    hotelId: "426531",
    lines: ["豪华大床房", "1张1.8米大床", "2份早餐", "¥731"],
  });
  const expensive = parseCtripHotelDetail({
    name: "某超预算酒店",
    hotelId: "999999",
    lines: ["行政大床房", "1张1.8米大床", "2份早餐", "¥1,085"],
  });
  const soldOutHotel = parseCtripHotelDetail({
    name: "某售罄酒店",
    hotelId: "888888",
    lines: ["高级大床房", "2份早餐", "¥450", "售罄"],
  });

  const ranked = selectAndRankHotels([sheraton, expensive, soldOutHotel, atour]);
  assert.equal(ranked.options.length, 1);
  assert.equal(ranked.options[0].name, "上海浦东金桥地铁站亚朵酒店");
  assert.equal(ranked.options[0].minRateWithBreakfastCny, 560);
  assert.equal(ranked.eliminatedOptions.length, 3);
  assert.ok(ranked.eliminatedOptions.some((e) => e.status === "over_budget"));
  assert.ok(ranked.eliminatedOptions.some((e) => e.status === "sold_out"));
  assert.ok(ranked.eliminatedOptions.some((e) => e.name.includes("喜来登") && e.status === "eliminated"));

  assert.equal(detectCtripAuthExpired({ url: "https://passport.ctrip.com/user/login" }).expired, true);
  assert.doesNotMatch(JSON.stringify(atour), /无需婴儿床/);
  assert.doesNotMatch(JSON.stringify(ranked), /无需婴儿床/);
});

test("rank-and-build, Friday refresh preserves selectedProposalId, feedback-tune idempotency & 90d cooldown, trip-hints, and webhook", async (t) => {
  const c1 = makeCandidate({ id: "prop-overnight", title: "上海森兰与巨富长", region: "上海浦东", experienceType: "city_district_market", isOvernight: true, driveMinutesMax: 140, strippedSatAfternoonHours: 3.0, strippedSunMorningHours: 3.0, hotelOptions: [{ name: "上海浦东金桥地铁站亚朵酒店", soldOut: false, liveRatesCny: { superiorKing2Breakfast: 560 }, capturedAt: "2026-11-17T04:00:00Z", bookingUrl: "https://hotels.ctrip.com/hotels/detail/?hotelId=113000369" }] });
  const c2 = makeCandidate({ id: "prop-local", title: "杭州经纬街区", region: "杭州城北", experienceType: "city_creative_street_walk", isOvernight: false, driveMinutesMax: 35, strippedBestHalfDayHours: 3.0 });
  const c3 = makeCandidate({ id: "prop-1h", title: "德清下渚湖", region: "浙江德清", experienceType: "wetland_boat_folk_craft", isOvernight: false, driveMinutesMax: 65, strippedBestHalfDayHours: 3.0 });

  const weatherSummary = {
    testedAt: "2026-11-17T01:00:00Z",
    primarySourceLabel: "中国天气网",
    secondarySourceLabel: "待周五更新",
    precipProbabilityPct: null,
    precipProbabilityStatus: "unconfirmed",
    precipProbabilityNote: "待周五更新",
    horizonConfidence: "medium",
    horizonConfidenceLabel: "周中预报",
    fridayRefreshHint: "全晴",
    cities: [{
      city: "上海浦东",
      code: "101020600",
      sourceUrl: "https://www.weather.com.cn/weather/101020600.shtml",
      daysSummary: [{ date: "2026-11-21", dayLabel: "周六", summary: "晴", wind: "<3级" }],
      hour3Segments: { "2026-11-21": [{ slot: "21日14时", hour: 14, condition: "晴", temp: "13℃", windDir: "北风", windForce: "<3级" }] },
      weekendTip: "晴",
    }],
  };

  const built = buildWeekendSnapshot({
    weekId: "2026-11-21",
    candidates: [c1, c2, c3],
    inspirationPool: [
      {
        id: "insp-strict-expired",
        title: "已满31天过期灵感",
        experienceType: "waterfront_redwoods_greenway",
        image: { src: "/api/weekend-media/web/qingshanhu.jpg" },
        xhsEvidence: [makeNote({ noteId: "old31d", publishedAt: "2026-10-21" })],
      },
      {
        id: "insp-strict-fresh",
        title: "近30天有效灵感",
        experienceType: "waterfront_redwoods_greenway",
        image: { src: "/api/weekend-media/web/qingshanhu.jpg" },
        xhsEvidence: [makeNote({ noteId: "fresh5d", publishedAt: "2026-11-16" })],
      },
    ],
    weatherSummary,
    nowIso: "2026-11-17T08:00:00Z",
    excludedExperienceTypes: [{ experienceType: "art_museum_exhibition", label: "美术馆/艺术展", excludedAt: "2026-11-17T00:10:00.000Z", addedBy: "family_rule" }],
  });
  assert.equal(built.ok, true, built.errors.join("; "));
  assert.equal(built.snapshot.status, "published");
  assert.equal(built.snapshot.proposals.length, 3);
  assert.equal(built.snapshot.inspirationPool.length, 1);
  assert.equal(built.snapshot.inspirationPool[0].id, "insp-strict-fresh");
  assert.doesNotMatch(JSON.stringify(built.snapshot), /无需婴儿床/);
  assert.equal(built.snapshot.familyBaseline.totalTripBudget, null);
  assert.equal(built.snapshot.childProfile.ageOnSaturday, "1 岁 10 个月");

  // Validate hard-gates strictly rejects inspiration notes >30d before weekendRange.from even when <=30d before generatedAt
  const expiredInspSnap = {
    ...built.snapshot,
    generatedAt: "2026-11-17T08:00:00Z",
    inspirationPool: [
      {
        id: "insp-expired-vs-from",
        title: "仅31天前笔记",
        experienceType: "waterfront_redwoods_greenway",
        image: { src: "/api/weekend-media/web/qingshanhu.jpg" },
        xhsEvidence: [makeNote({ noteId: "old31d2", publishedAt: "2026-10-21" })],
      },
    ],
  };
  const expiredGate = validateSnapshotHardGates(expiredInspSnap);
  assert.equal(expiredGate.ok, false);
  assert.ok(expiredGate.errors.includes("inspiration[insp-expired-vs-from]:NO_RECENT_XHS_EVIDENCE"));

  // Friday refresh MUST NOT reorder or override selectedProposalId
  const orderBefore = built.snapshot.proposals.map((p) => p.id);
  const refreshed = applyFridayRefresh({
    snapshot: built.snapshot,
    weatherBundle: {
      ...weatherSummary,
      precipProbabilityPct: 35,
      precipProbabilityStatus: "estimated",
      cities: [{
        ...weatherSummary.cities[0],
        daysSummary: [{ date: "2026-11-21", dayLabel: "周六", summary: "小雨", wind: "4级", hasRainInDaytime: true }],
      }],
    },
    state: { selectedProposalId: orderBefore[1], selectedDeparture: "sat_afternoon" },
  });
  assert.deepEqual(refreshed.proposals.map((p) => p.id), orderBefore);
  assert.equal(refreshed.fridayAlert.keepsSelectedProposal, true);
  assert.equal(refreshed.fridayAlert.severity, "adjust");

  // Feedback tuning idempotency + 90d pitfall cooldown + stayed_home zero deduction + trip hints
  const w0 = defaultPreferenceWeights();
  const cd0 = defaultCooldownPool();
  const statePitfall = {
    selectedProposalId: "prop-local",
    selectedDeparture: "sat_morning",
    sundayFeedback: { outcome: "went_pitfall", tags: ["人太多排队", "跑一趟只吃饭"], submittedAt: "2026-11-22T12:30:00Z", proposalId: "prop-local" },
  };
  const t1 = applyFeedbackAndExclusions({ weekId: "2026-11-21", state: statePitfall, proposalMeta: c2, weights: w0, cooldown: cd0 });
  assert.equal(t1.appliedFeedback, true);
  assert.equal(t1.weights.minStrippedContentHours, 3.0);
  assert.equal(isVenueInCooldown("杭州经纬街区", t1.cooldown, "2026-12-20").active, true);
  assert.equal(isVenueInCooldown("杭州经纬街区", t1.cooldown, "2027-03-01").active, false);

  // Re-running with same submittedAt MUST be idempotent
  const t2 = applyFeedbackAndExclusions({ weekId: "2026-11-21", state: statePitfall, proposalMeta: c2, weights: t1.weights, cooldown: t1.cooldown });
  assert.equal(t2.appliedFeedback, false);
  assert.equal(t2.reason, "already_processed_idempotent");
  assert.equal(t2.weights.minStrippedContentHours, 3.0);
  assert.equal(t2.cooldown.venues.length, 1);

  // stayed_home never deducts content scores
  const stayedRes = applyFeedbackAndExclusions({
    weekId: "2026-11-28",
    state: { sundayFeedback: { outcome: "stayed_home", tags: ["孩子/大人疲惫"], submittedAt: "2026-11-29T12:30:00Z", proposalId: null } },
    weights: t1.weights,
    cooldown: t1.cooldown,
  });
  assert.deepEqual(stayedRes.weights.hypotheses, t1.weights.hypotheses);

  // went_tired tightens walkCapKm to 0.8
  const tiredRes = applyFeedbackAndExclusions({
    weekId: "2026-12-05",
    state: { sundayFeedback: { outcome: "went_tired", tags: ["步行太多"], submittedAt: "2026-12-06T12:30:00Z", proposalId: "prop-1h" } },
    proposalMeta: c3,
    weights: w0,
    cooldown: cd0,
  });
  assert.equal(tiredRes.weights.walkCapKm, 0.8);

  // Candidate trip hint never modifies trips.json and loads cleanly for codex-editor prepare
  const tmpOps = fs.mkdtempSync(path.join(os.tmpdir(), "nianlife-hints-"));
  t.after(() => fs.rmSync(tmpOps, { recursive: true, force: true }));
  const hintWrite = writeCandidateTripHint({
    weekId: "2026-11-21",
    snapshot: built.snapshot,
    state: { selectedProposalId: "prop-1h", selectedDeparture: "sat_morning", sundayFeedback: { outcome: "went_loved", tags: ["不挤舒服"], submittedAt: "2026-11-22T12:40:00Z", proposalId: "prop-1h" } },
    opsStateDir: tmpOps,
  });
  assert.equal(hintWrite.created, true);
  assert.equal(hintWrite.hint.autoMutateTripsJson, false);
  const overlapping = loadOverlappingTripHints({ fromDay: "2026-11-15", throughDay: "2026-11-23", opsStateDir: tmpOps });
  assert.equal(overlapping.length, 1);

  // Webhook unconfigured returns honest result
  const whUnconf = await sendWeekendWebhook({ title: "t", message: "m" }, { envPath: path.join(tmpOps, "missing.env"), env: {} });
  assert.deepEqual({ sent: whUnconf.sent, status: whUnconf.status }, { sent: false, status: "webhook_not_configured" });
});

test("run-weekly: target week resolution and offline unavailable build-and-publish flow", async (t) => {
  assert.equal(resolveTargetWeekId("collect-init", "2026-11-16"), "2026-11-21");
  assert.equal(resolveTargetWeekId("build-and-publish", "2026-11-18"), "2026-11-21");
  assert.equal(resolveTargetWeekId("sync-feedback", "2026-11-22"), "2026-11-21");

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "nianlife-rw-base-"));
  const tmpOps = fs.mkdtempSync(path.join(os.tmpdir(), "nianlife-rw-ops-"));
  t.after(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true });
    fs.rmSync(tmpOps, { recursive: true, force: true });
  });

  // No XHS notes collected -> offline build-and-publish emits status="unavailable"
  const pubRes = await runWeeklyStage("build-and-publish", {
    weekId: "2026-11-21",
    today: "2026-11-18",
    baseDir: tmpBase,
    opsStateDir: tmpOps,
    offline: true,
    noDeploy: true,
    pcOffline: true,
  });
  assert.equal(pubRes.ok, true);
  assert.equal(pubRes.status, "unavailable");
  const snap = JSON.parse(fs.readFileSync(pubRes.snapshotPath, "utf8"));
  assert.equal(snap.status, "unavailable");
  assert.equal(snap.proposals.length, 0);
  assert.equal(snap.unavailableNotice.reason, "pc_offline_mon_to_wed");
});

test("infra contracts: Caddyfile.ecs C1, ecs-swap.sh C2, deploy-ecs-public.sh python3 check, and scheduled tasks receipt", () => {
  const caddy = fs.readFileSync(path.join(V2_ROOT, "Caddyfile.ecs"), "utf8");
  assert.match(caddy, /@weekendWrite\s*\{[\s\S]*method POST[\s\S]*path \/api\/weekend-state/);

  const swapSh = fs.readFileSync(path.join(V2_ROOT, "scripts", "ecs-swap.sh"), "utf8");
  assert.match(swapSh, /WEEKEND_STATE_RW="\/srv\/nianlife-content\/weekend\/state"/);
  assert.match(swapSh, /weekend_writers/);
  assert.match(swapSh, /stat -c '%u' "\$WEEKEND_STATE_RW".*"1001"/);

  const deploySh = fs.readFileSync(path.join(V2_ROOT, "scripts", "deploy-ecs-public.sh"), "utf8");
  assert.match(deploySh, /weekend-install\)/);
  assert.match(deploySh, /weekend-rollback\)/);
  assert.match(deploySh, /WEEKEND_STATE_MOUNT/);

  const dockerignore = fs.readFileSync(path.join(V2_ROOT, ".dockerignore"), "utf8");
  assert.match(dockerignore, /^\/media-manifest\.json$/m);
  assert.doesNotMatch(dockerignore, /^media-manifest\.json$/m);

  const gitignore = fs.readFileSync(path.join(V2_ROOT, ".gitignore"), "utf8");
  assert.match(gitignore, /^\/media-manifest\.json\r?$/m);
  assert.doesNotMatch(gitignore, /^media-manifest\.json\r?$/m);
  if (fs.existsSync(path.join(V2_ROOT, "..", ".git"))) {
    const chkLib = spawnSync("git", ["check-ignore", "lib/weekend/media-manifest.json"], { cwd: V2_ROOT, encoding: "utf8" });
    assert.notEqual(chkLib.status, 0, "lib/weekend/media-manifest.json must NOT be gitignored");
    const chkRoot = spawnSync("git", ["check-ignore", "media-manifest.json"], { cwd: V2_ROOT, encoding: "utf8" });
    assert.equal(chkRoot.status, 0, "v2/media-manifest.json root artifact should remain gitignored");
  }

  // Extract python3 validator from deploy-ecs-public.sh and verify it accepts fixture & rejects bad snapshots
  const pyMatch = deploySh.match(/python3 - "\$tmp" "\$week_id" <<'PYEOF'\n([\s\S]*?)\nPYEOF/);
  assert.ok(pyMatch, "python3 strict validator missing in deploy-ecs-public.sh");
  const fixturePath = path.join(V2_ROOT, "test", "fixtures", "weekend-2026-11-21.json");
  const goodPy = spawnSync("python", ["-", fixturePath, "2026-11-21"], { input: pyMatch[1], encoding: "utf8" });
  assert.equal(goodPy.status, 0, goodPy.stderr || goodPy.stdout);

  // Ensure python3 validator strictly checks 30 days relative to weekendRange.from (not generatedAt)
  const tmpBadSnap = path.join(os.tmpdir(), `nianlife-bad-30d-${process.pid}.json`);
  const fixtureClone = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  fixtureClone.generatedAt = "2026-11-17T08:00:00Z";
  if (Array.isArray(fixtureClone.inspirationPool) && fixtureClone.inspirationPool[0]) {
    fixtureClone.inspirationPool[0].xhsEvidence = [makeNote({ noteId: "old31d3", publishedAt: "2026-10-21" })];
  }
  fs.writeFileSync(tmpBadSnap, JSON.stringify(fixtureClone));
  try {
    const badPy = spawnSync("python", ["-", tmpBadSnap, "2026-11-21"], { input: pyMatch[1], encoding: "utf8" });
    assert.notEqual(badPy.status, 0, "python3 validator must reject inspiration note >30d from weekendRange.from");
  } finally {
    fs.rmSync(tmpBadSnap, { force: true });
  }

  const receiptPath = "C:/Users/teddy/NianlifeOps/ops-daily/state/weekend/scheduled-tasks-receipt.json";
  assert.equal(fs.existsSync(receiptPath), true);
  const receipt = JSON.parse(fs.readFileSync(receiptPath.replace(/^\uFEFF/, ""), "utf8").replace(/^\uFEFF/, ""));
  assert.equal(receipt.tasks.length, 5);
  assert.equal(receipt.sidecarExists, true);
});

test("editorial curation order, visited-places spot aliasing, XHS card selection, and idempotent publish", async (t) => {
  // 1. normalizeXhsCardHref + selectSearchCardsToOpen
  const norm = normalizeXhsCardHref("https://www.xiaohongshu.com/search_result/6af6fa50000000002a00e5fe?xsec_token=ABC123&xsec_source=");
  assert.equal(norm, "https://www.xiaohongshu.com/explore/6af6fa50000000002a00e5fe?xsec_token=ABC123&xsec_source=pc_search");

  const cardSel = selectSearchCardsToOpen({
    cards: [
      { href: "/search_result/old111?xsec_token=T1", cardText: "杭州 08-29 逛市集", likesText: "500" },
      { href: "/search_result/art222?xsec_token=T2", cardText: "周末美术馆看展攻略", likesText: "300" },
      { href: "/search_result/seen333?xsec_token=T3", cardText: "11月15日 周末公园推车", likesText: "200" },
      { href: "/search_result/good444?xsec_token=T4", cardText: "11.21实拍 推车平路市集停车免费", likesText: "80" },
    ],
    seenNoteIds: new Set(["seen333"]),
    excludedTypes: ["art_museum_exhibition"],
    targetFromDay: "2026-11-21",
    todayYmd: "2026-11-17",
    maxToOpen: 4,
  });
  assert.equal(cardSel.selected.length, 1);
  assert.equal(cardSel.selected[0].noteId, "good444");
  assert.equal(cardSel.skipped.outside30DaysCard.length, 1);
  assert.equal(cardSel.skipped.excludedType.length, 1);
  assert.equal(cardSel.skipped.alreadyCollected.length, 1);

  // 2. Spot-level visited check (city visited != all spots visited)
  const tmpOps = fs.mkdtempSync(path.join(os.tmpdir(), "nianlife-vis-test-"));
  t.after(() => fs.rmSync(tmpOps, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(tmpOps, "visited-places.json"),
    JSON.stringify({
      schema: "nianlife.weekend-visited-places/1",
      spots: [{ canonicalSpot: "德清下渚湖湿地公园", city: "德清", aliases: ["下渚湖", "下渚湖湿地"], sourceKind: "teddy", sourceRef: "chat" }],
    }),
  );
  const visitedCtx = loadVisitedPlacesContext({ opsStateDir: tmpOps });
  assert.equal(checkCandidateVisitedSpot({ title: "下渚湖湿地船游" }, visitedCtx).visited, true);
  assert.equal(checkCandidateVisitedSpot({ title: "德清莫干山新市古镇漫步" }, visitedCtx).visited, true); // 莫干山 from trips.json
  assert.equal(checkCandidateVisitedSpot({ title: "上海长宁上生新所漫步" }, visitedCtx).visited, false); // Shanghai city visited != all spots

  // 3. Editorial order is NOT overturned by scoreCandidate regex weights
  const ed1 = makeCandidate({ id: "ed-1", title: "杭州经纬创意园", experienceType: "city_block_walk", editorialCurated: true, editorialOrder: 1 });
  const ed2 = makeCandidate({ id: "ed-2", title: "德清摇橹船湿地", experienceType: "wetland_boat_folk_craft", editorialCurated: true, editorialOrder: 2 });
  const picked = selectOrthogonalProposals([
    { candidate: ed2, score: 999, gate: { signalStrength: "strong" } },
    { candidate: ed1, score: 10, gate: { signalStrength: "strong" } },
  ]);
  assert.equal(picked[0].candidate.id, "ed-1");
  assert.equal(picked[1].candidate.id, "ed-2");

  // 4. Stale week candidates rejected & idempotent skip on same curatedAt
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "nianlife-ed-base-"));
  const tmpOps2 = fs.mkdtempSync(path.join(os.tmpdir(), "nianlife-ed-ops-"));
  t.after(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true });
    fs.rmSync(tmpOps2, { recursive: true, force: true });
  });
  const candDir = path.join(tmpOps2, "candidates");
  fs.mkdirSync(candDir, { recursive: true });
  fs.writeFileSync(
    path.join(candDir, "2026-11-28.json"),
    JSON.stringify({ weekId: "2026-11-21", editorialCurated: true, candidates: [ed1] }),
  );
  const staleRes = await runWeeklyStage("build-and-publish", {
    weekId: "2026-11-28",
    today: "2026-11-25",
    baseDir: tmpBase,
    opsStateDir: tmpOps2,
    offline: true,
    noDeploy: true,
  });
  assert.equal(staleRes.status, "unavailable");

  // 5. Isolated future-week collect-init -> editorial curation -> verify-deep preservation -> build-and-publish
  const futureWeek = "2099-01-04";
  const cacheDir = path.join(tmpOps2, "cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(
    path.join(cacheDir, `weather-bundle-${futureWeek}.json`),
    JSON.stringify({
      testedAt: "2099-01-01T10:00:00Z",
      horizonConfidenceLabel: "测试全晴",
      cities: [{ city: "余杭", code: "101210106", sourceUrl: "https://www.weather.com.cn/weather/101210106.shtml", daysSummary: [], hour3Segments: {}, weekendTip: "全晴" }],
    }),
  );
  const initRes = await runWeeklyStage("collect-init", {
    weekId: futureWeek,
    today: "2099-01-01",
    baseDir: tmpBase,
    opsStateDir: tmpOps2,
    offline: true,
  });
  assert.equal(initRes.ok, true);
  const initDoc = JSON.parse(fs.readFileSync(path.join(candDir, `${futureWeek}.json`), "utf8"));
  assert.equal(initDoc.editorialStatus, "pending_session_review");
  assert.equal(initDoc.editorialCurated, false);

  const isoEd = makeCandidate({
    id: "2099-01-04-liangzhu-test",
    title: "良渚古城鹿苑与芦苇",
    experienceType: "heritage_park_deer_market",
    editorialCurated: true,
    editorialOrder: 1,
    xhsNotes: [
      makeNote({ noteId: "n2099a", publishedAt: "2098-12-20", likes: "180", commentsCaptured: 15 }),
      makeNote({ noteId: "n2099b", publishedAt: "2098-12-28", likes: "65", commentsCaptured: 12 }),
    ],
  });
  fs.writeFileSync(
    path.join(candDir, `${futureWeek}.json`),
    JSON.stringify({
      schema: "nianlife.weekend-candidates/1",
      weekId: futureWeek,
      editorialCurated: true,
      editorialStatus: "curated_ready",
      curatedAt: "2099-01-01T20:00:00Z",
      candidates: [isoEd],
      inspirationPool: [],
      noGoAlerts: [],
    }),
  );

  // verify-deep must preserve curated candidates without overwriting
  const verifyKeep = await runWeeklyStage("verify-deep", {
    weekId: futureWeek,
    today: "2099-01-01",
    baseDir: tmpBase,
    opsStateDir: tmpOps2,
    offline: true,
  });
  assert.equal(verifyKeep.skipped, true);
  assert.equal(verifyKeep.reason, "already_editorial_curated");

  const pubRes = await runWeeklyStage("build-and-publish", {
    weekId: futureWeek,
    today: "2099-01-01",
    baseDir: tmpBase,
    opsStateDir: tmpOps2,
    offline: true,
    noDeploy: true,
  });
  assert.equal(pubRes.ok, true);
  assert.equal(pubRes.status, "published");
  const builtSnap = JSON.parse(fs.readFileSync(pubRes.snapshotPath, "utf8"));
  assert.equal(builtSnap.crawlAudit.editorialSelectionMode, "editorial_curated");
  assert.equal(builtSnap.proposals[0].id, "2099-01-04-liangzhu-test");
});
