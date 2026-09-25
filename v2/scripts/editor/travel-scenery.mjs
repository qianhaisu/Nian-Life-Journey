#!/usr/bin/env node
// 旅行风景白名单（Teddy 2026-09-25：「旅行页的每段和旅程详情照片可以放部分风景照，不用全部都是张年的照片」
// 「如果要分析照片，调用 glm，不要全部你自己看」）。
//
// 站上的照片默认都要过「是不是张年」的主体核查，没有他的照片（风景也是）不给看。这里为旅行页单独开一个口子：
// 只有 GLM 判为「好看的风景、没有陌生人大脸、没有截图单据、没有隐私」的照片，才进 lib/travel/scenery.json，
// 旅行页（且只有旅行页）凭这份名单放它们出来。
//
// 范围有界：只看旅程覆盖的那些天；主体核查不是 approved 的照片，加上 approved 但首页评分说他不是画面主体（或未评分）的，
// 加上自家相册原片（family_photo）的全部照片。
// 复用：每张的结论记在 data/photo-scenery.json（含模型名，随仓库提交），再跑只补缺的，不重复付费识图。
// 能力门：先给模型看两张纯色图，答错颜色整批中止，什么都不写。连续失败 5 次停。
//
//   node .data/run-on-rds.mjs scripts/editor/travel-scenery.mjs [--limit N] [--dry-run]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import sharp from "sharp";
import { judgeVisionProbe, looksBlind } from "../../lib/home-photo-quality.ts";
import { NIANLIFE_GLM_BASE_URL, NIANLIFE_GLM_MODEL, assertGlmProviderModel } from "../../lib/organizer/glm-model.ts";
import { groupScenes } from "./scene-curation.mjs";
import { labelForSender } from "./identity-rules.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const V2 = path.resolve(__dirname, "../..");
const option = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const LIMIT = Number(option("--limit") ?? 0) || Infinity;
const DRY = process.argv.includes("--dry-run");
const SITE = process.env.NIANLIFE_SITE ?? "https://nianlife.cn";
const WORK = path.join(V2, ".data/travel");
const CACHE = path.join(WORK, "scenery-cache");
// 每一张的判断都留下来，随仓库提交（Teddy 2026-09-25：「这次判断的结果也要存，每次判断都不能白判断」）。
// 不只是过线的风景：截图、单据、以他为主体、被过滤……全部结论连同模型名、提示词版本、时间都在这里，
// 别的功能要用同一类判断时直接读，不再花钱重判。旧位置 .data/travel/scenery-results.json 只作迁移来源。
const RESULTS = path.join(V2, "data/photo-scenery.json");
const LEGACY_RESULTS = path.join(WORK, "scenery-results.json");
const OUT = path.join(V2, "lib/travel/scenery.json");
export const SCENERY_PROMPT_VERSION = "travel-scenery-v1";

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
if (!KEY) { console.error("缺 ZHIPU_API_KEY"); process.exit(2); }
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required（经 .data/run-on-rds.mjs 跑）"); process.exit(2); }
const MODEL = NIANLIFE_GLM_MODEL;
const BASE = (ENV.ZHIPU_BASE_URL ?? NIANLIFE_GLM_BASE_URL).replace(/\/$/, "");

const PROMPT = `你在帮一个家庭的旅行相册挑风景照。只看这一张图，只输出一个 JSON 对象，不要任何其他文字，键必须齐全：
{"kind": "scenery" | "landmark" | "food" | "people" | "child" | "indoor" | "screenshot" | "document" | "object" | "other",
 "scenic": 0-100,
 "sharp": true | false,
 "stranger_faces": true | false,
 "text_heavy": true | false,
 "sensitive": "none" | "nudity_or_bath" | "health" | "finance" | "identity_document",
 "caption": "不超过12个汉字，说清画面里是什么地方或景色"}
定义：
- scenery = 自然风光、城市街景、湖海山川、公园、古镇街巷等以「地方」为主体的照片；landmark = 能认出的景点或建筑；
  people = 以成年人为主体；child = 以小孩为主体（哪怕背景很美）；indoor = 普通室内、车内、酒店房间；
  screenshot = 手机或屏幕截图；document = 纸张、票据、菜单、告示等以文字为主。
- scenic = 作为「这次旅行去了哪里」的风景照有多好看：构图、光线、清晰度、能看出是什么地方。随手拍的地面、模糊、过暗给低分。
- stranger_faces = 画面里有能认清脸的人，且脸占画面比较大。远处的小人影不算。
- text_heavy = 大面积文字（招牌不算，告示、单据、截图算）。`;

