// The month chapter's day structure (lib/memory-index.ts buildMonthView) and the bounded open
// window on /memory. Production shape: 989 deliverable pictures across 9 months against 3
// published memories — the index must close its window on months, and the month page must read
// day by day with photographs and trace text together.
import test from "node:test";
import assert from "node:assert/strict";
import { buildChapters, findMonth } from "../lib/memory-chapters.ts";
import { buildMemoryIndex, buildMonthView } from "../lib/memory-index.ts";
import { DEFAULT_MEMORY_IA_POLICY } from "../lib/memory-ia-policy.ts";

const BIRTH = "2025-01-03";

function photo(id, takenAt, dims = { width: 1600, height: 1200 }) {
  return { id, profileId: "p", type: "photo", src: `/api/media/${id}`, alt: "WeChat image", takenAt, visibility: "family", ...dims };
}
function trace(id, occurredAt, entries) {
  return { id, profileId: "p", occurredAt, entries, sourceIds: [], scopes: ["family"], visibility: "family" };
}

test("the month page reads day by day: photographs and the day's words merge, newest day first, photos capped per day", () => {
  const media = [];
  // 08-28: 10 photos (over the per-day cap), 08-27: 2 photos; a trace exists on 08-28 and on 08-14 (no photos).
  for (let n = 0; n < 10; n += 1) media.push(photo(`a-${n}`, `2026-08-28T${String(2 + n).padStart(2, "0")}:00:00.000Z`));
  media.push(photo("b-0", "2026-08-27T08:00:00.000Z"), photo("b-1", "2026-08-27T09:00:00.000Z"));
  const traces = [trace("t1", "2026-08-28 00:00:00", ["这一天留下了 10 张照片。", "晚上自己吃完半碗饭"]), trace("t2", "2026-08-14 00:00:00", ["这一天留下了 3 张照片。", "在窗边看了很久的车"])];
  const chapters = buildChapters({ events: [], traces, media, birthDay: BIRTH });
  const view = buildMonthView(findMonth(chapters, "2026-08"));

  assert.deepEqual(view.days.map((day) => day.day), ["2026-08-28", "2026-08-27", "2026-08-14"]);
  const first = view.days[0];
  assert.equal(first.photos.length, DEFAULT_MEMORY_IA_POLICY.monthPhotosPerDay, "a day is edited, not dumped");
  assert.equal(first.morePhotoCount, 10 - DEFAULT_MEMORY_IA_POLICY.monthPhotosPerDay);
  assert.deepEqual(first.photos.slice(0, 3).map((p) => p.id), ["a-0", "a-1", "a-2"], "within a day, takenAt ascending");
  assert.deepEqual(first.entries, ["晚上自己吃完半碗饭"], "beside its own photographs, a day does not also say 留下了 N 张照片");
  const traceOnly = view.days[2];
  assert.equal(traceOnly.photos.length, 0);
  assert.deepEqual(traceOnly.entries, ["这一天留下了 3 张照片。", "在窗边看了很久的车"], "a day whose pictures are not on the page keeps the sentence — it is the only word of them");
});

test("/memory closes its window after openMonthsMax months even when no memories exist to fill the target", () => {
  const media = [];
  for (let m = 1; m <= 9; m += 1) media.push(photo(`m-${m}`, `2025-${String(m).padStart(2, "0")}-10T08:00:00.000Z`));
  const chapters = buildChapters({ events: [], traces: [], media, birthDay: BIRTH });
  const index = buildMemoryIndex(chapters);
  const entries = index.years.flatMap((year) => year.months);
  assert.equal(entries.length, 9);
  assert.equal(entries.filter((month) => month.mode === "open").length, DEFAULT_MEMORY_IA_POLICY.openMonthsMax);
  assert.ok(entries.slice(DEFAULT_MEMORY_IA_POLICY.openMonthsMax).every((month) => month.mode === "index"), "older photographed months become index rows");
});
