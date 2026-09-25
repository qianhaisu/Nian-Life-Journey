#!/usr/bin/env node
// 旅程页的照片精选（Teddy 2026-09-25，只针对「从美国回家」：「洛杉矶的照片不行，已经放的照片有重复场景的去掉一些，
// 多放一些其他的，分数不够高的也尽量放一些」）。
//
// 分工照 CLAUDE.md：
//   · GLM 给每张照片贴固定选项的场景标签（在哪里 / 在做什么 / 有谁）和「好看、有意思」分数，并标隐私；
//   · 本地程序只按标签分组、按配额挑选，不看画面。
// 标签全部存进 data/photo-scene-tags.json（含模型名、提示词版本），再跑只补缺的。
//
// 候选：
//   A 这段旅程每天日页上已经放的首屏照片（他本人，主体核查过）；
//   B 同一段日子里「不是以他为主体」、且来自我们自己（自家相册或爸爸妈妈在微信发的）的照片——那段日子的生活画面。
// 挑选：同一种场景（在哪里 + 在做什么）整段最多留 2 张，挑分高、时间隔得开的；B 只收好看、清楚、没有隐私和陌生人大脸的。
// 结果写进 lib/travel/curation.json，旅程页用它替代这段旅程每天的首屏照片。
//
//   node .data/run-on-rds.mjs scripts/editor/travel-curate.mjs --trip 2025-01-losangeles --content-dir .data/travel/content-live [--dry-run]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import sharp from "sharp";
import { judgeVisionProbe, looksBlind } from "../../lib/home-photo-quality.ts";
import { NIANLIFE_GLM_BASE_URL, NIANLIFE_GLM_MODEL, assertGlmProviderModel } from "../../lib/organizer/glm-model.ts";
import { labelForSender } from "./identity-rules.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const V2 = path.resolve(__dirname, "../..");
const option = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const TRIP_ID = option("--trip");
const CONTENT_DIR = path.resolve(V2, option("--content-dir") ?? ".data/travel/content-live");
const DRY = process.argv.includes("--dry-run");
const SITE = process.env.NIANLIFE_SITE ?? "https://nianlife.cn";
const CACHE = path.join(V2, ".data/travel/scenery-cache");
const TAGS = path.join(V2, "data/photo-scene-tags.json");
const OUT = path.join(V2, "lib/travel/curation.json");
const PROMPT_VERSION = "travel-scene-tags-v1";
const PER_SCENE = 2;
const MIN_APPEAL_B = 50;

