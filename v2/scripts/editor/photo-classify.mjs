// 照片识别（2026-09-23 起 glm-5.3-flash 看图，此前 deepseek-flash）。是 .data/ds-photo-classify.mjs 的可 import 版本，提示词与字段定义一字不改，
// 这样夜间流程用的就是 2026-09-16/17 那批人工流程用过的同一套判定输入。
// 每次调用开始先过能力门（合成色块）：答错就整批中止，不写任何东西。凭据只在进程内读，不打印。
// 需要 node --import tsx 运行（引用了 .ts）。
import fs from "node:fs";
import sharp from "sharp";
import { judgeVisionProbe, looksBlind } from "../../lib/home-photo-quality.ts";
import { assertProviderModel, resolveDeepSeekModel } from "../../lib/organizer/deepseek-model.ts";
import { NIANLIFE_GLM_BASE_URL, assertGlmProviderModel, resolveGlmModel } from "../../lib/organizer/glm-model.ts";

const ENV_FILE = new URL("../../.env.local", import.meta.url);

function loadEnv() {
  const env = { ...process.env };
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const img = (buf, type = "image/jpeg") => ({ type: "image", source: { type: "base64", media_type: type, data: buf.toString("base64") } });
const shrink = (file, px) => sharp(file, { failOn: "none" }).rotate().resize(px, px, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();

// 2026-09-23：看图默认走智谱 glm-5.3-flash（OpenAI 兼容端点，AI_PROVIDER=zhipu）。DeepSeek 分支保留。
// 两边都用 Anthropic 形状的 content 块描述请求（img() / {type:"text"}），发 GLM 前转成 image_url。
function modelConfig(ENV) {
  if ((ENV.AI_PROVIDER ?? "").toLowerCase() === "zhipu") {
    return { glm: true, MODEL: resolveGlmModel(ENV), BASE: (ENV.ZHIPU_BASE_URL ?? NIANLIFE_GLM_BASE_URL).replace(/\/$/, ""), KEY: ENV.ZHIPU_API_KEY };
  }
  return { glm: false, MODEL: resolveDeepSeekModel(ENV), BASE: (ENV.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/anthropic").replace(/\/$/, ""), KEY: ENV.DEEPSEEK_API_KEY };
}

const toGlmPart = (b) => b.type === "image" ? { type: "image_url", image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } } : b;

/** 一次看图调用，返回正文与用量。被 max_tokens 截断、模型不符、HTTP 错误都抛错。 */
async function askModel(cfg, content, maxTokens) {
  const res = cfg.glm
    ? await fetch(`${cfg.BASE}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${cfg.KEY}` },
      // glm-5.3-flash 是推理模型：reasoning token 计入 max_tokens，上限不够时正文是空串。
      body: JSON.stringify({ model: cfg.MODEL, max_tokens: Math.max(maxTokens, 8000), messages: [{ role: "user", content: content.map(toGlmPart) }] }),
      signal: AbortSignal.timeout(180_000),
    })
    : await fetch(`${cfg.BASE}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": cfg.KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: cfg.MODEL, max_tokens: maxTokens, messages: [{ role: "user", content }] }),
      signal: AbortSignal.timeout(180_000),
    });
  const raw = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 160).replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")}`);
  const body = JSON.parse(raw);
  if (cfg.glm) {
    assertGlmProviderModel(cfg.MODEL, body);
    const choice = body.choices?.[0];
    if (choice?.finish_reason === "length") throw new Error("回答被 max_tokens 截断");
    return { text: String(choice?.message?.content ?? "").trim(), inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0 };
  }
  assertProviderModel(cfg.MODEL, body);
  // 模型先输出 thinking 再输出正文；被 max_tokens 截断时 content 里只剩 thinking，正文是空串。
  if (body.stop_reason === "max_tokens") throw new Error("回答被 max_tokens 截断");
  return { text: (body.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim(), inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 };
}

const promptFor = (refCount) => `You are helping sort a private family photo archive about one toddler boy (the "reference child").
The first ${refCount} images show the reference child (clear photos). The LAST image is the photo to classify.
Answer about the LAST image only. Output ONLY one JSON object, no prose, with exactly these keys:
{"kind": "life" | "document" | "screenshot" | "object" | "collage",
 "child_present": true | false,
 "reference_child": "yes" | "no" | "uncertain",
 "face_visible": true | false,
 "children_count": <integer, how many children (anyone under ~12) are visible at all, including partly or in the background>,
 "main_child_size": "large" | "medium" | "small",
 "other_children_identifiable": true | false,
 "sensitive": "none" | "nudity_or_bath" | "health" | "finance" | "identity_document",
 "note": "<=12 words"}
Definitions:
- kind "life": a real camera photo of people/places. "document": paper, forms, menus, notices, charts, printed text. "screenshot": phone/app/web/CCTV screen captures. "object": real photo with no child (food, pets, rooms, scenery, products). "collage": edited image with stickers/big overlaid text or a grid of photos.
- reference_child "yes" only if the main child in the last image is clearly the same boy as the reference images. A different child, or a baby too small/blurred/turned away to tell, is "no" or "uncertain".
- main_child_size: "small" if the main child's face would be under about 1/12 of the image height.
- other_children_identifiable: true if any OTHER child's face (even partly, even in the background, e.g. classmates) is visible.
- sensitive "nudity_or_bath": undressed child, bath, toilet/potty. "health": wounds, rashes, medicine, clinics, medical records.`;

const PREGNANCY_PROMPT = `You are classifying photos from a family archive taken during a pregnancy period (before the baby was born).
Answer about the LAST image only. Output ONLY one JSON object with exactly these keys:
{"kind": "pregnancy" | "family_life" | "document" | "screenshot" | "scenery_object",
 "subtype": "belly" | "ultrasound" | "prenatal" | "nursery" | "baby_items" | "family_activity" | "parents_daily" | "other" | null,
 "quality": "good" | "ok" | "poor",
 "note": "<=12 words"}
Definitions:
- kind "pregnancy": clearly related to the pregnancy or preparations for the baby. Includes: pregnant belly, ultrasound images, prenatal clinic visits, nursery room setup, baby clothes/diapers/gear being bought or prepared, family/friends celebrating the upcoming birth, hospital admission.
- kind "family_life": ordinary family daily life not specifically pregnancy-related (parents at home, meals, outings).
- kind "document": paper documents, forms, receipts, printed text, menus.
- kind "screenshot": phone screen, app, social media, CCTV, computer screen captures.
- kind "scenery_object": scenery, food, pets, products, interiors with no people visible.
- subtype: fill only when kind is "pregnancy". Otherwise null.
- quality "good": clear, well-lit, emotionally meaningful moment. "ok": acceptable but ordinary. "poor": blurry, very dark, visually empty, or nearly identical to another photo in a burst.`;

/**
 * 这一天的配图选哪张：把标题和这一天已放行的照片一起给 DeepSeek，让它挑最能说明这句标题的一张。
 *
 * 为什么不由代码挑：代码只知道拍摄时间和尺寸，不知道画面里在发生什么。CLAUDE.md 的长期分工写明
 * 「选片与构图建议」归 DeepSeek。这里只要一个下标，失败就返回 null——挑不出来时保持原样，不瞎换。
 *
 * @param {{title:string, paragraphs:string[]}} entry
 * @param {{id:string, file:string}[]} items  候选（按页面上的顺序），最多 12 张
 * @returns {Promise<{id:string, why:string}|null>}
 */
export async function chooseLead(entry, items) {
  const ENV = loadEnv();
  const cfg = modelConfig(ENV);
  const { MODEL, KEY } = cfg;
  if (!KEY || !items.length) return null;
  let lastError = null;
  const pool = items.slice(0, 12);
  const shots = await Promise.all(pool.map((it) => shrink(it.file, 448)));
  const text = `These ${pool.length} photos were all taken on one day, numbered 0 to ${pool.length - 1} in the order given.
The family's diary entry for that day says:
TITLE: ${entry.title}
${(entry.paragraphs ?? []).slice(0, 2).join("\n")}

Pick the ONE photo that most directly shows what the TITLE describes. Prefer a clear, well-lit photo where the boy's face is visible and the action named in the title is recognisable. Only if no photo relates to the title at all, pick the best portrait of the boy.
Output ONLY JSON: {"best": <integer 0-${pool.length - 1}>, "why": "<=10 words"}`;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      // 12000 而不是几百：推理模型先输出一段 thinking，再输出正文。挑封面要比对十几张图，
      // thinking 很长——2026-09-20 用 800 和 3000 都被截断，正文一个字都没出来。按实际用量计费，上限开大基本不花钱。
      const { text: say } = await askModel(cfg, [...shots.map((b) => img(b)), { type: "text", text }], 12000);
      if (looksBlind(say)) throw new Error("blind answer");
      const json = JSON.parse(say.slice(say.indexOf("{"), say.lastIndexOf("}") + 1));
      const n = Number(json.best);
      if (!Number.isInteger(n) || n < 0 || n >= pool.length) throw new Error(`best 越界：${json.best}`);
      return { id: pool[n].id, why: String(json.why ?? "").slice(0, 40), lastError };
    } catch (error) { if (attempt === 2) { lastError = String(error.message ?? error).slice(0, 120); return null; } }
  }
  return null;
}

