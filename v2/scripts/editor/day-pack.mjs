// 重写一天时交给编辑（无头 Claude）的材料（纯函数，不读库、不联网）。
//
// 和夜间编辑的材料（nightly-editor.mjs loadDayPack）相比，多了两样：
//   - 这一天已经选好的照片，以及每张照片的画面描述。描述来自 DeepSeek（deepseek-flash）已经做过的识图结果，
//     这里只复用，不重新识图（CLAUDE.md「视觉解析与执行分工」）。
//   - 每张照片是谁发来的（带照片的那条消息也有短键），这样「爸爸发来照片」有来源可引。
// 发送人称谓只按注册表解析；未登记的人写成「未登记的人」，编辑不能点名他们，也不能把他们的话归给任何人。

import { isReadable } from "./plan.mjs";

export const UNREGISTERED = "未登记的人";

/**
 * @param {object} p
 * @param {{id:string, t:string, text:string|null, speaker:string|null, mediaIds:string[]}[]} p.rows  这一天的消息，按时间排好
 * @param {{mediaId:string, description:string|null, firstScreen:boolean}[]} p.photos  这一天已选的照片（顺序即页面顺序）
 * @param {{title:string|null, story:string|null}[]} [p.events]  这一天已有的事件（只作线索）
 * @returns {{keys:Map<string,object>, photoKeys:Map<string,object>, text:string}}
 */
export function buildDayPack({ rows, photos, events = [] }) {
  const keys = new Map();
  const photoKeys = new Map();
  const carrierOf = new Map();
  const wanted = new Set(photos.map((p) => p.mediaId));
  const lines = [];
  for (const r of rows) {
    const carried = (r.mediaIds ?? []).filter((id) => wanted.has(id));
    const readable = isReadable(r.text);
    if (!readable && carried.length === 0) continue;
    const k = `s${keys.size + 1}`;
    const label = r.speaker ?? UNREGISTERED;
    keys.set(k, { id: r.id, text: readable ? String(r.text).trim() : "", hour: Number(String(r.t).slice(0, 2)), speaker: r.speaker ?? null, label });
    for (const id of carried) carrierOf.set(id, k);
    const body = readable ? String(r.text).replace(/\s+/g, " ").trim().slice(0, 420) : "";
    const attach = carried.length ? `（发来照片/视频 ${carried.map((id) => `p${photos.findIndex((p) => p.mediaId === id) + 1}`).join("、")}）` : "";
    lines.push(`${k} ${r.t} ${label}: ${body}${attach}`);
  }
  const photoLines = photos.map((p, i) => {
    const k = `p${i + 1}`;
    const carrier = carrierOf.get(p.mediaId) ?? null;
    photoKeys.set(k, { mediaId: p.mediaId, carrier });
    const from = carrier ? `由 ${carrier} ${keys.get(carrier).label} 发来` : "来源消息不在当天（相册原件）";
    return `${k}${p.firstScreen ? "（首屏）" : ""}［${from}］画面：${p.description ?? "（没有画面描述）"}`;
  });
  const parts = [`### 当天消息（短键 时间 称谓: 正文）\n${lines.join("\n") || "（没有可读消息）"}`];
  if (photoLines.length) parts.push(`### 已选好的照片（画面描述由识图模型给出，只写看得见的；描述里的「女士」「男士」不是身份）\n${photoLines.join("\n")}`);
  if (events.length) parts.push(`### 这一天已有的事件（只作线索：称谓、引语一律以上面的消息为准）\n${events.map((e) => `- ${e.title ?? ""}：${String(e.story ?? "").slice(0, 200)}`).join("\n")}`);
  return { keys, photoKeys, text: parts.join("\n\n") };
}

/**
 * 段落 sources 里的短键 → 真正的来源消息。p 键换成带那张照片的消息（没有的就不算来源）。
 * @returns {object[]} keys 里的来源对象（去重）
 */
export function resolveParagraphSources(sourceKeys, pack) {
  const out = [];
  const seen = new Set();
  for (const k of sourceKeys) {
    const key = k.startsWith("p") ? pack.photoKeys.get(k)?.carrier : k;
    if (!key || seen.has(key)) continue;
    const src = pack.keys.get(key);
    if (src) { seen.add(key); out.push(src); }
  }
  return out;
}