const img = (buf) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${buf.toString("base64")}` } });
let calls = 0, inTok = 0, outTok = 0;
async function ask(content, maxTokens = 8000) {
  calls += 1;
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${KEY}` },
    // glm-5.3-flash 是推理模型：reasoning token 计入 max_tokens，上限不够时正文是空串
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: [{ role: "user", content }] }),
    signal: AbortSignal.timeout(180_000),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 160)}`);
  const body = JSON.parse(raw);
  assertGlmProviderModel(MODEL, body); // 请求和返回的模型标识都要对得上
  const choice = body.choices?.[0];
  if (choice?.finish_reason === "length") throw new Error("回答被 max_tokens 截断");
  inTok += body.usage?.prompt_tokens ?? 0; outTok += body.usage?.completion_tokens ?? 0;
  return { text: String(choice?.message?.content ?? "").trim(), model: body.model };
}

const TOPICS = JSON.parse(fs.readFileSync(path.join(V2, "data/photo-topics.json"), "utf8")).topics ?? {};
// ── 1. 候选：旅程那些天、主体核查不是 approved 的照片，加上 approved 但他不是主体的 ────────────────────────────────
const trips = JSON.parse(fs.readFileSync(path.join(V2, "lib/travel/trips.json"), "utf8")).trips;
const days = new Set();
for (const t of trips) for (let d = Date.parse(t.from + "T00:00:00Z"); d <= Date.parse(t.to + "T00:00:00Z"); d += 864e5) days.add(new Date(d).toISOString().slice(0, 10));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const rows = (await client.query(`
  with last as (select distinct on (target_id) target_id, decision from content_quality_reviews where target_kind = 'media_subject_check' order by target_id, reviewed_at desc)
  select m.id, to_char(m.taken_at, 'YYYY-MM-DD') as day, to_char(m.taken_at, 'YYYY-MM-DD"T"HH24:MI:SS') as taken_at, coalesce(l.decision, 'none') as decision,
         rs.source_type, rs.metadata->>'senderDigest' as sender, rs.metadata->>'conversationId' as conv_id
  from media m left join last l on l.target_id = m.id left join raw_sources rs on rs.id = m.raw_source_id
  where m.type = 'photo' and m.visibility <> 'private' and to_char(m.taken_at, 'YYYY-MM-DD') = any($1)
  order by m.taken_at, m.id`, [[...days]])).rows.filter((r) => {
    // 主体核查 approved = 照片里有他。其中首页评分说「他不是主体」或还没评过的，常常是风景里远远站着一个他
    // （Teddy 2026-09-25：「风景照具体行程可以多放一些」）——也交给 GLM 看一眼；他是主体的不看。
    if (r.decision !== "approved") return true;
    // 自家相册原片全部看一遍（Teddy 2026-09-25：「把自家相册里旅程那些天的所有照片都交给 GLM 再看一遍」）
    if (r.source_type === "family_photo") return true;
    const carousel = TOPICS[r.id]?.carousel;
    return !carousel || carousel.childMain !== true;
  });
await client.end();

const results = fs.existsSync(RESULTS) ? JSON.parse(fs.readFileSync(RESULTS, "utf8")) : fs.existsSync(LEGACY_RESULTS) ? JSON.parse(fs.readFileSync(LEGACY_RESULTS, "utf8")) : {};
const todo = rows.filter((r) => !results[r.id] || results[r.id].promptVersion !== SCENERY_PROMPT_VERSION || results[r.id].error).slice(0, LIMIT);
console.log(JSON.stringify({ tripDays: days.size, candidates: rows.length, alreadyJudged: rows.length - todo.length, toJudge: todo.length, model: MODEL }));
if (DRY) process.exit(0);

// ── 2. 能力门 ───────────────────────────────────────────────────────────────────
if (todo.length) {
  for (const [rgb, name] of [[{ r: 255, g: 140, b: 0 }, "orange"], [{ r: 20, g: 60, b: 230 }, "blue"]]) {
    const png = await sharp({ create: { width: 96, height: 96, channels: 3, background: rgb } }).jpeg().toBuffer();
    const say = await ask([img(png), { type: "text", text: "Reply with ONLY the colour word on the first line." }], 2000);
    const v = judgeVisionProbe(say.text, name);
    if (!v.capable) { console.error(`能力门没过（${name}）：${v.reason}；整批中止，什么都没写`); process.exit(3); }
  }
  console.log("能力门通过");
}

// ── 3. 逐张判断（并发 4，连续失败 5 次停） ────────────────────────────────────────
fs.mkdirSync(CACHE, { recursive: true });
async function fetchImage(id) {
  const file = path.join(CACHE, encodeURIComponent(id) + ".img");
  if (!fs.existsSync(file)) {
    const res = await fetch(`${SITE}/api/media/${encodeURIComponent(id)}?variant=web`, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`取图 HTTP ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return sharp(file, { failOn: "none" }).rotate().resize(768, 768, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
}
async function judge(row) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const buf = await fetchImage(row.id);
      const say = await ask([img(buf), { type: "text", text: PROMPT }]);
      if (looksBlind(say.text)) throw new Error("blind answer");
      const json = JSON.parse(say.text.slice(say.text.indexOf("{"), say.text.lastIndexOf("}") + 1));
      for (const k of ["kind", "scenic", "sharp", "stranger_faces", "text_heavy", "sensitive", "caption"]) if (!(k in json)) throw new Error(`missing ${k}`);
      return { ...json, model: say.model, promptVersion: SCENERY_PROMPT_VERSION, day: row.day, at: new Date().toISOString() };
    } catch (error) {
      // 智谱的内容安全过滤（1301）拒答：这张图本身就不适合放上旅行页，记为 filtered，不重试、不算失败
      if (/"code":"1301"/.test(String(error.message))) return { kind: "filtered", scenic: 0, model: MODEL, promptVersion: SCENERY_PROMPT_VERSION, day: row.day, at: new Date().toISOString() };
      if (attempt === 3) return { error: String(error.message ?? error).slice(0, 160), promptVersion: SCENERY_PROMPT_VERSION, day: row.day };
    }
  }
}
let next = 0, streak = 0, done = 0, stopped = false;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (!stopped && next < todo.length) {
    const row = todo[next++];
    const r = await judge(row);
    results[row.id] = r;
    streak = r.error ? streak + 1 : 0;
    if (streak >= 5) { stopped = true; console.error("连续失败 5 次，停止：", r.error); }
    if (++done % 25 === 0) { fs.writeFileSync(RESULTS, JSON.stringify(results, null, 1)); console.log(`已判 ${done}/${todo.length}`); }
  }
}));
fs.writeFileSync(RESULTS, JSON.stringify(results, null, 1));

