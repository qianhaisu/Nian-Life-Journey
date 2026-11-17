// Weather crawler & parser for Nianlife "Weekend Planner".
// Primary: weather.com.cn 7-day `var hour3data` (3-hour granular segments) with strict <title>
// city name verification. Friday calibration: coordinate-based wttr.in (or optional QWeather Key).
// Explicitly forbids api.open-meteo.com (times out on local host).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { addDays, shanghaiToday } from "../editor/plan.mjs";

export const WEATHER_CACHE_TTL_MS = 6 * 3600 * 1000;
export const FORBIDDEN_WEATHER_HOST_RE = /open-meteo\.com/i;

export const WEATHER_STATIONS = {
  "101210204": { code: "101210204", city: "德清", titleMustInclude: "德清", lat: 30.54, lng: 119.97 },
  "101210102": { code: "101210102", city: "萧山", titleMustInclude: "萧山", lat: 30.18, lng: 120.26 },
  "101210107": { code: "101210107", city: "临安", titleMustInclude: "临安", lat: 30.23, lng: 119.72 },
  "101210101": { code: "101210101", city: "杭州", titleMustInclude: "杭州", lat: 30.27, lng: 120.15 },
  "101020100": { code: "101020100", city: "上海", titleMustInclude: "上海", lat: 31.23, lng: 121.47 },
  "101020600": { code: "101020600", city: "浦东", titleMustInclude: "浦东", lat: 31.22, lng: 121.54 },
};

export const DEFAULT_WEEKEND_STATION_CODES = [
  "101020600", // 浦东
  "101020100", // 上海
  "101210101", // 杭州
  "101210102", // 萧山
  "101210204", // 德清
  "101210107", // 临安
];

export function assertAllowedWeatherUrl(url) {
  if (FORBIDDEN_WEATHER_HOST_RE.test(String(url ?? ""))) {
    throw new Error(`FORBIDDEN_WEATHER_SOURCE: api.open-meteo.com is permanently disabled (${url})`);
  }
}