function loadEnv() {
  const env = { ...process.env };
  for (const line of fs.readFileSync(path.join(V2, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
const ENV = loadEnv();
const KEY = ENV.ZHIPU_API_KEY;
const MODEL = NIANLIFE_GLM_MODEL;
const BASE = (ENV.ZHIPU_BASE_URL ?? NIANLIFE_GLM_BASE_URL).replace(/\/$/, "");
if (!TRIP_ID) { console.error("--trip <旅程 id> 是必需的"); process.exit(2); }
if (!KEY) { console.error("缺 ZHIPU_API_KEY"); process.exit(2); }
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required（经 .data/run-on-rds.mjs 跑）"); process.exit(2); }

const PLACES = ["医院", "卧室", "客厅", "厨房", "浴室", "车内", "户外", "商店", "机场", "餐厅", "其他室内"];
const ACTIVITIES = ["睡觉", "喝奶", "被抱着", "躺着醒着", "趴着", "洗澡", "换尿布", "推车里", "看镜头", "和大人互动", "物品", "风景", "食物", "宠物", "其他"];
const PROMPT = `这是一个家庭相册里的一张照片，拍于一个新生儿出生后的头一个多月（在美国洛杉矶，之后回国）。只看这一张图，只输出一个 JSON 对象，键必须齐全：
{"place": ${JSON.stringify(PLACES).replace(/,/g, " | ")},
 "activity": ${JSON.stringify(ACTIVITIES).replace(/,/g, " | ")},
 "who": "只有宝宝" | "宝宝和大人" | "只有大人" | "没有人",
 "appeal": 0-100,
 "sharp": true | false,
 "stranger_faces": true | false,
 "sensitive": "none" | "nudity_or_bath" | "health" | "finance" | "identity_document",
 "caption": "不超过12个汉字"}
定义：place 和 activity 只能从给出的选项里选一个最贴切的。
appeal = 放进「刚出生那一个多月」的回看相册里有多好看、多有意思：画面清楚、构图好、有情绪或有那段日子的生活气息（圣诞树、年夜饭、行李箱、窗外风景）给高分；
尿布污渍、药品、票据、奶粉罐堆、模糊的随手拍给低分。
stranger_faces = 有能认清脸、且脸占画面比较大的人。sensitive：裸露或洗澡、病历检查、钱款、证件。`;

const img = (buf) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${buf.toString("base64")}` } });
let calls = 0, inTok = 0, outTok = 0;
async function ask(content, maxTokens = 8000) {
  calls += 1;
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: [{ role: "user", content }] }),
    signal: AbortSignal.timeout(180_000),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 160)}`);
  const body = JSON.parse(raw);
  assertGlmProviderModel(MODEL, body);
  const choice = body.choices?.[0];
  if (choice?.finish_reason === "length") throw new Error("回答被 max_tokens 截断");
  inTok += body.usage?.prompt_tokens ?? 0; outTok += body.usage?.completion_tokens ?? 0;
  return { text: String(choice?.message?.content ?? "").trim(), model: body.model };
}
async function fetchImage(id) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, encodeURIComponent(id) + ".img");
  if (!fs.existsSync(file)) {
    const res = await fetch(`${SITE}/api/media/${encodeURIComponent(id)}?variant=web`, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`取图 HTTP ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return sharp(file, { failOn: "none" }).rotate().resize(768, 768, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
}

// ── 候选 ─────────────────────────────────────────────────────────────────────
const trip = JSON.parse(fs.readFileSync(path.join(V2, "lib/travel/trips.json"), "utf8")).trips.find((t) => t.id === TRIP_ID);
if (!trip) { console.error(`没有旅程 ${TRIP_ID}`); process.exit(2); }
const days = [];
for (let d = Date.parse(trip.from + "T00:00:00Z"); d <= Date.parse(trip.to + "T00:00:00Z"); d += 864e5) days.push(new Date(d).toISOString().slice(0, 10));
const dayEntry = new Map();
for (const month of [...new Set(days.map((d) => d.slice(0, 7)))]) {
  const file = path.join(CONTENT_DIR, `${month}.json`);
  if (!fs.existsSync(file)) continue;
  for (const d of JSON.parse(fs.readFileSync(file, "utf8")).days) if (days.includes(d.day)) dayEntry.set(d.day, d);
}
const A = [...dayEntry.values()].flatMap((d) => d.firstScreenMediaIds.map((id) => ({ id, day: d.day, pool: "A" })));

const verdicts = JSON.parse(fs.readFileSync(path.join(V2, "data/photo-scenery.json"), "utf8"));
const bIds = Object.entries(verdicts).filter(([, x]) => days.includes(x.day) && !["child", "screenshot", "document", "filtered"].includes(x.kind)).map(([id]) => id);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const meta = (await client.query(`select m.id, m.type, to_char(m.taken_at, 'YYYY-MM-DD"T"HH24:MI:SS') as taken_at, rs.source_type, rs.metadata->>'senderDigest' as sender, rs.metadata->>'conversationId' as conv_id
  from media m left join raw_sources rs on rs.id = m.raw_source_id where m.id = any($1)`, [[...A.map((a) => a.id), ...bIds]])).rows;
await client.end();
const metaById = new Map(meta.map((m) => [m.id, m]));
const TRAVELLERS = new Set(["爸爸", "妈妈"]);
const ours = (m) => m && (m.source_type === "family_photo" || (m.sender && TRAVELLERS.has(labelForSender(m.sender, m.conv_id) ?? "")));
const B = bIds.filter((id) => ours(metaById.get(id))).map((id) => ({ id, day: verdicts[id].day, pool: "B" }));
const candidates = [...A, ...B].filter((c) => metaById.get(c.id)?.type !== "video");

const tags = fs.existsSync(TAGS) ? JSON.parse(fs.readFileSync(TAGS, "utf8")) : {};
const todo = candidates.filter((c) => !tags[c.id] || tags[c.id].promptVersion !== PROMPT_VERSION || tags[c.id].error);
console.log(JSON.stringify({ trip: TRIP_ID, days: days.length, dayPages: dayEntry.size, poolA: A.length, poolB: B.length, alreadyTagged: candidates.length - todo.length, toTag: todo.length, model: MODEL }));
if (DRY) process.exit(0);

// ── 能力门 + 贴标签 ────────────────────────────────────────────────────────────
if (todo.length) {
  for (const [rgb, name] of [[{ r: 255, g: 140, b: 0 }, "orange"], [{ r: 20, g: 60, b: 230 }, "blue"]]) {
    const png = await sharp({ create: { width: 96, height: 96, channels: 3, background: rgb } }).jpeg().toBuffer();
    const say = await ask([img(png), { type: "text", text: "Reply with ONLY the colour word on the first line." }], 2000);
    const v = judgeVisionProbe(say.text, name);
    if (!v.capable) { console.error(`能力门没过（${name}）：${v.reason}；整批中止，什么都没写`); process.exit(3); }
  }
  console.log("能力门通过");
}
async function tag(c) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const say = await ask([img(await fetchImage(c.id)), { type: "text", text: PROMPT }]);
      if (looksBlind(say.text)) throw new Error("blind answer");
      const json = JSON.parse(say.text.slice(say.text.indexOf("{"), say.text.lastIndexOf("}") + 1));
      for (const k of ["place", "activity", "who", "appeal", "sharp", "stranger_faces", "sensitive", "caption"]) if (!(k in json)) throw new Error(`missing ${k}`);
      if (!PLACES.includes(json.place)) json.place = "其他室内";
      if (!ACTIVITIES.includes(json.activity)) json.activity = "其他";
      return { ...json, day: c.day, model: say.model, promptVersion: PROMPT_VERSION, at: new Date().toISOString() };
    } catch (error) {
      if (/"code":"1301"/.test(String(error.message))) return { filtered: true, day: c.day, model: MODEL, promptVersion: PROMPT_VERSION, at: new Date().toISOString() };
      if (attempt === 3) return { error: String(error.message ?? error).slice(0, 160), day: c.day, promptVersion: PROMPT_VERSION };
    }
  }
}
let next = 0, streak = 0, done = 0, stopped = false;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (!stopped && next < todo.length) {
    const c = todo[next++];
    const r = await tag(c);
    tags[c.id] = r;
    streak = r.error ? streak + 1 : 0;
    if (streak >= 5) { stopped = true; console.error("连续失败 5 次，停止：", r.error); }
    if (++done % 25 === 0) { fs.writeFileSync(TAGS, JSON.stringify(tags, null, 1)); console.log(`已标 ${done}/${todo.length}`); }
  }
}));
fs.writeFileSync(TAGS, JSON.stringify(tags, null, 1));

// ── 挑选（本地，只看标签） ───────────────────────────────────────────────────────
const usable = (c) => {
  const t = tags[c.id];
  if (!t || t.error || t.filtered || t.sensitive !== "none") return false;
  if (c.pool === "B") return t.sharp === true && t.stranger_faces === false && Number(t.appeal) >= MIN_APPEAL_B;
  return true;
};
const takenAt = (c) => metaById.get(c.id)?.taken_at ?? c.day;
const groups = new Map();
for (const c of candidates.filter(usable)) {
  const t = tags[c.id];
  const key = `${t.place}|${t.activity}`;
  (groups.get(key) ?? groups.set(key, []).get(key)).push(c);
}
// 排序分：生活画面取两轮打分里高的那个（风景那一轮的 scenic 更懂风景，比如 85 分的夕阳牧场）
const score = (c) => Math.max(Number(tags[c.id].appeal) || 0, c.pool === "B" ? Number(verdicts[c.id]?.scenic) || 0 : 0);
const chosen = new Set();
for (const [, list] of groups) {
  // 同一种场景：先挑分最高的，再挑离它最远的日子里分最高的——整段只留 PER_SCENE 张，而且隔得开
  const sorted = [...list].sort((a, b) => score(b) - score(a));
  const first = sorted[0];
  chosen.add(first.id);
  if (PER_SCENE > 1 && sorted.length > 1) {
    // 第二张必须在别的日子（同一天两张同场景就是重复）；能隔一周以上更好
    const otherDays = sorted.slice(1).filter((c) => c.day !== first.day);
    const far = otherDays.filter((c) => Math.abs(Date.parse(c.day) - Date.parse(first.day)) >= 7 * 864e5);
    const second = (far.length ? far : otherDays).sort((a, b) => score(b) - score(a))[0];
    if (second && score(second) >= 40) chosen.add(second.id);
  }
}
const byDay = {};
for (const c of candidates) if (chosen.has(c.id)) (byDay[c.day] ??= []).push(c);
for (const day of Object.keys(byDay)) byDay[day] = byDay[day].sort((a, b) => takenAt(a).localeCompare(takenAt(b))).map((c) => ({ id: c.id, pool: c.pool, scene: `${tags[c.id].place}·${tags[c.id].activity}`, appeal: Number(tags[c.id].appeal), caption: String(tags[c.id].caption).slice(0, 16) }));

const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { trips: {} };
existing._comment = "旅程页的照片精选，由 scripts/editor/travel-curate.mjs 生成（GLM 贴场景标签，本地按标签配额挑选），不要手改。旅程页用它替代这段旅程每天的首屏照片。";
existing.trips[TRIP_ID] = {
  model: MODEL, promptVersion: PROMPT_VERSION, assessedAt: new Date().toISOString(),
  rule: `同一种场景（在哪里·在做什么）整段最多 ${PER_SCENE} 张；生活画面只收我们自己拍的、清楚、无隐私无陌生人大脸、有意思分 ≥ ${MIN_APPEAL_B}`,
  byDay: Object.fromEntries(Object.entries(byDay).sort()),
};
fs.writeFileSync(OUT, JSON.stringify(existing, null, 1));
const count = (p) => Object.values(byDay).flat().filter((x) => x.pool === p).length;
console.log(JSON.stringify({ calls, inputTokens: inTok, outputTokens: outTok, scenes: groups.size, chosenPortraits: count("A"), chosenLife: count("B"), before: A.length, daysWithPhotos: Object.keys(byDay).length, stopped }));
