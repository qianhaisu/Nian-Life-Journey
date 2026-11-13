import essaysFile from "./essays.json";
import type { Trip } from "./model";

/**
 * essays.json 条目（schema `nianlife.travel-essays/1`，向后兼容）。
 * 必填：tripId / from / to / (basis 或 basisTitle) / title / paragraphs（≥2 段）。
 * 可选（P6.3，图文穿插；与日页 `paragraphMedia` / `photoCaptions` 同名同义）：
 *   - `paragraphMedia?: string[][]` 第 i 项是接在 paragraphs[i] 之后的照片 media id（0～3 张；长度不得超过段数；
 *     同一 id 全文只能出现一次）。id 必须是这段旅程里已审核可发布的照片，读取时再过一遍和日页相同的发布门，
 *     过不了门的 id 静默跳过——不会因为一张图失效而让整篇游记回退成一句摘要。
 *   - `photoCaptions?: Record<string, string>` media id → 一句图注（建议 ≤20 字，不复述标题，不写说明书腔）。
 * 两个字段都缺省时，详情页沿用「照片回忆」相册，正文不穿插图片。
 */
type EssayRecord = {
  tripId: string; from: string; to: string; basis?: string; basisTitle?: string; title: string; paragraphs: string[];
  paragraphMedia?: string[][]; photoCaptions?: Record<string, string>;
};
export type TripEssay = {
  title: string; paragraphs: string[]; authored: boolean;
  paragraphMedia?: string[][]; photoCaptions?: Record<string, string>;
};

const MAX_PER_PARAGRAPH = 3;

function validateAnchors(entry: EssayRecord) {
  if (entry.paragraphMedia !== undefined) {
    const groups = entry.paragraphMedia;
    if (!Array.isArray(groups) || groups.length > entry.paragraphs.length) throw new Error("essays.json: paragraphMedia 必须是数组且不超过段数");
    const seen = new Set<string>();
    for (const group of groups) {
      if (!Array.isArray(group) || group.length > MAX_PER_PARAGRAPH) throw new Error("essays.json: paragraphMedia 每段 0～3 张");
      for (const id of group) {
        if (typeof id !== "string" || !id.trim()) throw new Error("essays.json: paragraphMedia 含空 id");
        if (seen.has(id)) throw new Error("essays.json: paragraphMedia 同一张照片不能重复锚定");
        seen.add(id);
      }
    }
  }
  if (entry.photoCaptions !== undefined) {
    const caps = entry.photoCaptions;
    if (!caps || typeof caps !== "object" || Array.isArray(caps)) throw new Error("essays.json: photoCaptions 必须是对象");
    for (const [id, text] of Object.entries(caps)) {
      if (!id.trim() || typeof text !== "string" || !text.trim()) throw new Error("essays.json: photoCaptions 含空 id 或空图注");
    }
  }
}

/** A dated editorial revision bound to its evidence; an old essay cannot quietly describe a changed itinerary. */
export function validateEssays(raw: unknown): EssayRecord[] {
  const file = raw as { schema?: string; essays?: EssayRecord[] };
  if (file?.schema !== "nianlife.travel-essays/1" || !Array.isArray(file.essays)) throw new Error("essays.json: schema/essays 无效");
  const ids = new Set<string>();
  return file.essays.map(entry => {
    if (!entry || typeof entry.tripId !== "string" || !entry.tripId.trim() || ids.has(entry.tripId)) throw new Error("essays.json: tripId 无效或重复");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.from) || !/^\d{4}-\d{2}-\d{2}$/.test(entry.to) || entry.from > entry.to) throw new Error("essays.json: from/to 无效");
    if (!(typeof entry.basis === "string" && entry.basis.trim()) && !(typeof entry.basisTitle === "string" && entry.basisTitle.trim())) throw new Error("essays.json: 缺事实依据");
    if (typeof entry.title !== "string" || !entry.title.trim() || !Array.isArray(entry.paragraphs) || entry.paragraphs.length < 2 || entry.paragraphs.some(p => typeof p !== "string" || !p.trim())) throw new Error("essays.json: 正文无效");
    validateAnchors(entry);
    ids.add(entry.tripId);
    return entry;
  });
}

const ESSAYS = validateEssays(essaysFile);

export function tripEssay(trip: Trip, records: readonly EssayRecord[] = ESSAYS): TripEssay {
  const essay = records.find(item => item.tripId === trip.id && item.from === trip.from && item.to === trip.to
    && (!item.basis || item.basis === trip.summary) && (!item.basisTitle || item.basisTitle === trip.title));
  return essay ? {
    title: essay.title, paragraphs: essay.paragraphs, authored: true,
    ...(essay.paragraphMedia?.some(group => group.length) ? { paragraphMedia: essay.paragraphMedia } : {}),
    ...(essay.photoCaptions && Object.keys(essay.photoCaptions).length ? { photoCaptions: essay.photoCaptions } : {}),
  } : { title: "这一程的记录", paragraphs: [trip.summary], authored: false };
}