// ── 4. 白名单：不设总数，同一个场景只留一张（Teddy 2026-09-25：「具体行程可以多放一些，没有总张数限制，但是尽量不要重复场景」） ──
// 分工照 CLAUDE.md：本地只按拍摄时间把相隔 <= 20 分钟的风景串成候选组（groupScenes），
// 组里是不是同一个场景、每个场景留哪张，交给 GLM（dedupeScenery）。它的结论也存进仓库（data/photo-scenery-scenes.json），
// 同一组照片下次直接用，不重判。
export function sceneryAccepted(r) {
  return !!r && !r.error && (r.kind === "scenery" || r.kind === "landmark") && Number(r.scenic) >= 70
    && r.sharp === true && r.stranger_faces === false && r.text_heavy === false && r.sensitive === "none";
}
const SCENES = path.join(V2, "data/photo-scenery-scenes.json");
const sceneStore = fs.existsSync(SCENES) ? JSON.parse(fs.readFileSync(SCENES, "utf8")) : {};
// v2（2026-09-25）：v1 把「同一个取景方向」才算同一场景，兵马俑一号坑三张、蒙特雷牧场三张都被当成不同场景留下了。
const SCENE_PROMPT_VERSION = "travel-scenery-scenes-v2";

async function dedupeScenery(group) {
  const shots = await Promise.all(group.map((g) => fetchImage(g.id)));
  const text = `这 ${group.length} 张风景照是同一天、前后几十分钟内拍的，按时间编号 0 到 ${group.length - 1}。
把它们按「是不是同一个场景」分组。判断要严：同一个地方、同一个主要景物（同一片牧场、同一个坑、同一片海滩、同一栋建筑）就算同一个场景，
哪怕换了角度、远近、横竖、光线也一样；只有真的换了地方或换了主要景物（从牧场到城市、从兵马俑到钟楼）才算不同场景。
每个场景只留一张最好看的（构图、光线、清晰度）。拿不准的时候按同一个场景处理——宁可少留，不要重复。只输出 JSON：{"keep": [每个场景留下的那张的编号，一个场景一个], "why": "不超过20字"}`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const say = await ask([...shots.map((b) => img(b)), { type: "text", text }]);
      if (looksBlind(say.text)) throw new Error("blind answer");
      const json = JSON.parse(say.text.slice(say.text.indexOf("{"), say.text.lastIndexOf("}") + 1));
      const keep = [...new Set((Array.isArray(json.keep) ? json.keep : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < group.length))];
      if (!keep.length) throw new Error("keep 为空");
      return { keep: keep.map((n) => group[n].id), why: String(json.why ?? "").slice(0, 40), model: say.model, promptVersion: SCENE_PROMPT_VERSION, at: new Date().toISOString() };
    } catch (error) {
      if (/"code":"1301"/.test(String(error.message)) || attempt === 2) return null;
    }
  }
  return null;
}

