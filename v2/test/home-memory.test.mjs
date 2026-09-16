// 首页改版 2026-09-16 的三个纯函数：选片、情绪配乐、每周提醒的 7 天窗口。
//
// 这些测试钉的是**产品承诺**，不是实现细节：一段回忆必须来自同一天、必须折叠连拍、
// 配文必须是原文；提醒必须按"最近一次提及"而不是"首次提出"判窗口，来源必须是微信。
import test from "node:test";
import assert from "node:assert/strict";
import { selectHomeMemory, MEMORY_MIN_SLIDES, MEMORY_MAX_SLIDES } from "../lib/home-memory.ts";
import { moodFor, trackSrc } from "../lib/home-memory-mood.ts";
import { reminderInWindow, lastMentionedOn, windowStart } from "../lib/home-reminder-window.ts";
import { lastMentionFrom } from "../lib/upcoming-contract.ts";

// ── 选片 ──────────────────────────────────────────────────────────────────────

// 一张照片：默认大到能当主图，带拍摄时刻。
const photo = (id, takenAt, extra = {}) => ({
  id, src: `/api/media/${id}?variant=web`, thumbnailSrc: null,
  width: 3000, height: 4000, type: "photo", posterSrc: null,
  takenAt, durationSeconds: null, alt: "一张照片", ...extra,
});

// 同一时刻的连拍：同一个 takenAt 复制 n 张（生产里原图 + 缩放版就是这个形状）。
const burst = (prefix, takenAt, n) => Array.from({ length: n }, (_, i) => photo(`${prefix}-${i}`, takenAt));

function archiveWith(photos, { day = "2026-09-08", memories, trusted = true } = {}) {
  const ids = photos.map((p) => p.id);
  return {
    time: { today: "2026-09-16" },
    birthDay: "2025-01-03",
    privilege: { confirmed: new Set(), trusted: new Set(trusted ? ids : []), checked: new Set() },
    chapters: [{
      year: "2026",
      months: [{
        month: "2026-09",
        memories: memories ?? [{
          id: "event-1", title: "全部倒出来，自己说「倒」", weight: "memory",
          signature: { day, dateLabel: "2026 年 9 月 8 日", ageLabel: "1 岁 8 个月" },
          noPhoto: false, photoCount: photos.length, videoCount: 0,
        }],
        photoDays: [{ day, dateLabel: "2026 年 9 月 8 日", ageLabel: "1 岁 8 个月", photos }],
      }],
    }],
  };
}

test("一段回忆来自同一天，并且按 90 秒把连拍折叠成不同的瞬间", () => {
  // 8 个瞬间，每个瞬间 4 张连拍 = 32 行，但只该出 8 张。
  const photos = Array.from({ length: 8 }, (_, i) =>
    burst(`m${i}`, `2026-09-08 ${String(9 + i).padStart(2, "0")}:00:00`, 4)).flat();
  const { memory } = selectHomeMemory(archiveWith(photos));
  assert.ok(memory, "应当选出一段回忆");
  assert.equal(memory.slides.length, 8, "8 个瞬间出 8 张，32 行连拍不能变成 32 张");
  assert.equal(memory.photoCount, 32, "折叠前的真实张数照实记录（只进审计，不显示）");
  assert.ok(memory.slides.every((s) => s.key.startsWith("2026-09-08|")), "每一张都来自同一天");
});

test("不足 6 个瞬间的一天不成为回忆——宁可没有，不凑数", () => {
  const photos = Array.from({ length: 5 }, (_, i) =>
    burst(`m${i}`, `2026-09-08 1${i}:00:00`, 6)).flat(); // 30 行，但只有 5 个瞬间
  const { memory, absence } = selectHomeMemory(archiveWith(photos));
  assert.equal(memory, undefined);
  assert.equal(absence.kind, "no_qualified_day");
  assert.match(absence.reason, new RegExp(String(MEMORY_MIN_SLIDES)));
});

test("超过上限时沿整天均匀取，不砍掉后半天", () => {
  // 20 个瞬间，从早 6 点到晚 10 点（每小时不到一个）。
  const photos = Array.from({ length: 20 }, (_, i) =>
    photo(`m${i}`, `2026-09-08 ${String(6 + i).padStart(2, "0")}:0${i % 6}:00`)).flat();
  const { memory } = selectHomeMemory(archiveWith(photos));
  assert.equal(memory.slides.length, MEMORY_MAX_SLIDES);
  const first = memory.slides[0].media.id;
  const last = memory.slides[memory.slides.length - 1].media.id;
  assert.equal(first, "m0", "开头是这一天的第一个瞬间");
  assert.equal(last, "m19", "结尾是这一天的最后一个瞬间——不是被截断在中午");
});

test("没有来源担保的照片一张都不进（门槛和月末相册同一套）", () => {
  const photos = Array.from({ length: 8 }, (_, i) => photo(`m${i}`, `2026-09-08 1${i}:00:00`));
  const { memory, absence } = selectHomeMemory(archiveWith(photos, { trusted: false }));
  assert.equal(memory, undefined, "trusted/checked 都没有时不该出回忆");
  assert.equal(absence.kind, "no_qualified_day");
});

