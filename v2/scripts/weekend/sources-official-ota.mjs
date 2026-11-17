// Official detail page verification + Ctrip logged-in hotel pricing & filtering.
// Fixed party: 1 room, 2 adults + 1 child (ages dynamically computed via ageOn / ageBetween).
// Prioritizes Atour standardized king rooms (1.8m+), rejects Sheraton, eliminates >1000 RMB / soldOut,
// never invents price ranges, and downgrades root homepage URLs to `unconfirmed`.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { assertOutsideRepository } from "../lib/repo-containment.mjs";
import {
  CHILD_BIRTH_DAY,
  HOTEL_HARD_CAP_RMB,
  computeChildAgeOn,
  isRootHomepageUrl,
  sanitizeSourcesDetailUrls,
} from "./hard-gates.mjs";
import { writeAuthStatusFile, DEFAULT_WEEKEND_BASE_DIR, DEFAULT_OPS_WEEKEND_STATE_DIR } from "./sources-xhs.mjs";
import { sendWeekendWebhook } from "./notify-webhook.mjs";

const REPO_LITERAL = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const REPO = { literal: REPO_LITERAL, real: fs.realpathSync.native(REPO_LITERAL) };
const V2_PKG = fileURLToPath(new URL("../../package.json", import.meta.url));
const require = createRequire(V2_PKG);

export function buildCtripHotelUrl({
  hotelId,
  cityId = 2,
  cityEnName = "Shanghai",
  checkIn,
  checkOut,
  birthDay = CHILD_BIRTH_DAY,
}) {
  const age = computeChildAgeOn(checkIn, birthDay);
  const params = new URLSearchParams({
    cityEnName,
    cityId: String(cityId),
    hotelId: String(hotelId),
    checkIn,
    checkOut,
    adult: "2",
    children: "1",
    crn: "1",
    ages: String(age.yearsInt),
    curr: "CNY",
    barcurr: "CNY",
  });
  return `https://hotels.ctrip.com/hotels/detail/?${params.toString()}`;
}

export function buildCtripSearchCondition({ checkIn, checkOut, birthDay = CHILD_BIRTH_DAY }) {
  const age = computeChildAgeOn(checkIn, birthDay);
  return {
    checkIn,
    checkOut,
    rooms: 1,
    adults: 2,
    children: 1,
    childAgeParam: String(age.yearsInt),
    childAgeLabel: age.ageLabel,
    description: `入住 ${checkIn} · 退房 ${checkOut} · 1 间 · 2 成人 + 1 儿童（${age.ageLabel}，参数 ages=${age.yearsInt}）`,
  };
}

export function detectCtripAuthExpired({ url = "", bodyText = "" } = {}) {
  const lower = String(url).toLowerCase();
  if (/passport\.ctrip\.com|\/user\/login|\/member\/login/i.test(lower)) {
    return { expired: true, reason: "携程已跳转登录页，需重新扫码登录" };
  }
  if (/请登录|扫码登录|账号密码登录/.test(bodyText) && !/¥\s*\d+/.test(bodyText) && !/预订/.test(bodyText)) {
    return { expired: true, reason: "携程页面要求登录且无房态价格，需重新扫码登录" };
  }
  return { expired: false, reason: null };
}

/**
 * Parses captured Ctrip detail page text lines into structured room/rate/policy records.
 */
