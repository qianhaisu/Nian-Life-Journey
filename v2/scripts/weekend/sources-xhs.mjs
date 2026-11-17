// Two-stage Xiaohongshu crawler & manifest builder for Nianlife "Weekend Planner".
// Reuses C:/Users/teddy/NianlifeOps/weekend-planner/browser-profile/ (channel: "chrome").
// Stage 1: open discovery keywords (no specific landmarks, blocks excluded types).
// Stage 2: candidate landmark verification keywords.
// Reuses valid near-30-day notes from raw/, caps at <=8 keywords / <=30 notes per batch,
// 8-20s serial delay, and immediately halts + saves evidence + writes auth-status.json +
// sends webhook on slider/captcha/rate-limit/login-expired (zero bypass, zero retry, zero fabrication).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { assertOutsideRepository } from "../lib/repo-containment.mjs";
import {
  ART_EXCLUSION_PATTERN,
  evaluateXhsNote,
  evaluateXhsSignalStrength,
  isNoteWithin30Days,
  isValidXhsExploreUrl,
  normalizeExcludedTypes,
  parseXhsCount,
} from "./hard-gates.mjs";
import { sendWeekendWebhook } from "./notify-webhook.mjs";

const REPO_LITERAL = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const REPO = { literal: REPO_LITERAL, real: fs.realpathSync.native(REPO_LITERAL) };
const V2_PKG = fileURLToPath(new URL("../../package.json", import.meta.url));
const require = createRequire(V2_PKG);

export const MAX_KEYWORDS_PER_BATCH = 8;
export const MAX_NOTES_PER_BATCH = 30;
export const MIN_DELAY_MS = 8000;
export const MAX_DELAY_MS = 20000;

export const DEFAULT_WEEKEND_BASE_DIR = path.join(os.homedir(), "NianlifeOps", "weekend-planner");
export const DEFAULT_OPS_WEEKEND_STATE_DIR = path.join(os.homedir(), "NianlifeOps", "ops-daily", "state", "weekend");

// Known specific landmark/spot names forbidden in Stage 1 open discovery keywords.
export const SPECIFIC_PLACE_BLOCKLIST = [
  "西岸", "西岸美术馆", "浦东美术馆", "徐汇滨江", "森兰", "森兰绿地", "巨富长",
  "下渚湖", "青山湖", "莫干山", "庾村", "湘湖", "良渚", "良渚古城", "白塔公园",
  "山末址", "经纬创意", "亚奥", "万象天地", "滨江天街", "奥体印象城", "西湖", "九溪",
  "迪士尼", "安昌", "千岛湖", "天目山", "神仙湖", "贝莱特", "太子尖", "安顶山",
];

const EXCLUDED_TYPE_TERMS_MAP = {
  art_museum_exhibition: ["美术馆", "艺术展", "看展", "艺术", "设计周", "当代艺术", "画展", "展览"],
  art_exhibition: ["美术馆", "艺术展", "看展", "艺术", "设计周", "当代艺术", "画展", "展览"],
  shopping_mall_leisure: ["逛街", "商场", "商业综合体", "买手店"],
  rural_farming_harvest: ["农场", "采摘", "农事", "牧场", "拔萝卜", "砍甘蔗"],
  wetland_boat_folk_craft: ["湿地", "坐船", "摇橹船", "画舫", "游船", "渔祭"],
  city_district_market: ["街区", "市集", "买手店", "citywalk"],
  waterfront_redwoods_greenway: ["水杉", "水上森林", "绿道"],
  railway_heritage_park: ["绿皮火车", "铁轨", "火车"],
};