test("配文只用当天已发布记忆的标题原文，且不压在第一张和最后一张上", () => {
  const photos = Array.from({ length: 9 }, (_, i) => photo(`m${i}`, `2026-09-08 ${9 + i}:00:00`));
  const { memory } = selectHomeMemory(archiveWith(photos));
  const captions = memory.slides.map((s) => s.caption).filter(Boolean);
  assert.ok(captions.length >= 1 && captions.length <= 2, "少量配文，1–2 条");
  for (const caption of captions) {
    assert.equal(caption, "全部倒出来，自己说「倒」", "配文必须是标题原文，不是生成的句子");
  }
  assert.equal(memory.slides[0].caption, undefined, "第一张先让人看照片");
  assert.equal(memory.slides[memory.slides.length - 1].caption, undefined, "结尾自然停住，不用一句话收尾");
});

test("没有已发布记忆的一天不做回忆——它得有真名字和能点进去的去处", () => {
  const photos = Array.from({ length: 8 }, (_, i) => photo(`m${i}`, `2026-09-08 1${i}:00:00`));
  const { memory } = selectHomeMemory(archiveWith(photos, { memories: [] }));
  assert.equal(memory, undefined);
});

// ── 配乐情绪 ──────────────────────────────────────────────────────────────────

test("晚上收尾的一天配安静的曲子", () => {
  const verdict = moodFor({ slides: 10, photos: 40, firstHour: 8, lastHour: 21, titles: [] });
  assert.equal(verdict.mood, "calm");
  assert.match(verdict.reason, /21 点/);
});

test("已发布标题里的实词能决定情绪，且理由说得出是哪个词", () => {
  assert.equal(moodFor({ slides: 8, photos: 20, firstHour: 9, lastHour: 16, titles: ["爸爸说儿子一直在笑"] }).mood, "bright");
  assert.equal(moodFor({ slides: 8, photos: 20, firstHour: 9, lastHour: 16, titles: ["周末去公园"] }).mood, "open");
  const calm = moodFor({ slides: 8, photos: 20, firstHour: 9, lastHour: 17, titles: ["到了时间，他会自己爬上床"] });
  assert.equal(calm.mood, "calm");
  assert.match(calm.reason, /床/);
});

test("普通的一天落到温柔，并且说明白是没命中而不是判不出来", () => {
  const verdict = moodFor({ slides: 8, photos: 16, firstHour: 10, lastHour: 15, titles: ["中午剩了点饭"] });
  assert.equal(verdict.mood, "tender");
  assert.match(verdict.reason, /没有命中/);
});

test("四种情绪各有各的音轨，不是同一个文件换名字", () => {
  const all = ["bright", "tender", "calm", "open"].map(trackSrc);
  assert.equal(new Set(all).size, 4);
});

// ── 每周提醒的 7 天窗口 ────────────────────────────────────────────────────────

const wechat = { raised: { role: { kind: "family_member", role: "妈妈" }, modality: "plan", summary: "s", onDay: "2026-09-12" }, reviewState: "approved", itemId: "i", noChangeEvidence: true };
const recordCheck = { raised: { role: { kind: "record_check", label: "档案核对提醒" }, modality: "statement", summary: "s", onDay: "2026-09-13" }, reviewState: "approved", itemId: "i", noChangeEvidence: true };

test("窗口是含今天的 7 个自然日", () => {
  assert.equal(windowStart("2026-09-16"), "2026-09-10");
});

test("最近一次提及压过首次提出——这正是 evidence.day 单独不够用的地方", () => {
  const item = { evidence: { day: "2026-08-04" }, lastMentionedOn: "2026-09-12" };
  assert.equal(lastMentionedOn(item), "2026-09-12");
  assert.equal(reminderInWindow(item, wechat, "2026-09-16").inWindow, true);
});

test("只在首次提出、之后没人再提的旧事，落在窗口外（不是过期，只是不属于本周）", () => {
  const item = { evidence: { day: "2026-08-11" } };
  const verdict = reminderInWindow(item, wechat, "2026-09-16");
  assert.equal(verdict.inWindow, false);
  assert.match(verdict.reason, /早于窗口起点/);
});

test("档案核对提醒不是微信提及，即使日期在窗口内也不显示", () => {
  const item = { evidence: { day: "2026-09-13" } };
  const verdict = reminderInWindow(item, recordCheck, "2026-09-16");
  assert.equal(verdict.inWindow, false);
  assert.match(verdict.reason, /不是微信/);
});

test("没有任何消息日期时不显示，且绝不拿今天顶替起算点", () => {
  const verdict = reminderInWindow({ evidence: undefined }, wechat, "2026-09-16");
  assert.equal(verdict.inWindow, false);
  assert.match(verdict.reason, /没有可用的消息日期/);
});

test("lastMentionFrom 只认 restated / rescheduled，不把完成当成一次提及", () => {
  assert.equal(lastMentionFrom([
    { day: "2026-09-01", change: "restated" },
    { day: "2026-09-10", change: "done" },
  ]), "2026-09-01", "done 不算又被提起");
  assert.equal(lastMentionFrom([
    { day: "2026-09-01", change: "restated" },
    { day: "2026-09-08", change: "rescheduled" },
  ]), "2026-09-08");
  assert.equal(lastMentionFrom([]), undefined);
});
