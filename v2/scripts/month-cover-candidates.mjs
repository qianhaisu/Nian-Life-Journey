#!/usr/bin/env node
// Proposes month-cover candidates and asks the vision model where the crop must not cut.
//
// Only a candidate list comes out of this: choosing the cover, and proving a crop keeps the face,
// belongs to the page step, where a real browser renders the real frame. A model's focal point is a
// starting position for that check, never a substitute for it — an earlier round shipped a crop
// that cut off a chin while the numbers said it was fine.
//
// Candidates are drawn only from media the curation already selected, so a cover can never be a
// picture that failed the subject gate or the deliverability gate.
//
// Usage: node scripts/month-cover-candidates.mjs --curation=<c.json> --vision=<v.json>
//        --groups=<g.json> --cache=<media dir> --out=<covers.json> [--top=8]

import fs from "node:fs";
import path from "node:path";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const curation = JSON.parse(fs.readFileSync(arg("curation"), "utf8"));
const vision = JSON.parse(fs.readFileSync(arg("vision"), "utf8"));
const groups = JSON.parse(fs.readFileSync(arg("groups"), "utf8"));
const mediaDir = arg("cache");
const outPath = arg("out");
const top = Number(arg("top", "8"));
const manifest = JSON.parse(fs.readFileSync(path.join(mediaDir, "_manifest.json"), "utf8"));

const MODEL = "deepseek-flash";
const env = {};
for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (env.AI_MODEL && env.AI_MODEL.trim() !== MODEL) { console.error(`MODEL_NOT_ALLOWED: ${env.AI_MODEL}`); process.exit(1); }
const BASE = (env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/anthropic").replace(/\/$/, "");

const itemById = new Map(groups.uniqueItems.map((i) => [i.mediaId, i]));
const selected = [];
for (const day of curation.days) {
  for (const s of day.selected) {
    const item = itemById.get(s.mediaId);
    if (!item) continue;
    // a cover is a portrait-ish life photo that is sharp and not flat; these are local, deterministic
    // pre-filters that only shrink the list handed to the model
    selected.push({ ...s, day: day.day, stats: item.stats, aspect: item.aspect,
      width: item.derivativeWidth, height: item.derivativeHeight });
  }
}
const ranked = selected
  .filter((s) => s.stats && s.stats.sharpness > 0.5 && s.stats.stdev > 40)
  .sort((a, b) => (b.stats.sharpness * b.stats.entropy) - (a.stats.sharpness * a.stats.entropy))
  .slice(0, top);

const PROMPT = [
  "这张照片可能被用作一个家庭档案「2026 年 9 月」月份卡片的封面。",
  "封面会被裁成横向的宽幅画框（手机约 2:1，桌面约 1.4:1），裁切时上下会被切掉一部分。",
  "请回答三件事：",
  "1) face_visible：画面里孩子的脸是否清楚可见（布尔值）。",
  "2) focal_y：如果要保证脸和下巴都不被切掉，画面纵向的焦点应该落在从上往下百分之几的位置（0 到 100 的整数）。",
  "3) cover_note：一句话说明这张适合或不适合做封面的理由，只依据画面里看得见的内容。",
  "最后单独输出一行 JSON，不加代码块标记，顶层对象含键 face_visible、focal_y、cover_note。",
].join("\n");

const results = [];
const callLog = [];
for (const candidate of ranked) {
  const entry = manifest[candidate.mediaId];
  const buffer = fs.readFileSync(path.join(mediaDir, entry.file));
  try {
    const response = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.DEEPSEEK_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64",
          media_type: entry.contentType?.startsWith("image/") ? entry.contentType : "image/jpeg",
          data: buffer.toString("base64") } },
        { type: "text", text: PROMPT },
      ] }] }),
    });
    const payload = await response.json();
    if (payload.model && payload.model !== MODEL) throw new Error(`model mismatch ${payload.model}`);
    callLog.push({ mediaId: candidate.mediaId, requestedModel: MODEL, returnedModel: payload.model ?? null,
      stopReason: payload.stop_reason, usage: payload.usage });
    const text = (payload.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
    let parsed = null;
    for (const m of [...text.matchAll(/\{[\s\S]*?\}/g)].reverse()) {
      try { const p = JSON.parse(m[0]); if (p && "focal_y" in p) { parsed = p; break; } } catch { /* next */ }
    }
    results.push({
      mediaId: candidate.mediaId, day: candidate.day, takenAt: candidate.takenAt,
      description: candidate.description, stats: candidate.stats,
      derivativeSize: `${candidate.width}x${candidate.height}`,
      faceVisible: parsed?.face_visible ?? null,
      focalYPercent: parsed?.focal_y ?? null,
      coverNote: parsed?.cover_note ?? null,
      truncated: payload.stop_reason === "max_tokens",
      caveat: "focal point is a starting position for a real browser render, not an accepted crop",
    });
  } catch (error) {
    results.push({ mediaId: candidate.mediaId, day: candidate.day, error: String(error.message ?? error) });
  }
}

fs.writeFileSync(outPath, JSON.stringify({
  generatedAt: new Date().toISOString(), month: curation.month, model: MODEL,
  shortlistMethod: "curated selections only, then local sharpness/contrast pre-filter, then the model judged face visibility and focal point",
  acceptanceNote: "no cover is accepted here; MEMORY-05 renders the real frame and checks nothing is cut",
  candidates: results, callLog,
}, null, 1));
console.log(`cover candidates: ${results.length}`);
for (const r of results) console.log(`  ${r.day} ${r.mediaId.slice(0, 40)} face=${r.faceVisible} focalY=${r.focalYPercent}`);