/**
 * 一个候选场景（时间相近的一串照片/视频）是不是真的同一个场景、同一个动作，该留哪几张——
 * 只有画面能回答，所以交给 deepseek-flash（CLAUDE.md：场景和动作是否同质化不能靠文件层面的东西替代）。
 * 只看画面，不带参考照片：这批本来就已经是「approved」的张年照片，这里只判场景与取舍，不判身份。
 *
 * @param {{id:string, file:string}[]} items  同一个候选场景里的媒体，2 张以上；视频传封面帧
 * @returns {Promise<{sameScene:boolean, keep:string[]}|null>} keep 是原始 id，按优先级从高到低；判不出来返回 null
 */
export async function curateScene(items) {
  const ENV = loadEnv();
  const cfg = modelConfig(ENV);
  const { MODEL, KEY } = cfg;
  if (!KEY || items.length < 2) return null;
  const shots = await Promise.all(items.map((it) => shrink(it.file, 512)));
  const text = `These ${items.length} photos/video-frames were all taken within a few minutes of each other on the same day, numbered 0 to ${items.length - 1} in time order.
Decide: are they the SAME scene and SAME moment/action (e.g. a burst of shots of one activity), not genuinely different activities or moments?
If yes, pick which to KEEP for a family album page, at most 3, best first. Preference order: (1) the boy's face is clearly visible, (2) a lively, natural expression or recognisable action, (3) good composition — not blurry, not over/under-exposed. If several are near-identical (a burst of the same instant), keep only ONE of them.
Output ONLY JSON: {"sameScene": true|false, "keep": [<index integers 0-${items.length - 1}, best first, at most 3>], "why": "<=16 words, why you kept those and dropped the rest"}`;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { text: say } = await askModel(cfg, [...shots.map((b) => img(b)), { type: "text", text }], 8000);
      if (looksBlind(say)) throw new Error("blind answer");
      const json = JSON.parse(say.slice(say.indexOf("{"), say.lastIndexOf("}") + 1));
      if (typeof json.sameScene !== "boolean") throw new Error("缺 sameScene");
      const keep = (Array.isArray(json.keep) ? json.keep : [])
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n >= 0 && n < items.length)
        .map((n) => items[n].id);
      return { sameScene: json.sameScene, keep: [...new Set(keep)], why: String(json.why ?? "").slice(0, 60) };
    } catch { if (attempt === 2) return null; }
  }
  return null;
}

