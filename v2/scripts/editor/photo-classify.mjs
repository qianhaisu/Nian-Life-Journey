// 照片识别（deepseek-flash 看图）。是 .data/ds-photo-classify.mjs 的可 import 版本，提示词与字段定义一字不改，
// 这样夜间流程用的就是 2026-09-16/17 那批人工流程用过的同一套判定输入。
// 每次调用开始先过能力门（合成色块）：答错就整批中止，不写任何东西。凭据只在进程内读，不打印。
// 需要 node --import tsx 运行（引用了 .ts）。
import fs from "node:fs";
import sharp from "sharp";
import { judgeVisionProbe, looksBlind } from "../../lib/home-photo-quality.ts";
import { assertProviderModel, resolveDeepSeekModel } from "../../lib/organizer/deepseek-model.ts";

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

/**
 * @param {{id:string, file:string}[]} items
 * @param {string[]} refFiles  张年的清楚单人照（本地路径）
 * @returns {Promise<{model:string, calls:number, inputTokens:number, outputTokens:number, results:Record<string,object>}>}
 *   results[id] 是模型返回的 JSON，或 {error}。能力门不过时抛错（整批不动）。
 */
export async function classifyPhotos(items, refFiles, { concurrency = 4 } = {}) {
  const ENV = loadEnv();
  const MODEL = resolveDeepSeekModel(ENV);
  const BASE = (ENV.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/anthropic").replace(/\/$/, "");
  const KEY = ENV.DEEPSEEK_API_KEY;
  if (!KEY) throw new Error("no DeepSeek credential in env");
  let calls = 0; let inTok = 0; let outTok = 0;

  async function ask(content, maxTokens = 3000) {
    calls += 1;
    const res = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: [{ role: "user", content }] }),
      signal: AbortSignal.timeout(180_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160).replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")}`);
    const body = JSON.parse(text);
    assertProviderModel(MODEL, body);
    inTok += body.usage?.input_tokens ?? 0; outTok += body.usage?.output_tokens ?? 0;
    return (body.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  }

  for (const [rgb, name] of [[{ r: 255, g: 140, b: 0 }, "orange"], [{ r: 20, g: 60, b: 230 }, "blue"]]) {
    const png = await sharp({ create: { width: 96, height: 96, channels: 3, background: rgb } }).png().toBuffer();
    const say = await ask([img(png, "image/png"), { type: "text", text: "Reply with ONLY the colour word on the first line." }], 800);
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
