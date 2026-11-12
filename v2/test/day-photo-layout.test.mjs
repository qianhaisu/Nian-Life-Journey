import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { partitionDayPhotos, resolveCardThumbnail } from "../lib/day-photo-layout.ts";
import { invalidateMonthContent, validateMonthContent } from "../lib/month-content.ts";
import { buildMonthTimeline } from "../lib/month-timeline.ts";

const makePhoto = (id, overrides = {}) => ({
  id,
  src: `/api/media/${id}`,
  alt: `默认描述-${id}`,
  width: 1200,
  height: 900,
  type: "photo",
  takenAt: "2026-07-18",
  ...overrides,
});

test("validateMonthContent accepts optional paragraphMedia, photoCaptions, featuredQuote, and homeHeroMediaId, and rejects malformed shapes", () => {
  const baseDay = {
    day: "2026-07-18",
    ageLabel: "1岁6个月",
    kind: "story",
    title: "池边一摞漏水的套杯",
    paragraphs: ["第一段。", "第二段。", "第三段。"],
    firstScreenMediaIds: ["m1", "m2", "m3"],
    expandedMediaIds: ["m1", "m2", "m3"],
  };

  const anchoredDoc = {
    schema: "nianlife.month-content/1",
    month: "2026-07",
    homeHeroMediaId: "m1",
    days: [
      {
        ...baseDay,
        paragraphMedia: [["m1", "m2"], ["m3"], []],
        photoCaptions: {
          m1: "站在浅水池蓝色瓷砖上低头试水",
          m2: "抬起左手去够池沿最高那只套杯",
          m3: "水顺着黄杯底的小孔往下漏",
        },
        featuredQuote: { text: "宝宝第一次这么喜欢水", speaker: "奶奶", sourceId: "s1" },
      },
    ],
  };

  const validated = validateMonthContent(anchoredDoc, "2026-07");
  assert.ok(validated, "anchored day with P2/P4/P5 fields must pass validation");
  assert.deepEqual(validated.days[0].paragraphMedia, [["m1", "m2"], ["m3"], []]);
  assert.equal(validated.days[0].photoCaptions?.m1, "站在浅水池蓝色瓷砖上低头试水");

  // Legacy day without new fields still passes
  const legacyDoc = { schema: "nianlife.month-content/1", month: "2026-07", days: [baseDay] };
  assert.ok(validateMonthContent(legacyDoc, "2026-07"));

  // Malformed paragraphMedia or photoCaptions is refused
  assert.equal(
    validateMonthContent({ ...legacyDoc, days: [{ ...baseDay, paragraphMedia: "m1" }] }, "2026-07"),
    null,
  );
  assert.equal(
    validateMonthContent({ ...legacyDoc, days: [{ ...baseDay, paragraphMedia: [["m1", 42]] }] }, "2026-07"),
    null,
  );
  assert.equal(
    validateMonthContent({ ...legacyDoc, days: [{ ...baseDay, photoCaptions: ["bad"] }] }, "2026-07"),
    null,
  );
  assert.equal(
    validateMonthContent({ ...legacyDoc, days: [{ ...baseDay, photoCaptions: { m1: 123 } }] }, "2026-07"),
    null,
  );
});

test("partitionDayPhotos deduplicates hero from inline paragraph groups and keeps remaining photos in reading order", () => {
  const photos = ["m1", "m2", "m3", "m4", "m5", "m6"].map((id) => makePhoto(id));
  const captions = {
    m1: "站在浅水池蓝色瓷砖上低头试水",
    m2: "抬起左手去够池沿最高那只套杯",
    m3: "两手抓着红橙塑料杯抬头大笑",
    m4: "水顺着黄杯底的小孔往下漏",
    m5: "湖畔浅水池里拍起一片水花",
  };

  // Matches P2 output where paragraph 0 also references m1 (which was promoted to Hero)
  const layout = partitionDayPhotos({
    photos,
    firstScreenMediaIds: ["m1", "m2", "m3", "m4", "m5"],
    paragraphMedia: [["m1", "m2"], ["m3", "m4", "m5", "m2"], []],
    paragraphCount: 3,
    photoCaptions: captions,
  });

  assert.equal(layout.hero?.id, "m1");
  assert.equal(layout.hero?.caption, captions.m1);
  assert.deepEqual(
    layout.paragraphGroups.map((group) => group.map((item) => item.id)),
    [["m2"], ["m3", "m4", "m5"], []],
    "m1 must not repeat in paragraph 0 and m2 must not repeat in paragraph 1",
  );
  assert.deepEqual(
    layout.remainingMedia.map((item) => item.id),
    ["m6"],
    "only unanchored m6 goes to end-of-article grid",
  );
  assert.deepEqual(
    layout.viewerPhotos.map((item) => item.id),
    ["m1", "m2", "m3", "m4", "m5", "m6"],
  );
  assert.equal(layout.viewerIndexById.m1, 0);
  assert.equal(layout.viewerIndexById.m4, 3);
  assert.equal(layout.viewerIndexById.m6, 5);
});

