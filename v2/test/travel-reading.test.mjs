import test from "node:test";
import assert from "node:assert/strict";
import { buildTripMemory } from "../lib/travel/memory.ts";
import { tripEssay, validateEssays } from "../lib/travel/essay.ts";
import { TRIPS } from "../lib/travel/model.ts";
import { syncTrips } from "../lib/travel/sync.ts";

const trip = { id: "test", title: "一次旅行", from: "2026-01-01", to: "2026-01-31", summary: "已确认的行程" };
const photo = (id, extra = {}) => ({ id, type: "photo", src: `/api/media/${id}`, alt: "已审核照片", width: 900, height: 1200, ...extra });
const day = (n, photos, href = `/memory/2026/01/${String(n).padStart(2, "0")}`) => ({ day: `2026-01-${String(n).padStart(2, "0")}`, dateLabel: `1 月 ${n} 日`, ageLabel: "1 岁", href, photos });
const quality = (clarity, sceneKey) => ({ qualified: true, childMain: true, faceClear: true, clarity, sceneKey });

test("旅程回忆从整段审核池选片，精确文件与已知重复场景合并，保留更好的已审核照片", () => {
  const days = [day(1, [photo("a", { displayKey: "file-a" }), photo("b", { displayKey: "file-a" }), photo("c")]), day(2, [photo("d"), photo("e")])];
  const scores = new Map([["a", quality(1)], ["b", quality(4)], ["c", quality(1, "scene-known")], ["d", quality(8, "scene-known")]]);
  const memory = buildTripMemory(trip, days, scores, photo("a", { displayKey: "file-a" }));
  assert.deepEqual(memory.slides.map(slide => slide.media.id), ["b", "d", "e"]);
  assert.equal(memory.coverIndex, 0, "封面的同文件别名仍对应选中照片");
  assert.equal(memory.slides[1].href, "/memory/2026/01/02");
  assert.equal(memory.slides[1].ageLabel, "1 岁");
  assert.equal(memory.slides[1].media.day, undefined, "不把整天的照片及正文再串进每张 slide");
  assert.equal(memory.slides[1].caption, undefined, "不重复逐日日记标题");
  assert.equal(days[0].photos.length, 3, "不改原始审核池或来源");
});

test("长旅行兼顾前中后，不被一个拍照很多的日子占满", () => {
  const days = Array.from({ length: 31 }, (_, i) => day(i + 1, Array.from({ length: i === 0 ? 80 : 2 }, (_, p) => photo(`${i + 1}-${p}`))));
  const memory = buildTripMemory(trip, days, new Map());
  assert.equal(memory.slides.length, 24);
  assert.equal(new Set(memory.slides.map(slide => slide.day)).size, 24);
  assert.equal(memory.slides[0].day, "2026-01-01");
  assert.equal(memory.slides.at(-1).day, "2026-01-31");
  const numbers = memory.slides.map(slide => Number(slide.day.slice(-2)));
  assert.ok(numbers.some(n => n >= 14 && n <= 18));
  assert.ok(numbers.every((n, i) => i === 0 || n - numbers[i - 1] <= 2), "中段没有大段缺口");
});

test("未知场景不靠时间、尺寸猜重；少量照片、无日页风景和视频边界正确", () => {
  const scenery = day(2, [photo("scenic")], undefined);
  delete scenery.href;
  const memory = buildTripMemory(trip, [day(1, [photo("a"), photo("b"), photo("clip", { type: "video" })]), scenery], new Map());
  assert.deepEqual(memory.slides.map(slide => slide.media.id), ["a", "b", "scenic"]);
  assert.equal(memory.slides.at(-1).href, undefined);
  assert.equal(memory.slides.at(-1).linkLabel, undefined);
  assert.equal(buildTripMemory(trip, [day(1, [photo("a")])], new Map()).slides.length, 1);
  assert.equal(buildTripMemory(trip, [], new Map()), undefined);
});

test("照片与来源限定在这次旅行；打乱输入仍按旅程顺序播放", () => {
  const short = { ...trip, from: "2026-01-02", to: "2026-01-03" };
  const memory = buildTripMemory(short, [day(4, [photo("outside")]), day(3, [photo("last")]), day(1, [photo("before")]), day(2, [photo("first")])], new Map());
  assert.deepEqual(memory.slides.map(slide => slide.media.id), ["first", "last"]);
});

test("既有评分判为敏感的照片不进入播放器，即使旧精选池还含有该 ID", () => {
  const memory = buildTripMemory(trip, [day(1, [photo("safe"), photo("sensitive")])], new Map([["sensitive", { sensitive: true }]]));
  assert.deepEqual(memory.slides.map(slide => slide.media.id), ["safe"]);
});

test("当前已确认的每条旅程与温州居住段均有独立散文，日期及事实改动不复用旧稿", () => {
  for (const item of syncTrips([])) {
    const essay = tripEssay(item);
    assert.equal(essay.authored, true, item.id);
    assert.ok(essay.paragraphs.length >= 2, item.id);
    assert.ok(!essay.paragraphs.includes(item.summary), "正文不是直接重贴日记摘要");
    assert.equal(tripEssay({ ...item, to: "2027-01-01" }).authored, false);
    assert.equal(tripEssay({ ...item, summary: "新的已确认事实" }).authored, false);
  }
  assert.equal(TRIPS.length, 30);
});

test("只有出发记录也有对应短文；不把出发变成完整往返行程", () => {
  const record = { ...trip, id: "record-2026-09-24-cn-zj-wenzhou", title: "中午坐了小马桶，晚上出发回温州过中秋", from: "2026-09-24", to: "2026-09-24", recordOnly: true };
  assert.equal(tripEssay(record).authored, true);
  assert.ok(!/返程|回到杭州|抵达/.test(tripEssay(record).paragraphs.join("")));
  assert.equal(tripEssay({ ...record, title: "新的出行标题" }).authored, false);
  const newTrip = { ...trip, id: "future-trip" };
  assert.deepEqual(tripEssay(newTrip).paragraphs, [newTrip.summary], "新事实先保留真实记录，不生成假散文");
});

test("散文记录缺证据、重复、日期倒置或空正文时拒绝", () => {
  const entry = { tripId: "t", from: "2026-01-01", to: "2026-01-02", basis: "已确认事实", title: "散文", paragraphs: ["第一段", "第二段"] };
  const validate = essays => validateEssays({ schema: "nianlife.travel-essays/1", essays });
  assert.doesNotThrow(() => validate([entry]));
  assert.throws(() => validate([entry, entry]), /重复/);
  assert.throws(() => validate([{ ...entry, basis: undefined }]), /依据/);
  assert.throws(() => validate([{ ...entry, from: "2026-01-03" }]), /from\/to/);
  assert.throws(() => validate([{ ...entry, paragraphs: ["", "第二段"] }]), /正文/);
});
