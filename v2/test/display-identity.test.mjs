import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { identifyDisplayMedia, uniqueDisplayMedia } from "../lib/media/display-identity.ts";
import { resolveMonthContentMedia, invalidateMonthContent } from "../lib/month-content.ts";
import { buildMonthTimeline } from "../lib/month-timeline.ts";
import { buildChapters, findMonth, toMediaRef } from "../lib/memory-chapters.ts";
import { buildMonthComposition } from "../lib/publication-moments.ts";
import { selectHomeMemories } from "../lib/home-memory.ts";
import { storyLayout } from "../lib/media/presentation.ts";

const asset = (id, checksum) => ({ id, profileId: "p", mediaType: "photo", mimeType: "image/jpeg", checksum });
const photo = (id, mediaAssetId, day = "2026-09-13", extra = {}) => ({ id, profileId: "p", mediaAssetId, type: "photo", visibility: "family", takenAt: `${day}T04:33:41Z`, width: 3213, height: 5712, src: `/api/media/${id}`, alt: "Photo", ...extra });
const hash = "a".repeat(64);
const assets = [asset("shared", hash), asset("another-copy", `SHA256:${hash.toUpperCase()}`), asset("distinct", "b".repeat(64))];
const rows = [photo("wechat-1", "shared"), photo("wechat-2", "shared"), photo("quark-copy", "another-copy"), photo("different-image", "distinct")];
const privilege = (media) => ({ trusted: new Set(media.map((p) => p.id)), confirmed: new Set(), checked: new Set(media.map((p) => p.id)), excluded: new Set() });