// 来源门：风景得是「我们这趟旅程」拍的。微信照片的时间是消息发送时间，群里转来别人的度假照也会落在旅程那天
// （2026-09-25 第一轮：奶奶在群里发的海南海滩 6 张、一个未登记的人发的球馆夜景，都混进了名单）。
// 所以只收：自家相册原片（family_photo），或者微信里爸爸、妈妈发的。
const TRAVELLERS = new Set(["爸爸", "妈妈"]);
export function fromOurTrip(row) {
  if (row.source_type === "family_photo") return true;
  const who = row.sender ? labelForSender(row.sender, row.conv_id) : undefined;
  return !!who && TRAVELLERS.has(who);
}
const acceptedByDay = {};
let notOurs = 0;
for (const row of rows) {
  const r = results[row.id];
  if (!sceneryAccepted(r)) continue;
  if (!fromOurTrip(row)) { notOurs++; continue; }
  // 合影不是风景：微信里别人拍的合影，画面主体是人、身份也未必确认得了（抽检 2025-10-04「山间瀑布前合影」是两位认不出的老人）。
  // 自家相册里的合影（安福路路牌前，妈妈推着他）是我们自己的旅途照，照收。
  if (row.source_type !== "family_photo" && /合影|留影/.test(String(r.caption))) { notOurs++; continue; }
  (acceptedByDay[row.day] ??= []).push({ id: row.id, type: "photo", takenAt: row.taken_at, scenic: Number(r.scenic), caption: String(r.caption).slice(0, 16) });
}
const byDay = {};
let sceneCalls = 0, sceneReused = 0, sceneFailed = 0;
for (const [day, list] of Object.entries(acceptedByDay).sort()) {
  const kept = [];
  for (const group of groupScenes(list, { windowMinutes: 20 })) {
    if (group.length === 1) { kept.push(group[0]); continue; }
    const key = group.map((g) => g.id).sort().join("|");
    let verdict = sceneStore[key];
    if (verdict?.promptVersion === SCENE_PROMPT_VERSION) sceneReused++;
    else { verdict = await dedupeScenery(group); sceneCalls++; if (verdict) sceneStore[key] = verdict; }
    if (!verdict) {
      // 模型没给出结论：保守地只留这一组里分最高的一张，宁可少放也不重复
      sceneFailed++;
      kept.push([...group].sort((a, b) => b.scenic - a.scenic)[0]);
      continue;
    }
    for (const id of verdict.keep) { const g = group.find((x) => x.id === id); if (g) kept.push(g); }
  }
  byDay[day] = kept.sort((a, b) => String(a.takenAt).localeCompare(String(b.takenAt))).map(({ id, scenic, caption }) => ({ id, scenic, caption }));
}
fs.writeFileSync(SCENES, JSON.stringify(sceneStore, null, 1));
const accepted = Object.values(byDay).reduce((n, l) => n + l.length, 0);
fs.writeFileSync(OUT, JSON.stringify({
  _comment: "旅行风景白名单，由 scripts/editor/travel-scenery.mjs 生成（GLM 判定 + GLM 同场景去重），不要手改。只有旅行页读它。",
  model: MODEL, promptVersion: SCENERY_PROMPT_VERSION, scenePromptVersion: SCENE_PROMPT_VERSION, assessedAt: new Date().toISOString(),
  rule: "kind ∈ {scenery, landmark} · scenic ≥ 70 · sharp · no stranger faces · not text-heavy · sensitive none · 来源：自家相册原片或爸爸妈妈在微信发的 · 同一场景只留一张 · 不设总数",
  byDay,
}, null, 1));
const kinds = {};
for (const r of Object.values(results)) kinds[r.error ? "error" : r.kind] = (kinds[r.error ? "error" : r.kind] ?? 0) + 1;
console.log(JSON.stringify({ calls, inputTokens: inTok, outputTokens: outTok, judged: Object.keys(results).length, kinds, notOurs, acceptedBeforeDedupe: Object.values(acceptedByDay).reduce((n, l) => n + l.length, 0), accepted, acceptedDays: Object.keys(byDay).length, sceneCalls, sceneReused, sceneFailed, stopped }));