export function parseCtripHotelDetail({
  name = "",
  hotelId = "",
  url = "",
  lines = [],
  roomPopupLines = [],
  capturedAt = new Date().toISOString(),
  districtArea = "",
} = {}) {
  const joined = lines.join("\n");
  const isAtour = /亚朵|atour/i.test(name);
  const isSheraton = /喜来登|sheraton/i.test(name);
  const soldOutAll = /本酒店.*已订完|当前日期.*售罄|全部房型.*已满/i.test(joined);

  const ratingMatch = joined.match(/(\d\.\d)\s*(?:超棒|很好|棒|不错)?\s*\n[^\n]*?(?:[\d,]+)\s*条点评/);
  const rating = ratingMatch ? `${ratingMatch[1]}（${ratingMatch[0].match(/[\d,]+\s*条点评/)?.[0] ?? ""}）` : "评分待确认";

  const parkingFree = /公共停车场免费|免费停车/.test(joined);
  const parkingPaid = joined.match(/停车场[^。\n]*每小时\s*¥?\s*\d+|停车收费[^。\n]*/);
  const parkingPolicy = parkingFree
    ? "公共停车场免费"
    : parkingPaid
      ? parkingPaid[0]
      : /停车场/.test(joined)
        ? "标注「停车场」（收费标准待确认）"
        : "停车信息待确认";
  const parkingStatus = parkingFree || Boolean(parkingPaid) ? "verified" : "unconfirmed";

  const poolSummary = /室内泳池/.test(joined) ? "有室内泳池" : "无泳池";
  const cancelMatch = joined.match(/入住当天\s*\d{1,2}:\d{2}\s*前可?免费取消|\d{4}-\d{2}-\d{2}\s*\d{1,2}:\d{2}\s*前免费取消/);
  const freeCancellationDeadline = cancelMatch?.[0] ?? "退改政策以订单页为准（待确认）";

  // Parse king bed rooms + breakfast prices from sequential lines
  const roomOffers = [];
  let currentRoom = "";
  let currentBed = "";
  let currentArea = "";
  let pendingBreakfast = null;
  let pendingCancel = "";

  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] ?? "").trim();
    if (!line) continue;

    if (/(大床房|庭院大床|家庭房|双床房|套房)/.test(line) && line.length <= 40 && !/查看|筛选|展开|隐藏/.test(line)) {
      currentRoom = line;
      currentBed = "";
      currentArea = "";
    } else if (/(\d+(?:\.\d+)?)\s*米.*床/.test(line)) {
      currentBed = line;
    } else if (/(\d+(?:–|-)?\d*)\s*平方米/.test(line)) {
      currentArea = line.match(/(\d+(?:–|-)?\d*)\s*平方米/)?.[0] ?? "";
    } else if (/^(2份早餐|1份早餐|无早餐|含双早|含单早)$/.test(line)) {
      pendingBreakfast = line.includes("2") || line.includes("双") ? 2 : line.includes("1") || line.includes("单") ? 1 : 0;
    } else if (/免费取消/.test(line)) {
      pendingCancel = line;
    } else if (/^¥\s*([\d,]+)$/.test(line) && currentRoom && pendingBreakfast !== null) {
      const price = Number(line.replace(/[^\d]/g, ""));
      const nextLine = String(lines[i + 1] ?? "").trim();
      const isSoldOutOffer = nextLine === "售罄";
      if (Number.isFinite(price) && price > 0) {
        roomOffers.push({
          room: currentRoom,
          bed: currentBed,
          area: currentArea,
          breakfastCount: pendingBreakfast,
          priceCny: price,
          cancelText: pendingCancel || freeCancellationDeadline,
          soldOut: isSoldOutOffer,
        });
      }
      pendingBreakfast = null;
    }
  }

  const kingOffers = roomOffers.filter((o) => !o.soldOut && !/双床/.test(o.room) && (!o.bed || /1\.8|2(?:\.0)?米/.test(o.bed) || /大床/.test(o.room)));
  const breakfastOffers = kingOffers.filter((o) => o.breakfastCount >= 1);
  const twoBreakfastOffers = kingOffers.filter((o) => o.breakfastCount >= 2);
  const bestWithBreakfast = (twoBreakfastOffers.length > 0 ? twoBreakfastOffers : breakfastOffers).sort(
    (a, b) => a.priceCny - b.priceCny,
  )[0] ?? null;
  const minKingRate = kingOffers.length > 0 ? Math.min(...kingOffers.map((o) => o.priceCny)) : null;

  // Fallback price scan if DOM layout omitted explicit breakfast rows
  const fallbackMatch = joined.match(/¥\s*([\d,]+)/);
  const fallbackPrice = fallbackMatch ? Number(fallbackMatch[1].replace(/,/g, "")) : null;
  const effectiveBreakfastPrice = bestWithBreakfast?.priceCny ?? minKingRate ?? fallbackPrice;

  const isOverBudget = effectiveBreakfastPrice !== null && effectiveBreakfastPrice > HOTEL_HARD_CAP_RMB;
  const isSoldOut = soldOutAll || (roomOffers.length > 0 && roomOffers.every((o) => o.soldOut));

  const addressMatch = lines.find((l) => /(?:区|路|号|街|道).*?(?:\d+号|弄)/.test(l) && l.length < 80);
  const address = addressMatch ? addressMatch.replace(/显示地图$/, "").trim() : "地址待确认";

  const rateObj = {};
  if (bestWithBreakfast) {
    if (bestWithBreakfast.breakfastCount >= 2) rateObj.recommended2Breakfast = bestWithBreakfast.priceCny;
    else rateObj.recommended1Breakfast = bestWithBreakfast.priceCny;
  }
  const noBkOffer = kingOffers.filter((o) => o.breakfastCount === 0).sort((a, b) => a.priceCny - b.priceCny)[0];
  if (noBkOffer) rateObj.kingNoBreakfast = noBkOffer.priceCny;
  if (effectiveBreakfastPrice !== null && Object.keys(rateObj).length === 0) {
    rateObj.lowestObservedRate = effectiveBreakfastPrice;
  }
  rateObj.note = bestWithBreakfast
    ? `${bestWithBreakfast.room}（${bestWithBreakfast.breakfastCount} 早）¥${bestWithBreakfast.priceCny}`
    : effectiveBreakfastPrice !== null
      ? `实查最低房费 ¥${effectiveBreakfastPrice}`
      : "未获取到实时报价（待确认）";

  return {
    name,
    hotelId: String(hotelId),
    isAtour,
    isSheraton,
    soldOut: isSoldOut,
    overBudget: isOverBudget,
    minRateWithBreakfastCny: effectiveBreakfastPrice,
    districtArea,
    address,
    rating,
    recommendedRoom: bestWithBreakfast
      ? `${bestWithBreakfast.room}${bestWithBreakfast.area ? `（${bestWithBreakfast.area}${bestWithBreakfast.bed ? ` · ${bestWithBreakfast.bed}` : ""}）` : ""}`
      : "1.8m+ 大床房（具体房型待确认）",
    bedSpec: bestWithBreakfast?.bed || "1.8m+ 大床",
    liveRatesCny: rateObj,
    freeCancellationDeadline,
    childAndCribPolicy: /1\.2m.*免费|儿童早餐免费/i.test(joined)
      ? "现有 1.8m+ 大床可同睡，部分儿童早餐政策按现场/详单为准"
      : "现有 1.8m+ 大床可同睡；儿童早餐政策以酒店现场为准",
    poolSummary,
    poolStatus: "verified",
    parkingPolicy,
    parkingStatus,
    capturedAt,
    verificationStatus: effectiveBreakfastPrice !== null ? "verified" : "unconfirmed",
    bookingUrl: url || (hotelId ? buildCtripHotelUrl({ hotelId, checkIn: "2026-11-21", checkOut: "2026-11-22" }) : ""),
    roomOffersCount: roomOffers.length,
    popupHasNoCribNote: roomPopupLines.some((l) => /不提供加婴儿床/.test(l)),
  };
}