export function defaultWeatherCacheDir(opsDir = process.env.NIANLIFE_OPS_DIR ?? path.join(os.homedir(), "NianlifeOps", "ops-daily")) {
  return path.join(opsDir, "state", "weekend", "cache");
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

function readCached(cacheFile, nowMs, ttlMs) {
  try {
    if (!fs.existsSync(cacheFile)) return null;
    const data = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    if (!data || typeof data !== "object" || !Number.isFinite(data.fetchedAtMs)) return null;
    if (nowMs - data.fetchedAtMs >= ttlMs) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Resolves the YYYY-MM-DD calendar day for a weather.com.cn slot prefix like "21日14时"
 * relative to the fetch anchor date (handles month-end / year-end rollover across +0..+8 days).
 */
export function resolveDayOfMonthDate(dayOfMonth, anchorYmd) {
  const targetDay = Number(dayOfMonth);
  if (!Number.isInteger(targetDay) || targetDay < 1 || targetDay > 31) return null;
  for (let offset = -1; offset <= 9; offset += 1) {
    const candidate = addDays(anchorYmd, offset);
    if (Number(candidate.slice(8, 10)) === targetDay) {
      return candidate;
    }
  }
  return null;
}

export function conditionToIcon(condition = "") {
  const c = String(condition);
  if (/雨|雪|雷/.test(c)) return "rain";
  if (/风|霾|沙/.test(c)) return "wind";
  if (/阴/.test(c)) return "cloud";
  if (/多云/.test(c)) return "cloud_sun";
  return "sun";
}

export function parseWeatherComCnHtml(html, { code, expectedCity, anchorYmd = shanghaiToday() }) {
  const titleMatch = String(html).match(/<title>([^<]+)<\/title>/i);
  const title = titleMatch?.[1]?.trim() ?? "";
  if (!title) {
    throw new Error(`WEATHER_TITLE_MISSING: station ${code} returned no <title>`);
  }
  const station = WEATHER_STATIONS[code];
  const expectedToken = expectedCity || station?.titleMustInclude || station?.city || "";
  if (expectedToken && !title.includes(expectedToken)) {
    throw new Error(
      `WEATHER_CITY_MISMATCH: station ${code} <title> "${title}" does not include expected city "${expectedToken}"`,
    );
  }

  const h3Match = String(html).match(/var\s+hour3data\s*=\s*(\{[\s\S]*?\})\s*(?:;|<\/script>)/);
  if (!h3Match) {
    throw new Error(`WEATHER_HOUR3DATA_MISSING: station ${code} HTML lacks var hour3data`);
  }
  let hour3Raw;
  try {
    hour3Raw = JSON.parse(h3Match[1]);
  } catch (err) {
    throw new Error(`WEATHER_HOUR3DATA_INVALID_JSON: station ${code} (${err.message})`);
  }

  const buckets7d = Array.isArray(hour3Raw?.["7d"]) ? hour3Raw["7d"] : [];
  if (buckets7d.length === 0) {
    throw new Error(`WEATHER_HOUR3DATA_EMPTY_7D: station ${code} 7d array is empty`);
  }

  const hour3Segments = {};
  for (const bucket of buckets7d) {
    if (!Array.isArray(bucket)) continue;
    for (const rawEntry of bucket) {
      const parts = String(rawEntry ?? "").split(",");
      if (parts.length < 6) continue;
      const [slot, _iconCode, condition, temp, windDir, windForce] = parts.map((s) => s.trim());
      const slotMatch = slot.match(/^(\d{1,2})日(\d{1,2})时$/);
      if (!slotMatch) continue;
      const date = resolveDayOfMonthDate(slotMatch[1], anchorYmd);
      if (!date) continue;
      if (!hour3Segments[date]) hour3Segments[date] = [];
      hour3Segments[date].push({
        slot,
        hour: Number(slotMatch[2]),
        condition,
        temp,
        windDir,
        windForce,
      });
    }
  }

  for (const date of Object.keys(hour3Segments)) {
    hour3Segments[date].sort((a, b) => a.hour - b.hour);
  }

  return {
    code,
    city: expectedToken || station?.city || code,
    title,
    sourceUrl: `https://www.weather.com.cn/weather/${code}.shtml`,
    hour3Segments,
  };
}

export function summarizeDaySegments(date, dayLabel, segments = []) {
  const daytime = segments.filter((s) => s.hour >= 8 && s.hour <= 20);
  const pool = daytime.length > 0 ? daytime : segments;
  if (pool.length === 0) {
    return {
      date,
      dayLabel,
      summary: "待更新",
      wind: "待更新",
      icon: "cloud_sun",
      conditionShort: "待更新",
      hasRainInDaytime: false,
      minTempC: null,
      maxTempC: null,
    };
  }
  const temps = pool
    .map((s) => Number(String(s.temp).match(/-?\d+/)?.[0]))
    .filter((n) => Number.isFinite(n));
  const minT = temps.length ? Math.min(...temps) : null;
  const maxT = temps.length ? Math.max(...temps) : null;
  const conditions = pool.map((s) => s.condition);
  const rainSlots = pool.filter((s) => /雨|雪/.test(s.condition));
  const hasRainInDaytime = rainSlots.length > 0;
  const representative = rainSlots[0]?.condition ?? conditions[Math.floor(conditions.length / 2)] ?? conditions[0];
  const tempText = minT !== null && maxT !== null ? `${minT}–${maxT}℃` : "";
  const wind = pool[0]?.windForce || "<3级";
  const uniqueConds = [...new Set(conditions)];
  const condText = uniqueConds.length === 1 ? uniqueConds[0] : `${uniqueConds[0]}转${uniqueConds.at(-1)}`;
  const rainNote = hasRainInDaytime ? `（${rainSlots.map((s) => s.slot).join("、")}有降水）` : " 无雨";
  return {
    date,
    dayLabel,
    summary: `${dayLabel}白天 ${condText} ${tempText}${rainNote}`.trim(),
    wind,
    icon: conditionToIcon(representative),
    conditionShort: representative,
    hasRainInDaytime,
    minTempC: minT,
    maxTempC: maxT,
  };
}

/**
 * Builds `weatherSlots[]` for a proposal's specific activity windows using hour3Segments.
 */
export function buildProposalWeatherSlots(cityWeather, windows = []) {
  const out = [];
  for (const w of windows) {
    const segs = (cityWeather?.hour3Segments?.[w.date] ?? []).filter(
      (s) => s.hour >= (w.startHour ?? 8) && s.hour <= (w.endHour ?? 20),
    );
    if (segs.length === 0) continue;
    const temps = segs.map((s) => Number(String(s.temp).match(/-?\d+/)?.[0])).filter((n) => Number.isFinite(n));
    const minT = temps.length ? Math.min(...temps) : null;
    const maxT = temps.length ? Math.max(...temps) : null;
    const conds = [...new Set(segs.map((s) => s.condition))];
    const hasRain = segs.some((s) => /雨|雪/.test(s.condition));
    out.push({
      slotLabel: w.slotLabel,
      condition: conds.join("转"),
      tempRangeC: minT !== null && maxT !== null ? (minT === maxT ? `${minT}℃` : `${minT}–${maxT}℃`) : "待确认",
      wind: `${segs[0]?.windDir ?? ""} ${segs[0]?.windForce ?? "<3级"}`.trim(),
      precipRiskNote: hasRain
        ? `该时段预报有${conds.filter((c) => /雨|雪/.test(c)).join("/")}，建议切换室内备选`
        : "时段内无降水信号（短时降水概率以周五更新为准）",
    });
  }
  return out;
}

export async function fetchWeatherComCnCity(
  code,
  {
    cacheDir = defaultWeatherCacheDir(),
    cacheTtlMs = WEATHER_CACHE_TTL_MS,
    forceRefresh = false,
    nowMs = Date.now(),
    anchorYmd = shanghaiToday(new Date(nowMs)),
    fetchImpl = fetch,
    expectedCity,
  } = {},
) {
  const station = WEATHER_STATIONS[code];
  const url = `https://www.weather.com.cn/weather/${code}.shtml`;
  assertAllowedWeatherUrl(url);

  const cacheFile = path.join(cacheDir, `weather-${code}.json`);
  if (!forceRefresh) {
    const cached = readCached(cacheFile, nowMs, cacheTtlMs);
    if (cached && cached.cityWeather) {
      return { ...cached.cityWeather, fromCache: true };
    }
  }

  const started = Date.now();
  const res = await fetchImpl(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    throw new Error(`WEATHER_HTTP_${res.status}: ${url}`);
  }
  const html = await res.text();
  const parsed = parseWeatherComCnHtml(html, {
    code,
    expectedCity: expectedCity ?? station?.titleMustInclude,
    anchorYmd,
  });
  const cityWeather = {
    ...parsed,
    fetchedAt: new Date(nowMs).toISOString(),
    latencyMs: Date.now() - started,
  };
  writeJsonAtomic(cacheFile, { fetchedAtMs: nowMs, cityWeather });
  return { ...cityWeather, fromCache: false };
}

export async function fetchWttrInCalibration(
  { lat, lng, label },
  {
    cacheDir = defaultWeatherCacheDir(),
    cacheTtlMs = WEATHER_CACHE_TTL_MS,
    forceRefresh = false,
    nowMs = Date.now(),
    fetchImpl = fetch,
  } = {},
) {
  const url = `https://wttr.in/${lat},${lng}?format=j1`;
  assertAllowedWeatherUrl(url);
  const safeKey = `${lat}_${lng}`.replace(/[^0-9._-]/g, "_");
  const cacheFile = path.join(cacheDir, `wttr-${safeKey}.json`);
  if (!forceRefresh) {
    const cached = readCached(cacheFile, nowMs, cacheTtlMs);
    if (cached && cached.calibration) return { ...cached.calibration, fromCache: true };
  }

  const res = await fetchImpl(url, {
    headers: { "User-Agent": "curl/8.0" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`WTTR_HTTP_${res.status}`);
  const payload = await res.json();
  const days = {};
  let maxChanceOfRain = 0;
  for (const dayEntry of payload?.weather ?? []) {
    const date = dayEntry?.date;
    if (!date) continue;
    const hourly = (dayEntry.hourly ?? []).map((h) => {
      const chance = Number(h.chanceofrain ?? 0);
      if (Number.isFinite(chance) && chance > maxChanceOfRain) maxChanceOfRain = chance;
      return {
        hour: Math.floor(Number(h.time ?? 0) / 100),
        tempC: Number(h.tempC),
        chanceOfRainPct: Number.isFinite(chance) ? chance : null,
        precipMM: Number(h.precipMM ?? 0),
        desc: h.weatherDesc?.[0]?.value ?? "",
      };
    });
    days[date] = {
      date,
      maxChanceOfRainPct: hourly.length ? Math.max(...hourly.map((x) => x.chanceOfRainPct ?? 0)) : null,
      totalPrecipMM: Number(hourly.reduce((sum, x) => sum + (x.precipMM || 0), 0).toFixed(1)),
      hourly,
    };
  }
  const calibration = {
    source: "wttr.in",
    label,
    lat,
    lng,
    fetchedAt: new Date(nowMs).toISOString(),
    maxChanceOfRainPct: maxChanceOfRain,
    days,
  };
  writeJsonAtomic(cacheFile, { fetchedAtMs: nowMs, calibration });
  return { ...calibration, fromCache: false };
}

export async function fetchQWeatherHourly(
  { lat, lng, label },
  { apiKey, apiHost = "devapi.qweather.com", fetchImpl = fetch } = {},
) {
  if (!apiKey) return null;
  const url = `https://${apiHost}/v7/weather/72h?location=${lng},${lat}&key=${encodeURIComponent(apiKey)}`;
  assertAllowedWeatherUrl(url);
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`QWEATHER_HTTP_${res.status}`);
  const data = await res.json();
  if (data?.code !== "200" || !Array.isArray(data.hourly)) {
    throw new Error(`QWEATHER_API_ERROR:${data?.code ?? "unknown"}`);
  }
  const hourly = data.hourly.map((h) => ({
    fxTime: h.fxTime,
    date: String(h.fxTime).slice(0, 10),
    hour: Number(String(h.fxTime).slice(11, 13)),
    tempC: Number(h.temp),
    precipProbabilityPct: Number(h.pop),
    precipMM: Number(h.precip ?? 0),
    text: h.text,
  }));
  const maxPop = hourly.length ? Math.max(...hourly.map((h) => h.precipProbabilityPct || 0)) : null;
  return {
    source: "qweather",
    label,
    lat,
    lng,
    maxChanceOfRainPct: maxPop,
    hourly,
  };
}

/**
 * Fetches weekend weather across all configured stations, optionally running Friday short-term
 * calibration (QWeather if key provided, else coordinate `wttr.in`).
 */
export async function fetchWeekendWeatherBundle({
  satDay,
  sunDay,
  stationCodes = DEFAULT_WEEKEND_STATION_CODES,
  isFridayRefresh = false,
  qweatherApiKey = process.env.QWEATHER_API_KEY || "",
  qweatherApiHost = process.env.QWEATHER_API_HOST || "devapi.qweather.com",
  cacheDir = defaultWeatherCacheDir(),
  forceRefresh = false,
  nowMs = Date.now(),
  fetchImpl = fetch,
} = {}) {
  const anchorYmd = shanghaiToday(new Date(nowMs));
  const cities = [];
  const calibrations = {};
  let precipProbabilityPct = null;
  let precipProbabilityStatus = "unconfirmed";
  let precipProbabilityNote = "当前免费公开 7 天与逐 3 小时预报不含精确降水概率百分比，按「短时降水概率待周五更新 · 预估」展示，不编造数值。";

  for (const code of stationCodes) {
    const station = WEATHER_STATIONS[code];
    if (!station) throw new Error(`UNKNOWN_WEATHER_STATION:${code}`);
    const cityWeather = await fetchWeatherComCnCity(code, {
      cacheDir,
      forceRefresh,
      nowMs,
      anchorYmd,
      fetchImpl,
      expectedCity: station.titleMustInclude,
    });

    const satSegs = cityWeather.hour3Segments[satDay] ?? [];
    const sunSegs = cityWeather.hour3Segments[sunDay] ?? [];
    const daysSummary = [
      summarizeDaySegments(satDay, "周六", satSegs),
      summarizeDaySegments(sunDay, "周日", sunSegs),
    ];

    const anyRain = daysSummary.some((d) => d.hasRainInDaytime);
    const weekendTip = anyRain
      ? `${station.city}周末白天局部时段提示有雨，建议查看 3 小时分段并优先安排室内备选。`
      : `${station.city}周末白天时段无降水信号，注意早晚温差。`;

    cities.push({
      city: station.city,
      code,
      sourceUrl: cityWeather.sourceUrl,
      daysSummary,
      hour3Segments: {
        [satDay]: satSegs.map(({ slot, condition, temp, windDir, windForce }) => ({ slot, condition, temp, windDir, windForce })),
        [sunDay]: sunSegs.map(({ slot, condition, temp, windDir, windForce }) => ({ slot, condition, temp, windDir, windForce })),
      },
      weekendTip,
      latencyMs: cityWeather.latencyMs,
      fromCache: cityWeather.fromCache,
    });

    if (isFridayRefresh) {
      try {
        if (qweatherApiKey) {
          const qw = await fetchQWeatherHourly(
            { lat: station.lat, lng: station.lng, label: station.city },
            { apiKey: qweatherApiKey, apiHost: qweatherApiHost, fetchImpl },
          );
          if (qw) {
            calibrations[code] = qw;
            const wkHours = qw.hourly.filter((h) => (h.date === satDay || h.date === sunDay) && h.hour >= 8 && h.hour <= 20);
            if (wkHours.length > 0) {
              const wkMax = Math.max(...wkHours.map((h) => h.precipProbabilityPct || 0));
              precipProbabilityPct = precipProbabilityPct === null ? wkMax : Math.max(precipProbabilityPct, wkMax);
              precipProbabilityStatus = "verified";
              precipProbabilityNote = "已结合和风天气 72 小时逐时降水概率完成周五短时校准。";
            }
          }
        } else {
          const wttr = await fetchWttrInCalibration(
            { lat: station.lat, lng: station.lng, label: station.city },
            { cacheDir, forceRefresh, nowMs, fetchImpl },
          );
          calibrations[code] = wttr;
          const wkPops = [satDay, sunDay]
            .flatMap((d) => wttr.days?.[d]?.hourly ?? [])
            .filter((h) => h.hour >= 8 && h.hour <= 20)
            .map((h) => h.chanceOfRainPct)
            .filter((v) => typeof v === "number" && Number.isFinite(v));
          if (wkPops.length > 0) {
            const wkMax = Math.max(...wkPops);
            precipProbabilityPct = precipProbabilityPct === null ? wkMax : Math.max(precipProbabilityPct, wkMax);
            precipProbabilityStatus = "estimated";
            precipProbabilityNote = "已于周五叠加经纬度坐标 48 小时短时降水概率校准（预估）。";
          }
        }
      } catch (err) {
        calibrations[code] = { error: err instanceof Error ? err.message : String(err) };
      }
    }
  }

  return {
    testedAt: new Date(nowMs).toISOString(),
    primarySourceLabel: "中国天气网 7 天与逐 3 小时预报",
    secondarySourceLabel: isFridayRefresh
      ? (qweatherApiKey ? "周五 72h 和风天气短时降水概率校准" : "周五坐标 48h 短时天气校准")
      : "待周五 17:30 短时校准（当前无逐时降水百分比）",
    precipProbabilityPct,
    precipProbabilityStatus,
    precipProbabilityNote,
    horizonConfidence: isFridayRefresh ? "high" : "medium",
    horizonConfidenceLabel: isFridayRefresh ? "周五 48 小时内短时校准（置信度高）" : "周中 3–4 天预报（周五傍晚将再次校准）",
    fridayRefreshHint: cities.map((c) => `${c.city}：${c.daysSummary.map((d) => d.summary).join("；")}`).join("｜"),
    cities,
    calibrations,
  };
}