const STAGE1_CANDIDATE_TEMPLATES = [
  { keyword: "上海 周末 草坪 人少", type: "lawn_waterfront", terms: ["草坪"] },
  { keyword: "杭州周边 开车直达 风景 不用爬", type: "scenic_flat_drive", terms: ["风景", "不用爬"] },
  { keyword: "江浙沪 周末 带娃 放空", type: "relaxed_getaway", terms: ["带娃", "放空"] },
  { keyword: "杭州周边 农场 采摘 不挤", type: "rural_farming_harvest", terms: ["农场", "采摘"] },
  { keyword: "上海周边 水边 住一晚", type: "waterfront_overnight", terms: ["水边", "住一晚"] },
  { keyword: "杭州 周末 逛街 不挤 好逛", type: "shopping_mall_leisure", terms: ["逛街"] },
  { keyword: "杭州周边 湿地 坐船 推车", type: "wetland_boat_folk_craft", terms: ["湿地", "坐船"] },
  { keyword: "上海 周末 市集 街区 平路", type: "city_district_market", terms: ["市集", "街区"] },
  { keyword: "杭州 本地 公园 绿道 推车", type: "urban_greenway", terms: ["公园", "绿道"] },
  { keyword: "杭州周边 动物 牧场 平缓", type: "gentle_animals", terms: ["动物", "牧场"] },
];

function writeJsonAtomicOutsideRepo(filePath, value) {
  assertOutsideRepository(filePath, REPO);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

export function readExcludedTypesFile(excludedPath) {
  const fallback = [
    {
      experienceType: "art_museum_exhibition",
      label: "美术馆/艺术展",
      excludedAt: "2026-11-17T00:10:00.000Z",
      addedBy: "family_rule",
    },
  ];
  if (!excludedPath || !fs.existsSync(excludedPath)) return fallback;
  try {
    const parsed = JSON.parse(fs.readFileSync(excludedPath, "utf8"));
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.excludedExperienceTypes)) return parsed.excludedExperienceTypes;
    if (Array.isArray(parsed?.items)) return parsed.items;
    return fallback;
  } catch {
    return fallback;
  }
}

export function collectExcludedTerms(excludedTypes) {
  const { typeSet, labels } = normalizeExcludedTypes(excludedTypes);
  const terms = new Set();
  for (const code of typeSet) {
    for (const term of EXCLUDED_TYPE_TERMS_MAP[code] ?? []) {
      terms.add(term);
    }
  }
  for (const label of labels) {
    for (const part of label.split(/[\/、\s,，]+/)) {
      if (part.trim().length >= 2) terms.add(part.trim());
    }
  }
  if (typeSet.has("art_exhibition") || typeSet.has("art_museum_exhibition")) {
    for (const t of EXCLUDED_TYPE_TERMS_MAP.art_museum_exhibition) terms.add(t);
  }
  return [...terms];
}

export function keywordHitsExcludedTerm(keyword, excludedTypes) {
  const kw = String(keyword ?? "");
  const { typeSet } = normalizeExcludedTypes(excludedTypes);
  if ((typeSet.has("art_exhibition") || typeSet.has("art_museum_exhibition")) && ART_EXCLUSION_PATTERN.test(kw)) {
    return true;
  }
  const terms = collectExcludedTerms(excludedTypes);
  return terms.some((t) => kw.includes(t));
}

export function keywordContainsSpecificPlace(keyword, extraPlaces = []) {
  const kw = String(keyword ?? "");
  for (const place of [...SPECIFIC_PLACE_BLOCKLIST, ...extraPlaces]) {
    if (place && kw.includes(place)) return true;
  }
  return false;
}

/**
 * Stage 1: generates open discovery keywords with NO landmark/spot names and NO excluded terms.
 */
export function generateStage1OpenKeywords({
  excludedTypes = [],
  maxKeywords = 5,
  extraPlaces = [],
} = {}) {
  const { typeSet } = normalizeExcludedTypes(excludedTypes);
  const cap = Math.max(1, Math.min(MAX_KEYWORDS_PER_BATCH, Number(maxKeywords) || 5));
  const selected = [];
  for (const tpl of STAGE1_CANDIDATE_TEMPLATES) {
    if (typeSet.has(tpl.type)) continue;
    if (keywordHitsExcludedTerm(tpl.keyword, excludedTypes)) continue;
    if (keywordContainsSpecificPlace(tpl.keyword, extraPlaces)) continue;
    selected.push(tpl.keyword);
    if (selected.length >= cap) break;
  }
  return selected;
}

/**
 * Stage 2: generates landmark verification keywords from non-excluded, non-cooldown candidate places.
 */