/**
 * Filters and ranks parsed Ctrip hotel options:
 * - Eliminates soldOut, >1000 RMB, and disliked Sheraton brand
 * - Prioritizes Atour standardized 1.8m+ king rooms
 */
export function selectAndRankHotels(parsedHotels = []) {
  const withinBudgetOptions = [];
  const eliminatedOptions = [];

  for (const h of parsedHotels) {
    if (!h || typeof h !== "object") continue;
    if (h.soldOut) {
      eliminatedOptions.push({
        name: h.name,
        status: "sold_out",
        priceFound: "已售罄",
        reason: "目标周末已售罄",
      });
      continue;
    }
    if (h.isSheraton) {
      eliminatedOptions.push({
        name: h.name,
        status: "eliminated",
        priceFound: h.minRateWithBreakfastCny ? `¥${h.minRateWithBreakfastCny}` : "待确认",
        reason: "不符合家庭住宿偏好（不喜欢喜来登，优先亚朵标准化大床）",
      });
      continue;
    }
    if (h.minRateWithBreakfastCny === null || h.minRateWithBreakfastCny === undefined) {
      eliminatedOptions.push({
        name: h.name,
        status: "eliminated",
        priceFound: "未取得实时含早报价",
        reason: "未获实时含早价，不编造估算价格区间",
      });
      continue;
    }
    if (h.minRateWithBreakfastCny > HOTEL_HARD_CAP_RMB || h.overBudget) {
      eliminatedOptions.push({
        name: h.name,
        status: "over_budget",
        priceFound: `¥${h.minRateWithBreakfastCny}`,
        reason: `超 ¥${HOTEL_HARD_CAP_RMB}/晚硬上限`,
      });
      continue;
    }

    let score = 0;
    if (h.isAtour) score += 100;
    if (/1\.8|2(?:\.0)?/.test(h.bedSpec ?? "")) score += 20;
    if (h.parkingPolicy?.includes("免费")) score += 15;
    if (/当天\s*12:00|当天\s*18:00/.test(h.freeCancellationDeadline ?? "")) score += 10;
    score -= Math.round(h.minRateWithBreakfastCny / 50);

    withinBudgetOptions.push({ ...h, _score: score });
  }

  withinBudgetOptions.sort((a, b) => b._score - a._score || a.minRateWithBreakfastCny - b.minRateWithBreakfastCny);
  const rankedOptions = withinBudgetOptions.map(({ _score, ...rest }, idx) => ({
    rank: idx + 1,
    tag: idx === 0
      ? (rest.isAtour ? "本周首选 · 亚朵 1.8m+ 大床" : "本周首选 · ¥1000 内实时可订")
      : (rest.isAtour ? "沿线亚朵对比" : "预算内备选对照"),
    ...rest,
  }));

  return {
    options: rankedOptions,
    eliminatedOptions,
  };
}