/**
 * 孕期照片分类：不带参考孩子照片，判定该照片是否属于孕期档案。
 * @param {{id:string, file:string}[]} items
 * @returns {Promise<{model:string, calls:number, inputTokens:number, outputTokens:number, results:Record<string,object>}>}
 */
export async function classifyPregnancyPhotos(items, { concurrency = 6 } = {}) {
  const ENV = loadEnv();
  const cfg = modelConfig(ENV);
  const { KEY } = cfg;
  if (!KEY) throw new Error("no model credential in env (ZHIPU_API_KEY / DEEPSEEK_API_KEY)");
  let calls = 0; let inTok = 0; let outTok = 0;
  async function ask(content, maxTokens = 8000) {
    calls += 1;
    const r = await askModel(cfg, content, maxTokens);
    inTok += r.inputTokens; outTok += r.outputTokens;
    return r.text;
  }
  // 能力门（色块识别）
  for (const [rgb, name] of [[{ r: 255, g: 140, b: 0 }, "orange"], [{ r: 20, g: 60, b: 230 }, "blue"]]) {
    const png = await sharp({ create: { width: 96, height: 96, channels: 3, background: rgb } }).png().toBuffer();
    const say = await ask([img(png, "image/png"), { type: "text", text: "Reply with ONLY the colour word on the first line." }], 2000);
    const v = judgeVisionProbe(say, name);
    if (!v.capable) throw new Error(`capability gate failed (${name}): ${v.reason}`);
  }
  async function classify(item) {
    const target = await shrink(item.file, 768);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const say = await ask([img(target), { type: "text", text: PREGNANCY_PROMPT }]);
        if (looksBlind(say)) throw new Error("blind answer");
        const json = JSON.parse(say.slice(say.indexOf("{"), say.lastIndexOf("}") + 1));
        for (const k of ["kind", "subtype", "quality"]) if (!(k in json)) throw new Error(`missing ${k}`);
        return json;
      } catch (error) { if (attempt === 3) return { error: String(error.message ?? error).slice(0, 160) }; }
    }
  }
  const results = {};
  let next = 0; let consecutiveFail = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < items.length) {
      const item = items[next++];
      const r = await classify(item);
      results[item.id] = r;
      consecutiveFail = r.error ? consecutiveFail + 1 : 0;
      if (consecutiveFail >= 5) { next = items.length; }
    }
  }));
  return { model: cfg.MODEL, calls, inputTokens: inTok, outputTokens: outTok, results };
}