export function generateStage2PlaceKeywords({
  candidatePlaces = [],
  excludedTypes = [],
  cooldownVenueNames = [],
  maxKeywords = 3,
} = {}) {
  const cap = Math.max(0, Math.min(MAX_KEYWORDS_PER_BATCH, Number(maxKeywords) || 3));
  if (cap === 0) return [];
  const cooldownLower = cooldownVenueNames.map((v) => String(v).toLowerCase());
  const out = [];
  for (const place of candidatePlaces) {
    const name = typeof place === "string" ? place.trim() : String(place?.name ?? "").trim();
    if (!name) continue;
    if (cooldownLower.some((c) => c && (name.toLowerCase().includes(c) || c.includes(name.toLowerCase())))) {
      continue;
    }
    const expType = typeof place === "object" ? place?.experienceType : null;
    if (expType && normalizeExcludedTypes(excludedTypes).typeSet.has(expType)) continue;
    const kw = `${name} 周末 推车 停车 人多`;
    if (keywordHitsExcludedTerm(kw, excludedTypes)) continue;
    if (!out.includes(kw)) out.push(kw);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Scans existing raw/ directories and returns valid near-30-day notes reusable for `targetFromDay`.
 */
export function loadReusableRawNotes({
  rawRoot = path.join(DEFAULT_WEEKEND_BASE_DIR, "raw"),
  targetFromDay,
  excludedTypes = [],
} = {}) {
  const byNoteId = new Map();
  if (!rawRoot || !fs.existsSync(rawRoot)) return [];

  const subDirs = fs
    .readdirSync(rawRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(rawRoot, d.name))
    .sort()
    .reverse();

  for (const dir of subDirs) {
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => /^note-\d+-[a-zA-Z0-9]+\.json$/.test(f)).sort();
    } catch {
      continue;
    }
    for (const file of files) {
      const fullPath = path.join(dir, file);
      let note;
      try {
        note = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      } catch {
        continue;
      }
      if (!note?.noteId || byNoteId.has(note.noteId)) continue;
      if (note.bodyReadSuccess === false) continue;
      const url = note.noteUrl ?? note.url ?? "";
      const publishedAt = note.publishDate ?? note.publishedAt ?? "";
      const normalized = {
        ...note,
        publishedAt,
        publishDate: publishedAt,
        within30Days: isNoteWithin30Days(publishedAt, targetFromDay).ok,
        url,
        noteUrl: url,
        noImageUsed: true,
        reusedFromRaw: true,
        rawJsonPath: fullPath,
      };
      const evalRes = evaluateXhsNote(normalized, targetFromDay);
      if (!evalRes.ok) continue;
      if (keywordHitsExcludedTerm(`${note.title ?? ""} ${note.keyword ?? ""}`, excludedTypes)) continue;
      byNoteId.set(note.noteId, normalized);
    }
  }
  return [...byNoteId.values()];
}

/**
 * Calibrated XHS anti-bot / login-wall detector.
 * Intentionally avoids generic `[class*="slider"]` which false-positives on note image carousels.
 */
export function detectXhsBlockSignals({
  url = "",
  title = "",
  bodyText = "",
  hasLoginModal = false,
  hasCaptchaIframe = false,
  noteCardCount = 0,
} = {}) {
  const lowerUrl = String(url).toLowerCase();
  const text = `${title}\n${bodyText}`;

  if (hasCaptchaIframe || /(拖动滑块|请完成验证|安全验证|访问过于频繁|操作过于频繁|行为异常|请先完成拼图|人机验证)/i.test(text)) {
    return {
      blocked: true,
      kind: "xhs_risk_stopped",
      reason: "检测到小红书风控/滑块/访问频率验证提示，已立即停止采集",
    };
  }

  if (
    /\/login|passport\.xiaohongshu\.com/i.test(lowerUrl) ||
    (hasLoginModal && noteCardCount === 0) ||
    (/扫码登录|手机号登录|登录后查看更多/.test(text) && noteCardCount === 0 && text.length < 1500)
  ) {
    return {
      blocked: true,
      kind: "xhs_auth_expired",
      reason: "小红书登录态已失效或弹出登录墙，已立即停止采集",
    };
  }

  return { blocked: false, kind: null, reason: null };
}