/**
 * Checks Ctrip hotels using existing raw Ctrip captures if fresh, or logged-in persistent Chrome profile.
 */
export async function checkCtripHotels({
  weekId,
  checkIn = weekId,
  checkOut,
  birthDay = CHILD_BIRTH_DAY,
  hotelCandidates = [],
  baseDir = DEFAULT_WEEKEND_BASE_DIR,
  opsStateDir = DEFAULT_OPS_WEEKEND_STATE_DIR,
  headless = true,
  dryRun = false,
  reuseRaw = true,
  webhookEnvPath,
  browserFactory = null,
} = {}) {
  const searchQueryParams = buildCtripSearchCondition({ checkIn, checkOut, birthDay });
  const rawDir = path.join(baseDir, "raw", weekId);
  const profileDir = path.join(baseDir, "browser-profile");
  const authStatusPath = path.join(opsStateDir, "auth-status.json");

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      searchQueryParams,
      options: [],
      eliminatedOptions: [],
      authExpired: false,
    };
  }

  const parsedHotels = [];
  const toCrawl = [];

  if (reuseRaw && fs.existsSync(rawDir)) {
    const rawFiles = fs.readdirSync(rawDir).filter((f) => /^ctrip-.*detail\.json$/i.test(f));
    const byId = new Map();
    for (const f of rawFiles) {
      try {
        const doc = JSON.parse(fs.readFileSync(path.join(rawDir, f), "utf8"));
        if (doc?.hotelId && Array.isArray(doc.lines)) {
          byId.set(String(doc.hotelId), doc);
        }
      } catch { /* ignore */ }
    }
    for (const cand of hotelCandidates) {
      const hit = cand.hotelId ? byId.get(String(cand.hotelId)) : null;
      if (hit && String(hit.url ?? "").includes(`checkIn=${checkIn}`)) {
        parsedHotels.push(parseCtripHotelDetail(hit));
      } else {
        toCrawl.push(cand);
      }
    }
  } else {
    toCrawl.push(...hotelCandidates);
  }

  let authExpired = false;
  let authReason = null;

  if (toCrawl.length > 0) {
    assertOutsideRepository(rawDir, REPO);
    fs.mkdirSync(rawDir, { recursive: true });
    let context;
    const openContext = browserFactory ?? (async () => {
      const { chromium } = require("playwright");
      return chromium.launchPersistentContext(profileDir, {
        channel: "chrome",
        headless,
        args: ["--disable-blink-features=AutomationControlled"],
      });
    });

    try {
      context = await openContext(profileDir);
      const page = context.pages()[0] || (await context.newPage());
      for (const cand of toCrawl) {
        const url = cand.url || buildCtripHotelUrl({
          hotelId: cand.hotelId,
          cityId: cand.cityId ?? 2,
          cityEnName: cand.cityEnName ?? "Shanghai",
          checkIn,
          checkOut,
          birthDay,
        });
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await new Promise((r) => setTimeout(r, 2500));

        const evalData = await page.evaluate(() => {
          const bodyText = document.body?.innerText || "";
          const lines = bodyText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
          return { pageTitle: document.title || "", bodyText, lines };
        });

        const auth = detectCtripAuthExpired({ url: page.url(), bodyText: evalData.bodyText });
        if (auth.expired) {
          authExpired = true;
          authReason = auth.reason;
          writeAuthStatusFile(authStatusPath, {
            ok: false,
            status: "ctrip_auth_expired",
            ctripAuthOk: false,
            reason: auth.reason,
            detectedAt: new Date().toISOString(),
            weekId,
            url: page.url(),
            reloginCommand: path.join(baseDir, "relogin.cmd"),
          });
          await sendWeekendWebhook(
            {
              title: "Nianlife 携程登录态已失效",
              message: `${auth.reason}，请双击 relogin.cmd 重新扫码登录。`,
              level: "warning",
              weekId,
              event: "ctrip_auth_expired",
            },
            { envPath: webhookEnvPath },
          );
          break;
        }

        const slug = String(cand.slug || cand.hotelId || "hotel").replace(/[^a-zA-Z0-9_-]/g, "-");
        const rawJsonPath = path.join(rawDir, `ctrip-${slug}-detail.json`);
        const rawObj = {
          slug,
          hotelId: String(cand.hotelId ?? ""),
          name: cand.name,
          capturedAt: new Date().toISOString(),
          url,
          pageTitle: evalData.pageTitle,
          lines: evalData.lines,
        };
        fs.writeFileSync(rawJsonPath, `${JSON.stringify(rawObj, null, 2)}\n`, "utf8");
        parsedHotels.push(parseCtripHotelDetail({ ...rawObj, districtArea: cand.districtArea ?? "" }));
        await new Promise((r) => setTimeout(r, 3500));
      }
    } finally {
      if (context) await context.close().catch(() => {});
    }
  }

  const ranked = selectAndRankHotels(parsedHotels);
  return {
    ok: !authExpired,
    authExpired,
    authReason,
    searchQueryParams: {
      checkIn,
      checkOut,
      rooms: 1,
      adults: 2,
      children: 1,
      childAgeParam: searchQueryParams.childAgeParam,
      capturedAt: new Date().toISOString(),
      verificationStatus: ranked.options.length > 0 ? "verified" : "unconfirmed",
    },
    hotelsChecked: parsedHotels.length,
    ...ranked,
  };
}