test("cross-source photo aliases collapse by asset/hash while preserving originals and curated preference", () => {
  const media = identifyDisplayMedia(rows, assets);
  assert.deepEqual(uniqueDisplayMedia(media).map((p) => p.id), ["wechat-1", "different-image"]);
  const available = new Map(media.map((p) => [p.id, p]));
  assert.deepEqual(resolveMonthContentMedia(["quark-copy", "wechat-2", "wechat-1", "different-image"], available).map((p) => p.id), ["quark-copy", "different-image"]);
  assert.ok(rows.every((p) => !p.displayKey));
  assert.equal(rows.length, 4);
});
test("same asset works without a checksum; missing identity never guesses from timestamp or dimensions", () => {
  const media = identifyDisplayMedia([photo("a", "no-hash"), photo("b", "no-hash"), photo("c", "missing-1"), photo("d", "missing-2")], [asset("no-hash", null)]);
  assert.deepEqual(uniqueDisplayMedia(media).map((p) => p.id), ["a", "c", "d"]);
  const distinct = identifyDisplayMedia([photo("a", "shared"), photo("b", "distinct")], assets);
  assert.equal(uniqueDisplayMedia(distinct).length, 2, "same time, shape and filename cannot erase a different file");
});
test("profile and media type boundaries remain separate", () => {
  const media = identifyDisplayMedia([photo("a", "shared"), photo("foreign", "foreign", "2026-09-13", { profileId: "q" }), photo("clip-1", "shared", "2026-09-13", { type: "video" }), photo("clip-2", "shared", "2026-09-13", { type: "video" })], [...assets, { ...asset("foreign", hash), profileId: "q" }]);
  assert.equal(uniqueDisplayMedia(media).length, 4);
});
test("withdrawn or unavailable alias cannot win against an eligible copy", () => {
  const media = identifyDisplayMedia(rows, assets);
  const available = new Map(media.filter((p) => p.id !== "wechat-2").map((p) => [p.id, p]));
  assert.deepEqual(resolveMonthContentMedia(rows.map((p) => p.id), available, new Set(["wechat-1"])).map((p) => p.id), ["quark-copy", "different-image"]);
});
test("edited dates and old-story merges share file deduplication with stable photo counts", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nian-display-")), previous = process.env.MONTH_CONTENT_DIR;
  try {
    process.env.MONTH_CONTENT_DIR = dir; invalidateMonthContent();
    const media = identifyDisplayMedia(rows, assets);
    const event = { id: "old-story", profileId: "p", title: "Original story", story: "Original source remains.", occurredAt: "2026-09-13", sourceIds: [], mediaIds: ["quark-copy"], people: [], tags: [], contentTypes: ["family"], scopes: ["family"], visibility: "family", memoryWeight: "memory", eventType: "moment", growthRecordIds: [], careRecordIds: [] };
    const archive = { chapters: buildChapters({ events: [event], traces: [], media, photoConfirmations: new Set(["old-story|quark-copy"]), birthDay: "2025-01-03" }), events: [event], media, privilege: privilege(media), traceEvents: [], birthDay: "2025-01-03" };
    for (const day of ["2026-09-13", "2026-09-14"]) {
      fs.writeFileSync(path.join(dir, "2026-09.json"), JSON.stringify({ schema: "nianlife.month-content/1", month: "2026-09", days: [{ day, kind: "story", title: "Edited day", paragraphs: ["Text"], firstScreenMediaIds: ["wechat-1"], expandedMediaIds: rows.map((p) => p.id) }] }));
      invalidateMonthContent();
      const timeline = await buildMonthTimeline(archive, "2026", "09");
      assert.deepEqual(timeline.byDay.get(day).photos.map((p) => p.id), ["wechat-1", "different-image"]);
      if (day === "2026-09-13") assert.deepEqual(timeline.byDay.get(day).eventIds, [event.id]);
    }
  } finally { if (previous === undefined) delete process.env.MONTH_CONTENT_DIR; else process.env.MONTH_CONTENT_DIR = previous; invalidateMonthContent(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test("legacy month album prefers eligible reviewed aliases and contains two files rather than four IDs", () => {
  const media = identifyDisplayMedia(rows, assets);
  const chapter = findMonth(buildChapters({ events: [], traces: [], media, birthDay: "2025-01-03" }), "2026-09");
  const p = privilege(media); p.checked = new Set(["quark-copy"]);
  const composition = buildMonthComposition(chapter, p);
  const displayed = [...composition.archiveDays, ...composition.dayPhotoGroups].flatMap((day) => day.photos);
  assert.equal(displayed.length, 2);
  assert.ok(displayed.some((p) => p.id === "quark-copy"));
  assert.equal(new Set(displayed.map((p) => p.displayKey)).size, 2);
});
test("legacy story layout preserves chosen hero and removes its aliases from supporting frames", () => {
  const media = identifyDisplayMedia(rows, assets);
  const layout = storyLayout(media, "quark-copy");
  assert.equal(layout.hero.id, "quark-copy");
  assert.deepEqual(layout.supporting.map((p) => p.id), ["different-image"]);
});
test("player does not repeat a file across dates or themes with differently reviewed alias IDs", () => {
  const input = [], inputAssets = [], themeById = new Map();
  for (const [theme, month] of [["laugh", "09"], ["eat", "08"]]) for (let i = 1; i <= 8; i++) {
    const id = `${theme}-${i}`, day = `2026-${month}-${String(i).padStart(2, "0")}`;
    input.push(photo(id, id, day)); inputAssets.push(asset(id, i === 1 && theme === "laugh" ? hash : undefined)); themeById.set(id, theme);
  }
  input.push(photo("forwarded-copy", "alias", "2026-09-09")); inputAssets.push(asset("alias", hash)); themeById.set("forwarded-copy", "eat");
  const media = identifyDisplayMedia(input, inputAssets);
  const byId = new Map(media.map((p) => [p.id, p]));
  const topics = (id) => ({ carousel: { promptVersion: "home-carousel-v4", takenAt: byId.get(id).takenAt, matches: { [themeById.get(id)]: 95 }, clarity: 95, expression: 95, qualified: true, eyesOpen: true, sleeping: false, childMain: true, faceClear: true, faceUnblocked: true, motionBlur: false, sensitive: false, approvedThemes: [themeById.get(id)] } });
  const archive = { chapters: buildChapters({ events: [], traces: [], media, birthDay: "2025-01-03" }), privilege: privilege(media), birthDay: "2025-01-03", time: { today: "2026-09-30" } };
  const selected = selectHomeMemories(archive, topics).memories;
  assert.ok(selected.some((m) => m.key === "topic:laugh")); assert.ok(selected.some((m) => m.key === "topic:eat"));
  const slides = selected.flatMap((m) => m.slides);
  assert.equal(new Set(slides.map((s) => s.media.displayKey)).size, slides.length);
  assert.ok(slides.some((s) => s.media.id === "laugh-1"));
  assert.ok(!slides.some((s) => s.media.id === "forwarded-copy"));
  assert.ok(toMediaRef(media[0]).displayKey);
});