/**
 * @param {{id:string, file:string}[]} items
 * @param {string[]} refFiles  张年的清楚单人照（本地路径）
 * @returns {Promise<{model:string, calls:number, inputTokens:number, outputTokens:number, results:Record<string,object>}>}
 *   results[id] 是模型返回的 JSON，或 {error}。能力门不过时抛错（整批不动）。
 */
export async function classifyPhotos(items, refFiles, { concurrency = 4 } = {}) {
  const ENV = loadEnv();
  const cfg = modelConfig(ENV);
  const { MODEL, KEY } = cfg;
  if (!KEY) throw new Error("no model credential in env (ZHIPU_API_KEY / DEEPSEEK_API_KEY)");
  let calls = 0; let inTok = 0; let outTok = 0;

  async function ask(content, maxTokens = 8000) {
    calls += 1;
    const r = await askModel(cfg, content, maxTokens);
    inTok += r.inputTokens; outTok += r.outputTokens;
    return r.text;
  }

  for (const [rgb, name] of [[{ r: 255, g: 140, b: 0 }, "orange"], [{ r: 20, g: 60, b: 230 }, "blue"]]) {
    const png = await sharp({ create: { width: 96, height: 96, channels: 3, background: rgb } }).png().toBuffer();
    const say = await ask([img(png, "image/png"), { type: "text", text: "Reply with ONLY the colour word on the first line." }], 2000);
    const v = judgeVisionProbe(say, name);
    if (!v.capable) throw new Error(`capability gate failed (${name}): ${v.reason}`);
  }

  const refs = await Promise.all(refFiles.map((f) => shrink(f, 384)));
  const PROMPT = promptFor(refs.length);

  async function classify(item) {
    const target = await shrink(item.file, 768);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const say = await ask([...refs.map((b) => img(b)), img(target), { type: "text", text: PROMPT }]);
        if (looksBlind(say)) throw new Error("blind answer");
        const json = JSON.parse(say.slice(say.indexOf("{"), say.lastIndexOf("}") + 1));
        for (const k of ["kind", "children_count", "main_child_size", "child_present", "reference_child", "face_visible", "other_children_identifiable", "sensitive"]) if (!(k in json)) throw new Error(`missing ${k}`);
        return json;
      } catch (error) { if (attempt === 3) return { error: String(error.message ?? error).slice(0, 160) }; }
    }
  }

  const results = {};
  let next = 0; let consecutiveFail = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < items.length) {
      const item = items[next++];
      const r = await classify(item);
      results[item.id] = r;
      consecutiveFail = r.error ? consecutiveFail + 1 : 0;
      if (consecutiveFail >= 5) { next = items.length; }
    }
  }));
  return { model: MODEL, calls, inputTokens: inTok, outputTokens: outTok, results };
}
