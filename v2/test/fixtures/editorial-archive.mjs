// Synthetic archive at the scale the family site must survive: twelve months of a year, a few
// hundred daily traces, memories with 0 / 1 / 3 / 8 / 20 photos, one empty month and one month that
// only has traces. Dev-only; never written to any store.

export const BIRTH = "2025-01-03";

const PORTRAIT = { width: 1080, height: 1920 };
const LANDSCAPE = { width: 1920, height: 1080 };
const STICKER = { width: 90, height: 120 };

export function photo(id, dims = PORTRAIT, overrides = {}) {
  return { id, profileId: "p", type: "photo", src: `/api/media/${id}`, thumbnailSrc: `/api/media/${id}?thumb`, alt: "WeChat image", takenAt: "2026-01-01T00:00:00.000Z", visibility: "family", ...dims, ...overrides };
}

export function event(id, occurredAt, mediaIds, overrides = {}) {
  return { id, profileId: "p", title: `记忆 ${id}`, story: `第一段故事 ${id}。`.repeat(12), occurredAt, people: [], tags: [], contentTypes: ["daily"], mediaIds, sourceIds: [], growthRecordIds: [], careRecordIds: [], eventType: "moment", memoryWeight: "memory", scopes: ["family"], visibility: "family", keptInYearbook: false, ...overrides };
}

export function trace(id, occurredAt, entries = ["午睡后自己穿了鞋"]) {
  return { id, profileId: "p", occurredAt, entries, sourceIds: [], scopes: ["family"], visibility: "family" };
}

export function buildFixture() {
  const media = [];
  const events = [];
  const traces = [];
  const addPhotos = (prefix, count, dims) => {
    const ids = [];
    for (let i = 0; i < count; i += 1) { const id = `${prefix}-${i}`; media.push(photo(id, dims)); ids.push(id); }
    return ids;
  };

  // 2026: months 01..12. 06 is empty, 09 has traces only.
  const counts = { "2026-01": 1, "2026-02": 3, "2026-03": 8, "2026-04": 20, "2026-05": 0 };
  for (let m = 1; m <= 12; m += 1) {
    const month = `2026-${String(m).padStart(2, "0")}`;
    if (month === "2026-06") continue;
    if (month !== "2026-09") {
      const n = counts[month] ?? 2;
      const ids = addPhotos(`${month}-a`, n, m % 2 ? PORTRAIT : LANDSCAPE);
      // timestamptz shape like production life_events
      events.push(event(`${month}-a`, `${month}-14 00:00:00+00`, ids, { heroMediaId: ids[ids.length - 1] }));
      if (m >= 7) events.push(event(`${month}-b`, `${month}-03 00:00:00+00`, addPhotos(`${month}-b`, 2, PORTRAIT), { memoryWeight: "highlight" }));
      if (m === 12) events.push(event(`${month}-c`, `${month}-20 00:00:00+00`, [], { title: "", story: "" }));
    }
    for (let d = 1; d <= 28; d += 1) {
      // timestamp-without-offset shape like daily_traces; two rows on the 10th
      traces.push(trace(`${month}-${d}`, `${month}-${String(d).padStart(2, "0")} 00:00:00`));
      if (d === 10) traces.push(trace(`${month}-${d}-2`, `${month}-10 00:00:00`, ["第二条"]));
    }
  }
  // 2025: one memory with a sticker plus a real photo
  const sticker = photo("2025-08-s", STICKER);
  const real = photo("2025-08-r", LANDSCAPE, { alt: "在外婆家的院子里" });
  media.push(sticker, real);
  events.push(event("2025-08-a", "2025-08-11 00:00:00+00", [sticker.id, real.id], { heroMediaId: sticker.id }));

  return { media, events, traces };
}