test("partitionDayPhotos handles legacy multi-photo days and 1-photo days without duplicating the hero", () => {
  // Legacy multi-photo day (no paragraphMedia)
  const multi = partitionDayPhotos({
    photos: ["p1", "p2", "p3", "p4"].map((id) => makePhoto(id)),
    firstScreenMediaIds: ["p1", "p2", "p3", "p4"],
    paragraphCount: 2,
  });
  assert.equal(multi.hero?.id, "p1");
  assert.deepEqual(multi.paragraphGroups, [[], []]);
  assert.deepEqual(multi.remainingMedia.map((item) => item.id), ["p2", "p3", "p4"]);
  assert.deepEqual(multi.viewerPhotos.map((item) => item.id), ["p1", "p2", "p3", "p4"]);

  // Single-photo day: hero takes p1, remainingMedia MUST be empty so no 1-photo grid repeats below!
  const single = partitionDayPhotos({
    photos: [makePhoto("only-one")],
    firstScreenMediaIds: ["only-one"],
    paragraphMedia: [["only-one"]],
    paragraphCount: 1,
  });
  assert.equal(single.hero?.id, "only-one");
  assert.deepEqual(single.paragraphGroups, [[]]);
  assert.deepEqual(single.remainingMedia, []);
  assert.deepEqual(single.viewerPhotos.map((item) => item.id), ["only-one"]);
});

test("resolveCardThumbnail prefers first-screen still photo and gracefully handles static and empty lists", () => {
  assert.equal(resolveCardThumbnail([]), undefined);

  const apiPhotos = [makePhoto("m1"), makePhoto("m2")];
  const choice = resolveCardThumbnail(apiPhotos, ["m2"]);
  assert.deepEqual(choice, {
    src: "/api/media/m2?variant=thumbnail",
    fallbackSrc: "/api/media/m2",
    alt: "默认描述-m2",
  });

  const staticPhoto = [makePhoto("s1", { src: "/images/hero/walk.jpg" })];
  assert.deepEqual(resolveCardThumbnail(staticPhoto), {
    src: "/images/hero/walk.jpg",
    fallbackSrc: undefined,
    alt: "默认描述-s1",
  });
});

test("buildMonthTimeline preserves paragraphMedia, photoCaptions, and firstScreenMediaIds on TimelineDay", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nian-p4-timeline-"));
  const prev = process.env.MONTH_CONTENT_DIR;
  try {
    const doc = {
      schema: "nianlife.month-content/1",
      month: "2026-07",
      days: [
        {
          day: "2026-07-18",
          kind: "story",
          emphasis: "lead",
          title: "池边一摞漏水的套杯",
          paragraphs: ["第一段。", "第二段。"],
          firstScreenMediaIds: ["m1", "m2"],
          expandedMediaIds: ["m1", "m2"],
          paragraphMedia: [["m1"], ["m2"]],
          photoCaptions: { m1: "蓝色池砖试水", m2: "红橙套杯" },
        },
      ],
    };
    fs.writeFileSync(path.join(dir, "2026-07.json"), JSON.stringify(doc));
    process.env.MONTH_CONTENT_DIR = dir;
    invalidateMonthContent();

    const media = [
      { id: "m1", profileId: "p", visibility: "family", type: "photo", takenAt: "2026-07-18", src: "/api/media/m1", width: 1200, height: 900 },
      { id: "m2", profileId: "p", visibility: "family", type: "photo", takenAt: "2026-07-18", src: "/api/media/m2", width: 900, height: 1200 },
    ];
    const archive = {
      chapters: [],
      media,
      events: [],
      eventIdentities: [],
      traceEvents: [],
      birthDay: "2025-01-03",
      privilege: { confirmed: new Set(), trusted: new Set() },
    };
    const timeline = await buildMonthTimeline(archive, "2026", "07");
    const entry = timeline?.byDay.get("2026-07-18");
    assert.ok(entry);
    assert.deepEqual(entry.firstScreenMediaIds, ["m1", "m2"]);
    assert.deepEqual(entry.paragraphMedia, [["m1"], ["m2"]]);
    assert.deepEqual(entry.photoCaptions, { m1: "蓝色池砖试水", m2: "红橙套杯" });
    assert.match(entry.photos[0].alt, /^蓝色池砖试水/);
    assert.match(entry.photos[1].alt, /^红橙套杯/);
  } finally {
    if (prev === undefined) delete process.env.MONTH_CONTENT_DIR;
    else process.env.MONTH_CONTENT_DIR = prev;
    invalidateMonthContent();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