/**
 * Extracts closing/last-entry time & closure alerts from official page HTML/text,
 * and cleans all source URLs so root homepages are never labeled `verified`.
 */
export function extractOfficialDetailFacts(text = "") {
  const s = String(text);
  const lastEntry = s.match(/(?:停止入场|停止售票|停止检票|末班船|闭园时间)[^\d\n]{0,8}([01]?\d:[0-5]\d)/);
  const closedNotice = s.match(/(?:闭馆|暂停开放|维修公告|临时关闭)[^\n。]{0,40}/);
  return {
    anchorLastEntryHHMM: lastEntry ? lastEntry[1].padStart(5, "0") : null,
    closureAlert: closedNotice ? closedNotice[0].trim() : null,
  };
}

export async function verifyOfficialSources(sources = [], { fetchImpl = fetch, probeRemote = false } = {}) {
  const cleaned = sanitizeSourcesDetailUrls(sources);
  if (!probeRemote) {
    return { sources: cleaned, factsByUrl: {} };
  }
  const factsByUrl = {};
  const finalSources = [];
  for (const src of cleaned) {
    const entry = { ...src };
    if (entry.sourceType === "official_site" && !isRootHomepageUrl(entry.url)) {
      try {
        const res = await fetchImpl(entry.url, {
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const text = await res.text();
          factsByUrl[entry.url] = extractOfficialDetailFacts(text.replace(/<[^>]+>/g, " "));
          entry.verificationStatus = "verified";
          entry.verifiedAt = new Date().toISOString();
        } else {
          entry.verificationStatus = "unconfirmed";
        }
      } catch {
        entry.verificationStatus = "unconfirmed";
      }
    }
    finalSources.push(entry);
  }
  return { sources: finalSources, factsByUrl };
}