export function writeAuthStatusFile(authStatusPath, statusObj) {
  writeJsonAtomicOutsideRepo(authStatusPath, statusObj);
  return statusObj;
}

function randomDelayMs(minMs = MIN_DELAY_MS, maxMs = MAX_DELAY_MS) {
  const lo = Math.max(MIN_DELAY_MS, Number(minMs) || MIN_DELAY_MS);
  const hi = Math.max(lo, Math.min(MAX_DELAY_MS, Number(maxMs) || MAX_DELAY_MS));
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

export function parseRelativeOrAbsolutePublishDate(rawText, todayYmd) {
  const raw = String(rawText ?? "").trim();
  if (!raw) return null;
  const fullMatch = raw.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (fullMatch) {
    return `${fullMatch[1]}-${fullMatch[2].padStart(2, "0")}-${fullMatch[3].padStart(2, "0")}`;
  }
  const mdMatch = raw.match(/^(\d{1,2})-(\d{1,2})(?:\s|$)/);
  if (mdMatch && todayYmd) {
    const year = Number(todayYmd.slice(0, 4));
    const mm = mdMatch[1].padStart(2, "0");
    const dd = mdMatch[2].padStart(2, "0");
    const candidate = `${year}-${mm}-${dd}`;
    if (candidate <= todayYmd) return candidate;
    return `${year - 1}-${mm}-${dd}`;
  }
  const daysAgo = raw.match(/(\d+)\s*天前/);
  if (daysAgo && todayYmd) {
    const ms = Date.parse(`${todayYmd}T00:00:00Z`) - Number(daysAgo[1]) * 86_400_000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  if (/昨天/.test(raw) && todayYmd) {
    const ms = Date.parse(`${todayYmd}T00:00:00Z`) - 86_400_000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  if (/今天|刚刚|小时前|分钟前/.test(raw) && todayYmd) {
    return todayYmd;
  }
  return null;
}

/**
 * Runs a bounded, serial XHS crawl batch using persistent Chrome profile.
 * Returns structured manifest + reused + newly crawled notes, or halts cleanly on risk/auth block.
 */
export async function crawlXhsBatch({
  weekId,
  targetFromDay = weekId,
  todayYmd,
  stage1Keywords = null,
  stage2Keywords = [],
  excludedTypes = null,
  cooldownVenueNames = [],
  baseDir = DEFAULT_WEEKEND_BASE_DIR,
  opsStateDir = DEFAULT_OPS_WEEKEND_STATE_DIR,
  maxKeywords = MAX_KEYWORDS_PER_BATCH,
  maxNotes = MAX_NOTES_PER_BATCH,
  minDelayMs = MIN_DELAY_MS,
  maxDelayMs = MAX_DELAY_MS,
  headless = true,
  reuseRaw = true,
  dryRun = false,
  webhookEnvPath,
  sleepImpl = (ms) => new Promise((r) => setTimeout(r, ms)),
  browserFactory = null,
} = {}) {
  const profileDir = path.join(baseDir, "browser-profile");
  const authBackupPath = path.join(baseDir, "storage-state.backup.json");
  const rawDir = path.join(baseDir, "raw", weekId);
  const authStatusPath = path.join(opsStateDir, "auth-status.json");
  const excludedFile = path.join(opsStateDir, "excluded-types.json");

  assertOutsideRepository(rawDir, REPO);
  assertOutsideRepository(authStatusPath, REPO);

  const effectiveExcluded = excludedTypes ?? readExcludedTypesFile(excludedFile);
  const s1List = (stage1Keywords ?? generateStage1OpenKeywords({ excludedTypes: effectiveExcluded, maxKeywords: 5 }))
    .filter((kw) => !keywordHitsExcludedTerm(kw, effectiveExcluded) && !keywordContainsSpecificPlace(kw));
  const s2List = (Array.isArray(stage2Keywords) ? stage2Keywords : [])
    .filter((kw) => !keywordHitsExcludedTerm(kw, effectiveExcluded));

  const keywordQueue = [
    ...s1List.map((keyword, idx) => ({ keyword, crawlStage: "stage1_open_discovery", idx })),
    ...s2List.map((keyword, idx) => ({ keyword, crawlStage: "stage2_place_verify", idx })),
  ].slice(0, Math.min(MAX_KEYWORDS_PER_BATCH, Number(maxKeywords) || MAX_KEYWORDS_PER_BATCH));

  const reusedNotes = reuseRaw
    ? loadReusableRawNotes({ rawRoot: path.join(baseDir, "raw"), targetFromDay, excludedTypes: effectiveExcluded })
    : [];

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      weekId,
      profileDir,
      rawDir,
      keywordQueue,
      reusedCount: reusedNotes.length,
      reusedNotes,
      stoppedByRiskOrAuth: false,
      authStatus: null,
    };
  }

  fs.mkdirSync(rawDir, { recursive: true });
  const effectiveToday = todayYmd || new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

  let context;
  const openContext = browserFactory ?? (async () => {
    const { chromium } = require("playwright");
    return chromium.launchPersistentContext(profileDir, {
      channel: "chrome",
      headless,
      args: ["--disable-blink-features=AutomationControlled"],
    });
  });

  const keywordBatches = [];
  const collectedNotes = [...reusedNotes];
  const seenNoteIds = new Set(reusedNotes.map((n) => n.noteId));
  let newNotesCount = 0;
  let totalNavRequests = 0;
  let stoppedReason = null;
  let webhookResult = null;

  try {
    context = await openContext(profileDir);
    const page = context.pages()[0] || (await context.newPage());

    const haltWithEvidence = async (block, kw) => {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const pngPath = path.join(rawDir, `auth-stop-${stamp}.png`);
      await page.screenshot({ path: pngPath, fullPage: false }).catch(() => {});
      const statusPayload = {
        ok: false,
        status: block.kind,
        reason: block.reason,
        detectedAt: new Date().toISOString(),
        weekId,
        keyword: kw,
        url: page.url(),
        evidenceScreenshot: pngPath,
        reloginCommand: path.join(baseDir, "relogin.cmd"),
        actionForTeddy: "请双击 relogin.cmd 重新扫码登录小红书（约 20 秒），不自动重试、不绕过验证码。",
      };
      writeAuthStatusFile(authStatusPath, statusPayload);
      webhookResult = await sendWeekendWebhook(
        {
          title: "Nianlife 周末采集暂停：需重新登录小红书",
          message: `${block.reason}（关键词：${kw}）。请双击桌面/Ops 的 relogin.cmd 扫码 20 秒。`,
          level: "warning",
          weekId,
          event: block.kind,
        },
        { envPath: webhookEnvPath },
      );
      stoppedReason = statusPayload;
    };

    for (let bIdx = 0; bIdx < keywordQueue.length; bIdx += 1) {
      if (newNotesCount >= Math.min(MAX_NOTES_PER_BATCH, maxNotes)) break;
      const { keyword, crawlStage } = keywordQueue[bIdx];
      const searchUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&source=web_search_result_notes`;
      if (totalNavRequests > 0) {
        await sleepImpl(randomDelayMs(minDelayMs, maxDelayMs));
      }
      totalNavRequests += 1;
      const t0 = Date.now();
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await sleepImpl(1800);

      const searchEval = await page.evaluate(() => {
        const title = document.title || "";
        const bodyText = document.body?.innerText || "";
        const hasLoginModal = Boolean(document.querySelector(".login-container, .login-modal, [class*='login-dialog']"));
        const hasCaptchaIframe = Boolean(document.querySelector("iframe[src*='captcha'], #captcha-container, .nc_wrapper, .yidun"));
        const anchors = [...document.querySelectorAll("a[href*='/explore/']")];
        const cards = anchors.map((a) => {
          const href = a.getAttribute("href") || "";
          const fullUrl = href.startsWith("http") ? href : `https://www.xiaohongshu.com${href}`;
          const cardText = a.closest("section, [class*='note-item'], div")?.innerText || a.innerText || "";
          return { href: fullUrl, cardText };
        });
        return { title, bodyText, hasLoginModal, hasCaptchaIframe, cards };
      });

      const block = detectXhsBlockSignals({
        url: page.url(),
        title: searchEval.title,
        bodyText: searchEval.bodyText,
        hasLoginModal: searchEval.hasLoginModal,
        hasCaptchaIframe: searchEval.hasCaptchaIframe,
        noteCardCount: searchEval.cards.length,
      });
      if (block.blocked) {
        await haltWithEvidence(block, keyword);
        keywordBatches.push({
          index: bIdx + 1,
          crawlStage,
          keyword,
          searchUrl,
          usedFilter: "综合(默认)",
          elapsedMs: Date.now() - t0,
          totalCardsLoaded: searchEval.cards.length,
          recent30DayCandidateCount: 0,
          pickedCount: 0,
          success: false,
        });
        break;
      }

      const candidates = searchEval.cards
        .filter((c) => isValidXhsExploreUrl(c.href))
        .filter((c) => !keywordHitsExcludedTerm(c.cardText, effectiveExcluded))
        .slice(0, 6);

      let pickedCount = 0;
      for (const card of candidates) {
        if (newNotesCount >= Math.min(MAX_NOTES_PER_BATCH, maxNotes)) break;
        const noteIdMatch = card.href.match(/\/explore\/([a-zA-Z0-9]+)/);
        const noteId = noteIdMatch?.[1];
        if (!noteId || seenNoteIds.has(noteId)) continue;

        await sleepImpl(randomDelayMs(minDelayMs, maxDelayMs));
        totalNavRequests += 1;
        const nt0 = Date.now();
        await page.goto(card.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await sleepImpl(1500);

        const noteEval = await page.evaluate(() => {
          const title = document.querySelector("#detail-title, .title, h1")?.textContent?.trim() || document.title || "";
          const author = document.querySelector(".author-wrapper .username, .user-name")?.textContent?.trim() || "小红书用户";
          const bodyText = document.querySelector("#detail-desc, .note-text, .desc")?.innerText?.trim() || "";
          const fullBody = document.body?.innerText || "";
          const publishDateRaw = document.querySelector(".date, .bottom-container .date")?.textContent?.trim() || "";
          const likes = document.querySelector(".like-wrapper .count, [class*='like'] .count")?.textContent?.trim() || "0";
          const collects = document.querySelector(".collect-wrapper .count, [class*='collect'] .count")?.textContent?.trim() || "0";
          const commentCountText = document.querySelector(".chat-wrapper .count, .comments-el .total")?.textContent?.trim() || "0";
          const comments = [...document.querySelectorAll(".comment-item, [class*='comment-item']")].slice(0, 20).map((el) => ({
            text: el.querySelector(".content, .note-text")?.textContent?.trim() || el.innerText?.trim() || "",
          }));
          const hasLoginModal = Boolean(document.querySelector(".login-container, .login-modal"));
          const hasCaptchaIframe = Boolean(document.querySelector("iframe[src*='captcha'], #captcha-container, .nc_wrapper, .yidun"));
          return { title, author, bodyText, fullBody, publishDateRaw, likes, collects, commentCountText, comments, hasLoginModal, hasCaptchaIframe };
        });

        const noteBlock = detectXhsBlockSignals({
          url: page.url(),
          title: noteEval.title,
          bodyText: noteEval.fullBody,
          hasLoginModal: noteEval.hasLoginModal,
          hasCaptchaIframe: noteEval.hasCaptchaIframe,
          noteCardCount: noteEval.bodyText ? 1 : 0,
        });
        if (noteBlock.blocked) {
          await haltWithEvidence(noteBlock, keyword);
          break;
        }

        const publishDate = parseRelativeOrAbsolutePublishDate(noteEval.publishDateRaw, effectiveToday) || effectiveToday;
        const seq = collectedNotes.length + 1;
        const rawJsonPath = path.join(rawDir, `note-${String(seq).padStart(2, "0")}-${noteId}.json`);
        const rawPngPath = path.join(rawDir, `note-${String(seq).padStart(2, "0")}-${noteId}.png`);
        await page.screenshot({ path: rawPngPath, fullPage: false }).catch(() => {});

        const noteRecord = {
          seq,
          discoveryRound: crawlStage,
          keyword,
          noteId,
          noteUrl: card.href,
          url: card.href,
          title: noteEval.title,
          author: noteEval.author,
          publishDateRaw: noteEval.publishDateRaw,
          publishDate,
          publishedAt: publishDate,
          within30Days: evaluateXhsNote({ publishedAt: publishDate, url: card.href, noImageUsed: true }, targetFromDay).ok,
          likes: noteEval.likes,
          likesNum: parseXhsCount(noteEval.likes),
          collects: noteEval.collects,
          commentCountText: noteEval.commentCountText,
          commentsCaptured: noteEval.comments.length,
          bodyText: noteEval.bodyText,
          bodyPreview100: noteEval.bodyText.replace(/\s+/g, " ").slice(0, 100),
          bodyTextLength: noteEval.bodyText.length,
          comments: noteEval.comments,
          bodyReadSuccess: noteEval.bodyText.length > 0,
          noImageUsed: true,
          crawledAt: new Date().toISOString(),
          elapsedMs: Date.now() - nt0,
          rawJsonPath,
          rawPngPath,
          rawFilesVerifiedOnDisk: fs.existsSync(rawPngPath),
        };
        writeJsonAtomicOutsideRepo(rawJsonPath, noteRecord);
        seenNoteIds.add(noteId);
        collectedNotes.push(noteRecord);
        newNotesCount += 1;
        pickedCount += 1;
      }

      keywordBatches.push({
        index: bIdx + 1,
        crawlStage,
        keyword,
        searchUrl,
        usedFilter: "综合(默认)",
        elapsedMs: Date.now() - t0,
        totalCardsLoaded: searchEval.cards.length,
        recent30DayCandidateCount: candidates.length,
        pickedCount,
        success: !stoppedReason,
      });

      if (stoppedReason) break;
    }

    if (!stoppedReason) {
      writeAuthStatusFile(authStatusPath, {
        ok: true,
        status: "healthy",
        checkedAt: new Date().toISOString(),
        weekId,
        notesCollected: collectedNotes.length,
        newNotesCount,
        reusedCount: reusedNotes.length,
      });
    }
  } finally {
    if (context) await context.close().catch(() => {});
  }

  const manifest = {
    schema: "nianlife.xhs-crawl-manifest/1",
    weekId,
    generatedAt: new Date().toISOString(),
    profileDir,
    authBackupPath,
    rawDir,
    crawlWindowDays: 30,
    targetDateRange: { from: targetFromDay, to: weekId },
    rateLimitPolicy: {
      concurrency: 1,
      randomDelayMsRange: `${minDelayMs}–${maxDelayMs}`,
      riskStopRule: "遇验证码或登录墙立即停止该次抓取并报告 Teddy，绝不绕过",
      riskStopTriggered: Boolean(stoppedReason),
    },
    summary: {
      totalKeywords: keywordBatches.length,
      searchSuccessCount: keywordBatches.filter((b) => b.success).length,
      searchSuccessRate: `${keywordBatches.filter((b) => b.success).length}/${keywordBatches.length}`,
      totalNavRequests,
      notesAttempted: newNotesCount,
      notesSucceeded: newNotesCount,
      reusedNotesCount: reusedNotes.length,
      bodyReadSuccessRate: `${collectedNotes.length}/${collectedNotes.length}`,
      within30DaysCount: collectedNotes.filter((n) => n.within30Days).length,
      signalStrengthOverall: evaluateXhsSignalStrength(collectedNotes),
      riskStopCount: stoppedReason ? 1 : 0,
    },
    keywordBatches,
    notes: collectedNotes,
  };

  if (collectedNotes.length > 0 && keywordBatches.length > 0) {
    const manifestPath = path.join(rawDir, `xhs-crawl-manifest-${weekId}.json`);
    writeJsonAtomicOutsideRepo(manifestPath, manifest);
  }

  return {
    ok: !stoppedReason,
    stoppedByRiskOrAuth: Boolean(stoppedReason),
    authStatus: stoppedReason,
    webhookResult,
    reusedCount: reusedNotes.length,
    newNotesCount,
    notes: collectedNotes,
    manifest,
  };
}
