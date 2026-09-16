// 首页数据契约 (lib/home-feed.ts). **每一条 fixture 都是合成的**——真实的家庭标题与健康细节不进
// Git（test/upcoming-feed.test.mjs 立的同一条规矩），对生产真实数据的核验在仓库外：
// NianlifeOps/home-2026-09-13/data/home-feed-verification.json。
// 这里守的是几条会直接在苏静眼前出错的规则：
// 六小时内刷新不换、跨期会换、图和故事不串、撤销立刻生效、候选不足时降级说实话、
// 陈旧待办不默认露出但也不被写成完成、关键健康事项不因过期消失、时区边界。
import test from "node:test";
import assert from "node:assert/strict";
import { buildChapters } from "../lib/memory-chapters.ts";
import { storyPhotoConfirmationsFrom } from "../lib/media/story-binding.ts";
import {
  buildHomeFeed, buildPhotoCandidates, buildReminders, candidateMemories, deadlineLabelOf,
  deterministicQuality, editionAt, EDITION_HOURS, HOME_FEED_VERSION, isImportantReminder,
  QUALITY_NOT_ASSESSED, reminderStateOf, REMINDERS_MAX_SHOWN, cooldownOf, HOME_PHOTO_CANDIDATES_MAX,
  isAtOrAfterEditionStart, parseLedgerTime,
} from "../lib/home-feed.ts";
import { execFileSync } from "node:child_process";

const BIRTH = "2025-01-03";
const TODAY = "2026-09-13";

const event = (id, day, extra = {}) => ({
  id, profileId: "p", title: `记忆 ${id}`, story: "一段真实的故事。", occurredAt: `${day} 00:00:00+00`,
  people: [], tags: [], contentTypes: ["family"], mediaIds: [], sourceIds: [], growthRecordIds: [],
  careRecordIds: [], eventType: "moment", memoryWeight: "memory", scopes: ["family"],
  visibility: "family", keptInYearbook: false, ...extra,
});

const photo = (id, day, extra = {}) => ({
  id, profileId: "p", type: "photo", src: `https://example.test/${id}.jpg`, thumbnailSrc: `https://example.test/${id}-t.jpg`,
  width: 2000, height: 1500, takenAt: `${day}T10:00:00+08:00`, visibility: "family", rawSourceId: `src-${id}`,
  ...extra,
});

// 一对 (故事, 照片) 只有在账本里有一条 media_binding=approved 时才是候选（Basis C）。
const binding = (eventId, mediaId, decision = "approved", extra = {}) => ({
  id: `rev-${eventId}-${mediaId}`, targetKind: "media_binding", targetId: `${eventId}|${mediaId}`,
  decision, reviewedAt: "2026-09-01T00:00:00Z", ...extra,
});

function archiveOf({ events, media = [], reviews = [], today = TODAY }) {
  const deliverable = new Set(media.map((item) => item.id));
  // 走生产那条账本读法，不在测试里自己写一个「approved 就算」的简化版：撤回是靠「同一对上最新那条
  // 决定」生效的（lib/media/story-binding.ts latestStoryPhotoDecisions），自己实现一遍就测不到它。
  const confirmations = storyPhotoConfirmationsFrom(reviews);
  return {
    store: { qualityReviews: reviews },
    media, events, traceEvents: [], eventIdentities: events,
    chapters: buildChapters({ events, traces: [], media, deliverable, birthDay: BIRTH, photoConfirmations: confirmations }),
    birthDay: BIRTH, snapshots: [], privilege: { confirmed: new Set(), trusted: new Set(), checked: new Set() },
    time: { today, activityDay: today },
  };
}

// ── 期次 ─────────────────────────────────────────────────────────────────────

test("期次是 Asia/Shanghai 的六小时档，六小时内刷新永远同一期", () => {
  const a = editionAt(new Date("2026-09-13T04:00:00+08:00"));
  const b = editionAt(new Date("2026-09-13T05:59:59+08:00"));
  assert.equal(a.id, b.id, "同一档内两次刷新必须是同一期");
  assert.equal(a.index, b.index);
  assert.equal(a.id, "2026-09-13#0");
  assert.equal(a.startedAt, "2026-09-13T00:00:00+08:00");
  assert.equal(a.expiresAt, "2026-09-13T06:00:00+08:00");
  assert.ok(Number(a.expiresAt.slice(11, 13)) - Number(a.startedAt.slice(11, 13)) === EDITION_HOURS);
});

test("跨过六小时边界就换一期，序号加一", () => {
  const before = editionAt(new Date("2026-09-13T05:59:59+08:00"));
  const after = editionAt(new Date("2026-09-13T06:00:01+08:00"));
  assert.notEqual(before.id, after.id);
  assert.equal(after.index, before.index + 1);
  assert.equal(after.id, "2026-09-13#1");
});

test("期次跟的是上海的日历，不是 UTC 的", () => {
  // 2026-09-13 16:30 UTC 在上海已经是 9 月 14 日 00:30 —— 新的一天、当天第 0 档。
  const edition = editionAt(new Date("2026-09-13T16:30:00.000Z"));
  assert.equal(edition.id, "2026-09-14#0", "UTC 日期会算成 9-13#4，那一档根本不存在");
  assert.equal(edition.slot, 0);
  // 当天最后一档的到期时间跨到第二天 00:00，而不是写成 24:00。
  const last = editionAt(new Date("2026-09-13T23:30:00+08:00"));
  assert.equal(last.id, "2026-09-13#3");
  assert.equal(last.expiresAt, "2026-09-14T00:00:00+08:00");
});

// ── 照片候选 ─────────────────────────────────────────────────────────────────

test("只有逐 (eventId, mediaId) 人工审核过的照片才进候选；同日、trusted 都不算", () => {
  const bound = photo("m-bound", "2026-09-07");
  const sameDay = photo("m-sameday", "2026-09-07");
  const events = [
    event("e-bound", "2026-09-07", { mediaIds: [bound.id, sameDay.id] }),
    event("e-plain", "2026-09-05", { mediaIds: [sameDay.id] }),
  ];
  const archive = archiveOf({
    events, media: [bound, sameDay],
    // 只给 (e-bound, m-bound) 一条 approved；同一天的另一张、以及别的故事都没有。
    reviews: [binding("e-bound", bound.id)],
  });
  const feed = buildHomeFeed(archive, { edition: editionAt(new Date("2026-09-13T09:00:00+08:00")) });
  assert.equal(feed.photoCandidates.length, 1, "只有一对通过了逐张审核");
  assert.equal(feed.photoCandidates[0].photo.media.id, bound.id);
  assert.deepEqual(feed.photoCandidates[0].photo.approval, { kind: "story_binding", eventId: "e-bound" });
  assert.equal(feed.lead.photo.media.id, bound.id);
  assert.equal(feed.lead.story.eventId, "e-bound", "照片和故事必须同属一个事件");
});

test("图和故事不串：候选的 key、故事、照片三者始终同源", () => {
  const p1 = photo("m-1", "2026-09-07");
  const p2 = photo("m-2", "2026-08-20", { takenAt: "2026-08-20T11:00:00+08:00" });
  const events = [
    event("e-1", "2026-09-07", { mediaIds: [p1.id] }),
    event("e-2", "2026-08-20", { mediaIds: [p2.id] }),
  ];
  const archive = archiveOf({ events, media: [p1, p2], reviews: [binding("e-1", p1.id), binding("e-2", p2.id)] });
  for (const hour of [1, 7, 13, 19]) {
    const feed = buildHomeFeed(archive, { edition: editionAt(new Date(`2026-09-13T${String(hour).padStart(2, "0")}:00:00+08:00`)) });
    for (const candidate of feed.photoCandidates) {
      assert.equal(candidate.key, `${candidate.story.eventId}|${candidate.photo.media.id}`);
      assert.equal(candidate.photo.approval.eventId, candidate.story.eventId, "配图的批准对象必须就是它旁边那段故事");
      assert.equal(candidate.photo.day, candidate.story.day, "照片的日子和故事的日子是同一天");
    }
    assert.equal(feed.lead.photo.approval.eventId, feed.lead.story.eventId);
    // 换了期次，标题/日期/链接是跟着照片一起换的，不会只换图。
    assert.equal(feed.lead.story.href, `/events/${feed.lead.story.eventId}`);
  }
});

test("跨期会换、同期不会换 —— 两组候选轮着来", () => {
  const p1 = photo("m-1", "2026-09-07");
  const p2 = photo("m-2", "2026-08-20", { takenAt: "2026-08-20T11:00:00+08:00" });
  const events = [event("e-1", "2026-09-07", { mediaIds: [p1.id] }), event("e-2", "2026-08-20", { mediaIds: [p2.id] })];
  const archive = archiveOf({ events, media: [p1, p2], reviews: [binding("e-1", p1.id), binding("e-2", p2.id)] });
  const chosenAt = (iso) => buildHomeFeed(archive, { edition: editionAt(new Date(iso)) }).lead.photo.media.id;
  const slot0 = chosenAt("2026-09-13T02:00:00+08:00");
  assert.equal(chosenAt("2026-09-13T05:30:00+08:00"), slot0, "同一档内刷新不换");
  const slot1 = chosenAt("2026-09-13T07:00:00+08:00");
  assert.notEqual(slot1, slot0, "两组候选，下一期必须换另一组");
  assert.equal(chosenAt("2026-09-13T13:00:00+08:00"), slot0, "两期一轮，第三期回到第一组");
});

test("撤销展示资格立刻生效，优先于期次：同一个期次 id 落到另一张仍然合格的图上", () => {
  const p1 = photo("m-1", "2026-09-07");
  const p2 = photo("m-2", "2026-08-20", { takenAt: "2026-08-20T11:00:00+08:00" });
  const events = [event("e-1", "2026-09-07", { mediaIds: [p1.id] }), event("e-2", "2026-08-20", { mediaIds: [p2.id] })];
  const edition = editionAt(new Date("2026-09-13T02:00:00+08:00"));
  const before = buildHomeFeed(
    archiveOf({ events, media: [p1, p2], reviews: [binding("e-1", p1.id), binding("e-2", p2.id)] }),
    { edition },
  );
  const revoked = before.lead.photo.media.id;
  const revokedEvent = before.lead.story.eventId;
  // 同一对上写一条更晚的 rejected —— 撤回，不删行。
  const after = buildHomeFeed(
    archiveOf({
      events, media: [p1, p2],
      reviews: [
        binding("e-1", p1.id), binding("e-2", p2.id),
        binding(revokedEvent, revoked, "rejected", { id: "rev-late", reviewedAt: "2026-09-12T00:00:00Z" }),
      ],
    }),
    { edition },
  );
  assert.equal(after.edition.id, before.edition.id, "期次没变");
  assert.notEqual(after.lead.photo.media.id, revoked, "被撤回的那张不能再出现，哪怕这一期还没过");
  assert.ok(after.photoCandidates.every((candidate) => candidate.photo.media.id !== revoked));
});

test("候选不足时冷却被缩短，理由写在候选上，门槛不放宽", () => {
  const p1 = photo("m-1", "2026-09-07");
  const events = [event("e-1", "2026-09-07", { mediaIds: [p1.id] })];
  const archive = archiveOf({ events, media: [p1], reviews: [binding("e-1", p1.id)] });
  const feed = buildHomeFeed(archive, { edition: editionAt(new Date("2026-09-13T09:00:00+08:00")) });
  assert.equal(feed.photoCandidates.length, 1);
  // 缩短了多少现在是量出来的数，不是一句话：一组候选 → 一期一轮 → 0.25 天，离 14 天差得远。
  const cooldown = feed.photoCandidates[0].cooldown;
  assert.equal(cooldown.editions, 1);
  assert.equal(cooldown.days, 0.25);
  assert.equal(cooldown.meetsTarget, false);
  assert.match(cooldown.shortfall, /可达上限/);
  assert.match(cooldown.shortfall, /门槛未放宽/);
  // 唯一一组候选反复出现是诚实的；拒绝展示它不是。
  const later = buildHomeFeed(archive, { edition: editionAt(new Date("2026-09-13T21:00:00+08:00")) });
  assert.equal(later.lead.photo.media.id, p1.id);
});

test("连拍同一时刻只取一张，而且是先过滤再分组（合格的那张不会被不合格的挡住）", () => {
  // 同一秒的三张：两张没有审核记录、一张有。先分组再过滤会让有审核的那张永远选不中。
  const shots = ["m-a", "m-b", "m-c"].map((id) => photo(id, "2026-09-07", { takenAt: "2026-09-07T10:00:00+08:00" }));
  const events = [event("e-1", "2026-09-07", { mediaIds: shots.map((item) => item.id) })];
  const archive = archiveOf({ events, media: shots, reviews: [binding("e-1", "m-c")] });
  const feed = buildHomeFeed(archive, { edition: editionAt(new Date("2026-09-13T09:00:00+08:00")) });
  assert.equal(feed.photoCandidates.length, 1);
  assert.equal(feed.photoCandidates[0].photo.media.id, "m-c", "被挡在后面的那张审核过的照片仍然要能当头图");
});

test("同一时刻的两对候选，一期只出一张，另一张记「连拍里已经取了一张」", () => {
  const p1 = photo("m-1", "2026-09-07", { takenAt: "2026-09-07T10:00:00+08:00" });
  const p2 = photo("m-2", "2026-09-07", { takenAt: "2026-09-07T10:00:30+08:00" });
  const events = [event("e-1", "2026-09-07", { mediaIds: [p1.id] }), event("e-2", "2026-09-07", { mediaIds: [p2.id] })];
  const archive = archiveOf({ events, media: [p1, p2], reviews: [binding("e-1", p1.id), binding("e-2", p2.id)] });
  const candidates = buildHomeFeed(archive, { edition: editionAt(new Date("2026-09-13T09:00:00+08:00")) }).photoCandidates;
  assert.equal(candidates.filter((candidate) => candidate.chosen).length, 1);
  assert.equal(candidates.length, 2, "被分组挡下的那张仍然列出来，带原因");
  assert.match(candidates.find((candidate) => !candidate.chosen).reason, /连拍/);
});

// ── 质量评分 ─────────────────────────────────────────────────────────────────

test("没有视觉评估结果时是确定性降级分，明确标注，不伪造 AI 评分", () => {
  const quality = deterministicQuality({ media: photo("m", "2026-09-07"), day: "2026-09-07" }, TODAY, QUALITY_NOT_ASSESSED);
  assert.equal(quality.source, "deterministic");
  assert.equal(quality.degraded, QUALITY_NOT_ASSESSED);
  assert.equal(quality.interaction, 0, "互动/动作这一项元数据看不出来，留 0 让「还没评过」在分数里看得见");
  assert.ok(quality.score > 0 && quality.score <= 100);
});

test("模型失败/查不到时首页照样出内容，只是分数标成降级", () => {
  const p1 = photo("m-1", "2026-09-07");
  const events = [event("e-1", "2026-09-07", { mediaIds: [p1.id] })];
  const archive = archiveOf({ events, media: [p1], reviews: [binding("e-1", p1.id)] });
  const feed = buildHomeFeed(archive, {
    edition: editionAt(new Date("2026-09-13T09:00:00+08:00")),
    quality: () => { throw new Error("视觉服务不可用"); },
  });
  // 抛错的 lookup 不该把首页整页打掉：这里断言的是契约要求「模型失败仍可渲染真实内容」。
  assert.ok(feed.lead, "首页仍然有主故事");
  assert.equal(feed.lead.photo.quality.source, "deterministic");
});

test("有真实视觉评估结果时按分数排序，分高的先出", () => {
  const p1 = photo("m-low", "2026-09-07");
  const p2 = photo("m-high", "2026-08-20", { takenAt: "2026-08-20T11:00:00+08:00" });
  const events = [event("e-1", "2026-09-07", { mediaIds: [p1.id] }), event("e-2", "2026-08-20", { mediaIds: [p2.id] })];
  const archive = archiveOf({ events, media: [p1, p2], reviews: [binding("e-1", p1.id), binding("e-2", p2.id)] });
  const scores = { "m-low": 20, "m-high": 90 };
  const feed = buildHomeFeed(archive, {
    edition: { id: "t", startedAt: "x", expiresAt: "y", slot: 0, index: 0 },
    quality: (mediaId) => ({
      score: scores[mediaId], interaction: 0, readability: 0, context: 0, distinction: 0,
      source: "ai_vision", model: "test-vision", assessedAt: "2026-09-13T00:00:00Z",
    }),
  });
  assert.equal(feed.photoCandidates[0].photo.media.id, "m-high", "日期更旧但分更高的排前面");
  assert.equal(feed.lead.photo.quality.source, "ai_vision");
});

// ── 没有合格图 ───────────────────────────────────────────────────────────────

test("一对合格候选都没有时保留真实文字，并说清是哪一种「没有照片」", () => {
  const attached = photo("m-1", "2026-09-07");
  const events = [
    event("e-has-media", "2026-09-07", { mediaIds: [attached.id] }),
    event("e-no-media", "2026-09-05"),
    event("e-reviewed-none", "2026-09-03", { mediaIds: [attached.id], heroMediaId: "none" }),
  ];
  const archive = archiveOf({ events, media: [attached], reviews: [] });
  const seen = new Set();
  for (let index = 0; index < 3; index += 1) {
    const feed = buildHomeFeed(archive, { edition: { id: `t${index}`, startedAt: "x", expiresAt: "y", slot: 0, index } });
    assert.equal(feed.photoCandidates.length, 0, "没有审核过的对，就一个候选都没有");
    assert.equal(feed.lead.photo, undefined, "不画空照片框");
    assert.ok(feed.lead.photoAbsence, "必须说出是哪一种没有");
    seen.add(`${feed.lead.story.eventId}:${feed.lead.photoAbsence}`);
  }
  assert.ok(seen.has("e-has-media:no_reviewed_binding"), "挂着照片但没人审过 → 缺证据");
  assert.ok(seen.has("e-no-media:no_media_at_all"), "本来就没附件 → 没有材料");
  assert.ok(seen.has("e-reviewed-none:reviewed_no_photo"), "有人判过这段不配图 → 做过的决定");
});

test("窗口里一段已发布记忆都没有时，lead 为空且写明原因，不编一段内容", () => {
  const archive = archiveOf({ events: [event("e-old", "2026-01-01")] });
  const feed = buildHomeFeed(archive, { edition: editionAt(new Date("2026-09-13T09:00:00+08:00")) });
  assert.equal(feed.lead, undefined);
  assert.equal(feed.leadAbsence.kind, "empty_material");
  assert.match(feed.leadAbsence.reason, /60 天/);
});

// ── 时钟与近况 ───────────────────────────────────────────────────────────────

test("时钟是档案的今天和今天的年龄，和选中的故事日期无关", () => {
  const p1 = photo("m-1", "2026-08-20", { takenAt: "2026-08-20T11:00:00+08:00" });
  const events = [event("e-1", "2026-08-20", { mediaIds: [p1.id] })];
  const archive = archiveOf({ events, media: [p1], reviews: [binding("e-1", p1.id)] });
  const feed = buildHomeFeed(archive, { edition: editionAt(new Date("2026-09-13T09:00:00+08:00")) });
  assert.equal(feed.version, HOME_FEED_VERSION);
  assert.equal(feed.clock.today, TODAY);
  assert.equal(feed.clock.todayLabel, "2026 年 9 月 13 日");
  assert.equal(feed.clock.ageToday, "1 岁 8 个月");
  assert.equal(feed.lead.story.day, "2026-08-20", "故事带自己的日子");
  assert.equal(feed.lead.story.ageLabel, "1 岁 7 个月", "旧内容带自己的当时年龄");
  assert.equal(feed.lead.photo.ageLabel, "1 岁 7 个月", "照片也带自己的当时年龄");
});

test("近况至多一条，且绝不和主故事重复", () => {
  const p1 = photo("m-1", "2026-09-07");
  const events = [
    event("e-1", "2026-09-07", { mediaIds: [p1.id] }),
    event("e-2", "2026-09-05"), event("e-3", "2026-09-04"),
  ];
  const archive = archiveOf({ events, media: [p1], reviews: [binding("e-1", p1.id)] });
  for (let index = 0; index < 6; index += 1) {
    const feed = buildHomeFeed(archive, { edition: { id: `t${index}`, startedAt: "x", expiresAt: "y", slot: 0, index } });
    assert.notEqual(feed.recentFact.eventId, feed.lead.story.eventId);
    assert.equal(feed.recentFact.href, `/events/${feed.recentFact.eventId}`);
  }
});

test("候选窗口按日历算，未来日期的记录进不了首页", () => {
  const chapters = archiveOf({
    events: [event("e-in", "2026-07-16"), event("e-out", "2026-07-15"), event("e-future", "2026-09-14")],
  }).chapters;
  const ids = candidateMemories(chapters, TODAY).map((memory) => memory.id);
  assert.deepEqual(ids, ["e-in"], "第 60 天在窗口内，第 61 天在窗口外，明天的一律不进");
});

// ── 提醒保鲜 ─────────────────────────────────────────────────────────────────

const item = (id, overrides = {}) => ({
  id, title: `事项 ${id}`, when: { kind: "unconfirmed" }, status: "open",
  evidence: { eventId: `ev-${id}`, day: "2026-08-16" }, ...overrides,
});

test("过了日子又没有完成记录的事项不默认露出，但也不写成完成", () => {
  const stale = item("shoes", { title: "取回一件落在外面的东西", when: { kind: "day", day: "2026-08-11" } });
  const reminders = buildReminders({ status: "ready", items: [stale] }, TODAY, undefined);
  assert.equal(reminders.status, "ready");
  assert.equal(reminders.shown.length, 0, "一个月前的旧账不占首页");
  assert.equal(reminders.retired.length, 1);
  assert.equal(reminders.retired[0].status, "open", "库里那一行还是 open —— 退场不等于完成");
  assert.match(reminders.retired[0].reason, /没有完成记录/);
  assert.equal(reminders.more.length, 1, "它仍然可达，一条都没丢");
});

test("区间看的是结束日：还盖着今天的计划不算过期", () => {
  const covering = item("trip", { title: "下周出门一次", status: "tentative", when: { kind: "window", fromDay: "2026-09-07", toDay: TODAY } });
  const past = item("trip-old", { title: "上个周末出门一次", status: "tentative", when: { kind: "window", fromDay: "2026-08-22", toDay: "2026-08-23" } });
  const supers = new Set();
  assert.equal(reminderStateOf(covering, TODAY, supers).state, "tentative");
  assert.equal(reminderStateOf(past, TODAY, supers).state, "expired");
});

test("关键健康事项即使时间待确认也保留待核实摘要，不生成医疗期限", () => {
  const shot = item("vax", { title: "去门诊核对一次接种记录" });
  const state = reminderStateOf(shot, TODAY, new Set());
  assert.equal(state.state, "needs_confirmation");
  assert.ok(isImportantReminder(shot));
  assert.equal(deadlineLabelOf(shot.when), "时间待确认", "不猜日期，也不生成一个医疗期限");
});

test("关键事项排在最前，默认最多两条，其余保持可达", () => {
  const items = [
    item("eggs", { title: "买一样日用品" }),
    item("cream", { title: "回家做一件当天的小事" }),
    item("vax", { title: "去门诊核对一次接种记录" }),
    item("today", { title: "今天要带的东西", when: { kind: "day", day: TODAY } }),
  ];
  const reminders = buildReminders({ status: "ready", items }, TODAY, undefined);
  assert.equal(reminders.shown.length, REMINDERS_MAX_SHOWN);
  assert.equal(reminders.shown[0].id, "vax", "关键待核实排第一");
  assert.equal(reminders.shown[1].id, "today");
  assert.equal(reminders.shown.length + reminders.more.length, items.length, "露出的加折叠的等于全部，一条不丢");
});

test("没有关键事项时默认只露一条", () => {
  const items = [item("a", { when: { kind: "day", day: TODAY } }), item("b", { when: { kind: "day", day: "2026-09-20" } })];
  const reminders = buildReminders({ status: "ready", items }, TODAY, undefined);
  assert.equal(reminders.shown.length, 1);
  assert.equal(reminders.shown[0].id, "a", "先到的那天排前面");
});

test("被取代的事项标成 superseded，不标成完成", () => {
  const items = [item("old"), item("new", { supersedes: ["old"] })];
  const reminders = buildReminders({ status: "ready", items }, TODAY, undefined);
  const old = [...reminders.shown, ...reminders.more].find((reminder) => reminder.id === "old");
  assert.equal(old.state, "superseded");
  assert.equal(old.item.status, "open", "库里没有被改成 done");
});

test("读不到 / 没跑完 / 读失败，三种都不说成「没有待办」", () => {
  assert.equal(buildReminders(undefined, TODAY, undefined).unavailable.kind, "not_extracted");
  assert.equal(
    buildReminders({ status: "unavailable", reason: "the upcoming read threw: boom" }, TODAY, undefined).unavailable.kind,
    "read_failed",
  );
  assert.equal(
    buildReminders({ status: "unavailable", reason: "nothing is approved yet and rows are waiting on a reviewer" }, TODAY, undefined).unavailable.kind,
    "not_extracted",
  );
  assert.equal(
    buildReminders({ status: "unavailable", reason: "no item survived the page-side gate" }, TODAY, undefined).unavailable.kind,
    "empty_material",
  );
  const clear = buildReminders({ status: "clear", windowFrom: "2026-09-01", readToDay: "2026-09-13" }, TODAY, undefined);
  assert.equal(clear.status, "clear", "只有真的读完整个窗口才能说「已检查，没有待办」");
});

test("同一份待办重放两次，结果逐字相同（同源幂等）", () => {
  const items = [item("eggs", { title: "买一样日用品" }), item("vax", { title: "去体检" })];
  const first = buildReminders({ status: "ready", items }, TODAY, undefined);
  const again = buildReminders({ status: "ready", items: [...items] }, TODAY, undefined);
  assert.deepEqual(
    first.shown.map((reminder) => [reminder.id, reminder.state, reminder.reason]),
    again.shown.map((reminder) => [reminder.id, reminder.state, reminder.reason]),
  );
});

test("直接喂 buildPhotoCandidates：没有候选时返回空数组而不是抛错", () => {
  const edition = editionAt(new Date("2026-09-13T09:00:00+08:00"));
  assert.deepEqual(buildPhotoCandidates({ memories: [], birthDay: BIRTH, today: TODAY, edition }), []);
});

test("提醒的证据链：能落到具体记忆就落，落不到就退到那个月，并说清是哪一种（原则八）", () => {
  // 生产上 18 条待办**没有一条**带 evidence.eventId —— upcoming-store 写进 evidence 的只有
  // { day }。1.0.0 只认 eventId，于是这个链接对每一条真实待办都是空的：一条追不回来源的待办
  // 违反原则八。这条用例守的就是那个洞。
  const monthOnly = item("m", { evidence: { day: "2026-08-16" } });
  const withEvent = item("e", { evidence: { eventId: "ev-1", day: "2026-08-16" } });
  const none = item("n", { evidence: { eventId: "", day: "去年夏天" } });
  const feed = buildReminders({ status: "ready", items: [monthOnly, withEvent, none] }, TODAY, undefined);
  const all = [...feed.shown, ...feed.more];
  const byId = new Map(all.map((reminder) => [reminder.id, reminder]));
  assert.equal(byId.get("m").evidenceHref, "/memory/2026/08");
  assert.equal(byId.get("m").evidenceKind, "month", "页面得据此说「翻到 8 月」，不能说「看那一天」");
  assert.equal(byId.get("e").evidenceHref, "/events/ev-1");
  assert.equal(byId.get("e").evidenceKind, "event");
  // 两者都拿不到时不画一个去不了的链接。
  assert.equal(byId.get("n").evidenceHref, undefined);
  assert.equal(byId.get("n").evidenceKind, undefined);
});

test("一段故事的每张获批配图都进池；轮换按故事交错，交错不开的相邻处照实写进 reason", () => {
  // 2026-09-14：之前只取 memory.lead，获批了两张的那段故事第二张永远上不了首页。
  const a1 = photo("m-a1", "2026-09-07", { takenAt: "2026-09-07T09:00:00+08:00" });
  const a2 = photo("m-a2", "2026-09-07", { takenAt: "2026-09-07T15:00:00+08:00" });
  const b1 = photo("m-b1", "2026-08-20", { takenAt: "2026-08-20T11:00:00+08:00" });
  const c1 = photo("m-c1", "2026-08-10", { takenAt: "2026-08-10T11:00:00+08:00" });
  const events = [
    event("e-a", "2026-09-07", { mediaIds: [a1.id, a2.id] }),
    event("e-b", "2026-08-20", { mediaIds: [b1.id] }),
    event("e-c", "2026-08-10", { mediaIds: [c1.id] }),
  ];
  const reviews = [binding("e-a", a1.id), binding("e-a", a2.id), binding("e-b", b1.id), binding("e-c", c1.id)];
  const archive = archiveOf({ events, media: [a1, a2, b1, c1], reviews });
  const at = (index) => buildHomeFeed(archive, { edition: { id: `t${index}`, startedAt: "x", expiresAt: "y", slot: 0, index } });
  const candidates = at(0).photoCandidates;
  assert.deepEqual(candidates.map((c) => c.photo.media.id).sort(), ["m-a1", "m-a2", "m-b1", "m-c1"], "两张都进池");
  for (const c of candidates) assert.equal(c.photo.approval.eventId, c.story.eventId, "每张仍然只挂在批准它的那段故事上");
  // 页面按返回清单的顺序「换张照片」：清单顺序里同一段故事也不能挨着（本地实测抓到过按质量分排导致连着两张）。
  // 首尾相接也算：一圈转完回到开头、换图翻到末尾回到第一张（数据轨审查 192984a 抓到的生产形状：3 篇、4 张、其中一篇 2 张）。
  const listOrder = at(0).photoCandidates.filter((c) => c.cooldown).map((c) => c.story.eventId);
  for (let i = 0; i < listOrder.length; i += 1) assert.notEqual(listOrder[i], listOrder[(i + 1) % listOrder.length], `换图顺序（环形）里相邻两张不是同一段故事：${listOrder}`);
  const seq = [0, 1, 2, 3, 4].map((index) => at(index).lead.story.eventId);
  for (let i = 1; i < seq.length; i += 1) assert.notEqual(seq[i], seq[i - 1], "有别的故事可插时，相邻期次（含绕回开头那一期）不是同一段故事");
  assert.doesNotMatch(at(0).photoCandidates.find((c) => c.chosen).reason, /相邻两期同属一段故事|交错不开/, "2 对 2 排得开，就不许写交错不开");
  assert.equal(new Set([0, 1, 2, 3].map((index) => at(index).lead.photo.media.id)).size, 4, "一整轮四期四张各不相同");
  // 两段故事、其中一段有两张：交错不开，必须说出来。
  const tight = archiveOf({ events: events.slice(0, 2), media: [a1, a2, b1], reviews: reviews.slice(0, 3) });
  const chosen = buildHomeFeed(tight, { edition: { id: "t", startedAt: "x", expiresAt: "y", slot: 0, index: 0 } }).photoCandidates.find((c) => c.chosen);
  assert.match(chosen.reason, /相邻两期同属一段故事/);
  assert.match(chosen.reason, /超过一圈 3 张的一半，交错不开/, "只有真的超过一半才写交错不开");
});

test("照片池不按 60 天截：更早的已发布故事的获批配图也能上首页，文字兜底仍然只看 60 天", () => {
  const old = photo("m-old", "2025-06-03", { takenAt: "2025-06-03T10:00:00+08:00" });
  const events = [event("e-old", "2025-06-03", { mediaIds: [old.id] })];
  const feed = buildHomeFeed(archiveOf({ events, media: [old], reviews: [binding("e-old", old.id)] }), { edition: editionAt(new Date("2026-09-13T09:00:00+08:00")) });
  assert.equal(feed.lead.photo.media.id, "m-old", "获批配图就能进池，日期由照片自己的两个时钟说明");
  assert.equal(feed.lead.photo.dateLabel, "2025 年 6 月 3 日");
  assert.equal(feed.recentFact, undefined, "近况仍然只从 60 天窗口里取");
  // 没有获批配图的旧故事照样不会因为放宽窗口而出现在首页。
  const none = buildHomeFeed(archiveOf({ events, media: [old], reviews: [] }), { edition: editionAt(new Date("2026-09-13T09:00:00+08:00")) });
  assert.equal(none.photoCandidates.length, 0);
});

test("整个档案只有一段带获批配图的记忆时，冷却满足不了就说出来，不装作满足", () => {
  const a1 = photo("m-a1", "2026-09-07");
  const events = [event("e-a", "2026-09-07", { mediaIds: [a1.id] })];
  const archive = archiveOf({ events, media: [a1], reviews: [binding("e-a", a1.id)] });
  const candidates = buildHomeFeed(archive, { edition: { id: "t", startedAt: "x", expiresAt: "y", slot: 0, index: 0 } }).photoCandidates;
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].cooldown.meetsTarget, false, "满足不了就说满足不了");
  assert.match(candidates[0].cooldown.shortfall, /门槛未放宽/);
});

// ── 修 1：轮换次序不能依赖质量分（否则质量缓存一落地就在期中换图） ────────────────

test("质量缓存落地不会在同一期里换掉照片：轮换次序只看 mediaId，不看质量分", () => {
  const p1 = photo("m-aaa", "2026-09-07");
  const p2 = photo("m-bbb", "2026-08-20", { takenAt: "2026-08-20T11:00:00+08:00" });
  const p3 = photo("m-ccc", "2026-08-10", { takenAt: "2026-08-10T11:00:00+08:00" });
  const events = [
    event("e-1", "2026-09-07", { mediaIds: [p1.id] }),
    event("e-2", "2026-08-20", { mediaIds: [p2.id] }),
    event("e-3", "2026-08-10", { mediaIds: [p3.id] }),
  ];
  const archive = archiveOf({
    events, media: [p1, p2, p3],
    reviews: [binding("e-1", p1.id), binding("e-2", p2.id), binding("e-3", p3.id)],
  });
  const edition = editionAt(new Date("2026-09-13T09:00:00+08:00"));
  const chosenWith = (quality) => buildHomeFeed(archive, { edition, quality }).lead.photo.media.id;
  const before = chosenWith(undefined);
  const lookup = (scores) => (mediaId) => ({
    score: scores[mediaId], interaction: 0, readability: 0, context: 0, distinction: 0,
    source: "ai_vision", model: "test-vision", assessedAt: "2026-09-13T00:00:00Z",
  });
  assert.equal(chosenWith(lookup({ "m-aaa": 10, "m-bbb": 50, "m-ccc": 90 })), before, "缓存落地不该在六小时之内换掉照片（§5.5）");
  assert.equal(chosenWith(lookup({ "m-aaa": 90, "m-bbb": 50, "m-ccc": 10 })), before, "分数整个反过来也不该换");
});

test("冷却报的是量出来的数：做到几期、折算几天、离 14 天差多少", () => {
  const p1 = photo("m-1", "2026-09-07");
  const p2 = photo("m-2", "2026-08-20", { takenAt: "2026-08-20T11:00:00+08:00" });
  const events = [event("e-1", "2026-09-07", { mediaIds: [p1.id] }), event("e-2", "2026-08-20", { mediaIds: [p2.id] })];
  const archive = archiveOf({ events, media: [p1, p2], reviews: [binding("e-1", p1.id), binding("e-2", p2.id)] });
  const feed = buildHomeFeed(archive, { edition: editionAt(new Date("2026-09-13T09:00:00+08:00")) });
  const cooldown = feed.photoCandidates[0].cooldown;
  assert.equal(cooldown.editions, 2, "两组候选 → 同一张照片隔两期再出现");
  assert.equal(cooldown.days, 0.5, "两期 × 6 小时 = 半天");
  assert.equal(cooldown.targetDays, 14);
  assert.equal(cooldown.meetsTarget, false);
  assert.match(cooldown.shortfall, /可达上限/, "差多少要说清，并说明这已是候选数下的上限");
  assert.match(cooldown.shortfall, /门槛未放宽/);
  assert.equal(cooldownOf(56).meetsTarget, true);
  assert.equal(cooldownOf(56).days, 14);
  assert.equal(cooldownOf(56).shortfall, undefined);
  assert.equal(cooldownOf(55).meetsTarget, false);
  assert.equal(cooldownOf(0).editions, 0);
  assert.equal(cooldownOf(0).shortfall, undefined, "一组候选都没有时不必谈冷却");
});

test("纯轮转：走满一整轮才会再出现同一张，且相邻期次必不相同", () => {
  const photos = ["m-a", "m-b", "m-c"].map((id, i) => photo(id, "2026-09-01", { takenAt: `2026-09-0${i + 1}T10:00:00+08:00` }));
  const events = photos.map((p, i) => event(`e-${i}`, "2026-09-01", { mediaIds: [p.id] }));
  const archive = archiveOf({ events, media: photos, reviews: photos.map((p, i) => binding(`e-${i}`, p.id)) });
  const seq = [0, 1, 2, 3, 4, 5].map((index) =>
    buildHomeFeed(archive, { edition: { id: `t${index}`, startedAt: "x", expiresAt: "y", slot: 0, index } }).lead.photo.media.id);
  assert.equal(new Set(seq.slice(0, 3)).size, 3, "头三期把三张都走过一遍");
  assert.deepEqual(seq.slice(3), seq.slice(0, 3), "第四期开始重复同一轮");
  for (let i = 1; i < seq.length; i += 1) assert.notEqual(seq[i], seq[i - 1], "相邻期次不该是同一张");
});

// ── 轮换池 vs 页面上限：两个数必须分开 ──────────────────────────────────────────

/** n 组合格候选，各自独立事件、独立时刻（不成连拍）。 */
function poolOf(n, scores = {}) {
  const photos = Array.from({ length: n }, (_, i) =>
    photo(`m-${String(i).padStart(2, "0")}`, "2026-09-01", { takenAt: `2026-09-01T${String(i % 24).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00+08:00` }));
  const events = photos.map((p, i) => event(`e-${String(i).padStart(2, "0")}`, "2026-09-01", { mediaIds: [p.id] }));
  const archive = archiveOf({ events, media: photos, reviews: photos.map((p, i) => binding(`e-${String(i).padStart(2, "0")}`, p.id)) });
  const quality = Object.keys(scores).length
    ? (mediaId) => scores[mediaId] === undefined ? undefined : ({
      score: scores[mediaId], interaction: 0, readability: 0, context: 0, distinction: 0,
      source: "ai_vision", model: "m", assessedAt: "2026-09-01T00:00:00Z",
    })
    : undefined;
  return { archive, quality, photos };
}

// 2026-09-14 总指挥批准修复：池子超过页面上限时，清单「按质量挑 12 条、再按轮换序排」会把中间被挑掉的项抽空，
// 让本来隔开的同一段故事挨在一起（生产实测：获批 22 对时 16 次换图里相邻 4 处）。
// 回归覆盖：每个故事 2 张、质量分参差、池子 > 上限，任意期次、显式切换，整轮（含首尾相接）零相邻。
function twoPerStoryPool(stories, scoreOf = (i, j) => (i * 7 + j * 13) % 100) {
  const media = [];
  const events = [];
  const reviews = [];
  const scores = {};
  for (let i = 0; i < stories; i += 1) {
    const ids = [];
    for (let j = 0; j < 2; j += 1) {
      const id = `m-s${String(i).padStart(2, "0")}-${j}`;
      // 每张相隔数小时，避免连拍分组把同篇两张并成一张。
      media.push(photo(id, "2026-09-01", { takenAt: `2026-08-${String(1 + i).padStart(2, "0")}T${String(2 + j * 8).padStart(2, "0")}:00:00+08:00` }));
      scores[id] = scoreOf(i, j);
      ids.push(id);
    }
    const eventId = `e-s${String(i).padStart(2, "0")}`;
    events.push(event(eventId, "2026-09-01", { mediaIds: ids }));
    for (const id of ids) reviews.push(binding(eventId, id));
  }
  const quality = (mediaId) => ({ score: scores[mediaId], interaction: 0, readability: 0, context: 0, distinction: 0, source: "ai_vision", model: "m", assessedAt: "2026-08-01T00:00:00Z" });
  return { archive: archiveOf({ events, media, reviews }), quality };
}

test("池子超过页面上限时，换图清单整轮（含首尾相接）零相邻同一段故事", () => {
  for (const stories of [7, 10, 16]) {
    const { archive, quality } = twoPerStoryPool(stories);
    const ringOf = (feed) => feed.photoCandidates.filter((c) => c.chosen || c.cooldown).map((c) => c.story.eventId);
    for (let index = 0; index < stories * 2 + 3; index += 1) {
      const feed = buildHomeFeed(archive, { quality, edition: { id: `t${index}`, startedAt: "2026-09-13T00:00:00+08:00", expiresAt: "y", slot: 0, index } });
      const ring = ringOf(feed);
      assert.equal(ring.length, Math.min(HOME_PHOTO_CANDIDATES_MAX, stories * 2), `${stories} 篇：清单长度`);
      assert.equal(feed.photoCandidates[0].chosen, true, "当期那张仍排第一");
      for (let i = 0; i < ring.length; i += 1) {
        assert.notEqual(ring[i], ring[(i + 1) % ring.length], `${stories} 篇 · 第 ${index} 期：位置 ${i} 与 ${(i + 1) % ring.length} 同属 ${ring[i]}（${ring.join(",")}）`);
      }
    }
    // 显式切换到任意一张，清单同样整轮零相邻。
    const base = buildHomeFeed(archive, { quality, edition: { id: "t", startedAt: "2026-09-13T00:00:00+08:00", expiresAt: "y", slot: 0, index: 0 } });
    for (const c of base.photoCandidates) {
      const ring = ringOf(buildHomeFeed(archive, { quality, photoKey: c.key, edition: { id: "t", startedAt: "2026-09-13T00:00:00+08:00", expiresAt: "y", slot: 0, index: 0 } }));
      for (let i = 0; i < ring.length; i += 1) assert.notEqual(ring[i], ring[(i + 1) % ring.length], `显式切到 ${c.key}：${ring.join(",")}`);
    }
    // 修复不改变轮换本身：走满一整轮，池里每一张都当过一次当期照片。
    const leads = new Set(Array.from({ length: stories * 2 }, (_, index) =>
      buildHomeFeed(archive, { quality, edition: { id: `t${index}`, startedAt: "2026-09-13T00:00:00+08:00", expiresAt: "y", slot: 0, index } }).lead.photo.media.id));
    assert.equal(leads.size, stories * 2, `${stories} 篇：整轮覆盖全部获批照片`);
  }
});

test("超过页面上限：轮换池是全部 20 组，返回给页面的只有上限那几条，冷却按 20 算", () => {
  const { archive } = poolOf(20);
  const feed = buildHomeFeed(archive, { edition: editionAt(new Date("2026-09-13T09:00:00+08:00")) });
  assert.equal(HOME_PHOTO_CANDIDATES_MAX, 12, "2026-09-14 起页面最多拿 12 条（「换张照片」能翻到的数）");
  assert.equal(feed.photoCandidates.length, HOME_PHOTO_CANDIDATES_MAX);
  // 冷却是池子大小，不是清单长度 —— 这正是上一版把两者混用而丢掉的东西。
  const cooldown = feed.photoCandidates[0].cooldown;
  assert.equal(cooldown.editions, 20, "20 组候选 → 同一张照片隔 20 期再出现");
  assert.equal(cooldown.days, 5, "20 期 × 6 小时 = 5 天（按 6 截的话只有 1.5 天）");
  assert.equal(feed.photoCandidates.filter((c) => c.chosen).length, 1);
  assert.equal(feed.photoCandidates[0].chosen, true, "当期选中的那条永远在返回的清单里，排第一");
});

test("实际冷却就是整轮：20 组候选走 20 期才回到同一张，期间无一重复", () => {
  const { archive } = poolOf(20);
  const at = (index) => buildHomeFeed(archive, { edition: { id: `t${index}`, startedAt: "2026-09-13T00:00:00+08:00", expiresAt: "y", slot: 0, index } }).lead.photo.media.id;
  const seq = Array.from({ length: 20 }, (_, i) => at(i));
  assert.equal(new Set(seq).size, 20, "一整轮里 20 张各出现恰好一次");
  assert.equal(at(20), seq[0], "第 21 期才回到第一张");
  for (let i = 1; i < seq.length; i += 1) assert.notEqual(seq[i], seq[i - 1]);
});

test("评分跨越页面上限那一名：清单成员会换，但当期选中的那一张不变", () => {
  // 20 组候选，全部给分：score = 100 - i，所以 m-00 是第 1 名 … m-19 是第 20 名。
  // 然后把第 MAX 名和第 MAX+1 名的分**对调**，让排名正好跨过页面上限那条线。
  const lastIn = `m-${String(HOME_PHOTO_CANDIDATES_MAX - 1).padStart(2, "0")}`;
  const firstOut = `m-${String(HOME_PHOTO_CANDIDATES_MAX).padStart(2, "0")}`;
  const ranked = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`m-${String(i).padStart(2, "0")}`, 100 - i]));
  const swapped = { ...ranked, [lastIn]: ranked[firstOut], [firstOut]: ranked[lastIn] };
  const before = poolOf(20, ranked);
  const after = poolOf(20, swapped);
  // 固定期次序号，好让「当期选中谁」是可预期的：池按 mediaId 排序，index 0 → m-00。
  const edition = { id: "2026-09-13#0", startedAt: "2026-09-13T00:00:00+08:00", expiresAt: "2026-09-13T06:00:00+08:00", slot: 0, index: 0 };
  const feedBefore = buildHomeFeed(before.archive, { edition, quality: before.quality });
  const feedAfter = buildHomeFeed(after.archive, { edition, quality: after.quality });

  assert.equal(feedBefore.lead.photo.media.id, "m-00", "轮换按 mediaId，index 0 落在 m-00");
  assert.equal(
    feedAfter.lead.photo.media.id, feedBefore.lead.photo.media.id,
    "分数跨过页面上限那一名的边界，也不许在期内换掉当期那张照片（§5.5）",
  );

  // 清单成员确实换了 —— 这正是质量分该管的事，所以这不是「什么都没变」。
  const listed = (feed) => feed.photoCandidates.map((c) => c.photo.media.id);
  assert.ok(listed(feedBefore).includes(lastIn), "对调前最后一名在清单里");
  assert.ok(!listed(feedBefore).includes(firstOut), "对调前第一个出界的不在清单里");
  assert.ok(listed(feedAfter).includes(firstOut), "对调后升上来的那张进了清单");
  assert.ok(!listed(feedAfter).includes(lastIn), "对调后掉出去的那张出了清单");

  // 池子没变，所以冷却一个数都不动 —— 清单长度和池子大小是两件事。
  assert.equal(feedBefore.photoCandidates[0].cooldown.editions, 20);
  assert.equal(feedAfter.photoCandidates[0].cooldown.editions, 20);
});

test("期内新增候选：本期不参与轮换，从下一期起才算进池子", () => {
  const p1 = photo("m-1", "2026-09-07");
  const p2 = photo("m-2", "2026-08-20", { takenAt: "2026-08-20T11:00:00+08:00" });
  const fresh = photo("m-3", "2026-08-10", { takenAt: "2026-08-10T11:00:00+08:00" });
  const events = [
    event("e-1", "2026-09-07", { mediaIds: [p1.id] }),
    event("e-2", "2026-08-20", { mediaIds: [p2.id] }),
    event("e-3", "2026-08-10", { mediaIds: [fresh.id] }),
  ];
  const edition = editionAt(new Date("2026-09-13T14:00:00+08:00"));
  assert.equal(edition.startedAt, "2026-09-13T12:00:00+08:00", "本期从 12:00 开始");
  const reviews = [
    binding("e-1", p1.id, "approved", { reviewedAt: "2026-09-01T00:00:00Z" }),
    binding("e-2", p2.id, "approved", { reviewedAt: "2026-09-01T00:00:00Z" }),
    binding("e-3", fresh.id, "approved", { reviewedAt: "2026-09-13T13:00:00+08:00" }),
  ];
  const archive = archiveOf({ events, media: [p1, p2, fresh], reviews });
  const feed = buildHomeFeed(archive, { edition });
  const rotating = feed.photoCandidates.filter((c) => c.cooldown);
  assert.equal(rotating.length, 2, "本期的池子只有两组：新获批的那组不算");
  assert.equal(rotating[0].cooldown.editions, 2);
  const pendingOne = feed.photoCandidates.find((c) => c.photo.media.id === "m-3");
  assert.equal(pendingOne.chosen, false);
  assert.equal(pendingOne.cooldown, undefined, "不参与轮换就不该带冷却数");
  assert.match(pendingOne.reason, /开始后才通过审核，从下一期起参与/);
  const next = buildHomeFeed(archive, { edition: editionAt(new Date("2026-09-13T18:30:00+08:00")) });
  assert.equal(next.photoCandidates.filter((c) => c.cooldown).length, 3, "下一期池子变成三组");
  assert.equal(next.photoCandidates[0].cooldown.editions, 3);
});

test("期内落地的视觉评分本期先不生效，下一期起生效（并写明为什么降级）", () => {
  const { archive } = poolOf(3);
  const edition = editionAt(new Date("2026-09-13T14:00:00+08:00"));
  const midEdition = () => ({
    score: 99, interaction: 0, readability: 0, context: 0, distinction: 0,
    source: "ai_vision", model: "m", assessedAt: "2026-09-13T13:00:00+08:00",
  });
  const feed = buildHomeFeed(archive, { edition, quality: midEdition });
  assert.equal(feed.lead.photo.quality.source, "deterministic", "本期开始后才写下的评分，本期不用");
  assert.match(feed.lead.photo.quality.degraded, /开始后才写下的/);
  const earlier = () => ({
    score: 99, interaction: 0, readability: 0, context: 0, distinction: 0,
    source: "ai_vision", model: "m", assessedAt: "2026-09-13T11:00:00+08:00",
  });
  assert.equal(buildHomeFeed(archive, { edition, quality: earlier }).lead.photo.quality.source, "ai_vision");
});

test("撤销仍然立刻生效，不等下一期", () => {
  const { archive: full } = poolOf(3);
  const edition = editionAt(new Date("2026-09-13T14:00:00+08:00"));
  const chosen = buildHomeFeed(full, { edition }).lead.photo.media.id;
  const ids = ["m-00", "m-01", "m-02"];
  const media = ids.map((id, i) => photo(id, "2026-09-01", { takenAt: `2026-09-01T0${i}:0${i}:00+08:00` }));
  const events = media.map((p, i) => event(`e-0${i}`, "2026-09-01", { mediaIds: [p.id] }));
  const revokedEvent = `e-0${ids.indexOf(chosen)}`;
  const reviews = [
    ...media.map((p, i) => binding(`e-0${i}`, p.id, "approved", { reviewedAt: "2026-09-01T00:00:00Z" })),
    binding(revokedEvent, chosen, "rejected", { id: "rev-late", reviewedAt: "2026-09-13T13:30:00+08:00" }),
  ];
  const after = buildHomeFeed(archiveOf({ events, media, reviews }), { edition });
  assert.notEqual(after.lead.photo.media.id, chosen, "撤销是唯一立刻生效的那一类（§5.7）");
  assert.equal(after.photoCandidates[0].cooldown.editions, 2, "池子少一组，冷却跟着变");
});

test("期内新批准的同组照片不挤掉本期那张旧照片（先过资格，再分连拍组）", () => {
  // 一组连拍两张，同一时刻：旧的那张早就获批（本期可用），新的那张本期才获批。
  // mediaId 上让**新**的那张排在前面（"m-a" < "m-z"），所以「先去重再过滤」会先把 m-a 取为
  // 组代表、再把它按资格拿掉，于是这一组在本期一张都不剩 —— 那就是假阴性。
  const fresh = photo("m-a-new", "2026-09-07", { takenAt: "2026-09-07T10:00:00+08:00" });
  const old = photo("m-z-old", "2026-09-07", { takenAt: "2026-09-07T10:00:20+08:00" });
  const other = photo("m-other", "2026-08-20", { takenAt: "2026-08-20T11:00:00+08:00" });
  const events = [
    event("e-fresh", "2026-09-07", { mediaIds: [fresh.id] }),
    event("e-old", "2026-09-07", { mediaIds: [old.id] }),
    event("e-other", "2026-08-20", { mediaIds: [other.id] }),
  ];
  const edition = editionAt(new Date("2026-09-13T14:00:00+08:00"));
  assert.equal(edition.startedAt, "2026-09-13T12:00:00+08:00");
  const reviews = [
    binding("e-old", old.id, "approved", { reviewedAt: "2026-09-01T00:00:00Z" }),
    binding("e-other", other.id, "approved", { reviewedAt: "2026-09-01T00:00:00Z" }),
    // 本期开始之后才批的那一张，而且它在 mediaId 上排在旧的前面。
    binding("e-fresh", fresh.id, "approved", { reviewedAt: "2026-09-13T13:00:00+08:00" }),
  ];
  const archive = archiveOf({ events, media: [fresh, old, other], reviews });
  const feed = buildHomeFeed(archive, { edition });

  const pool = feed.photoCandidates.filter((c) => c.cooldown).map((c) => c.photo.media.id);
  assert.ok(pool.includes("m-z-old"), "本期合格的那张旧照片必须还在池子里，不能被一张本期用不了的图挤掉");
  assert.ok(!pool.includes("m-a-new"), "本期才获批的那张不参与本期轮换");
  assert.equal(pool.length, 2, "池子是两组：旧的那张 + 另一个事件");
  assert.equal(feed.photoCandidates[0].cooldown.editions, 2);
  // 新的那张仍然列出来，原因是「资格」而不是「连拍重复」——两件事不能混。
  const freshOne = feed.photoCandidates.find((c) => c.photo.media.id === "m-a-new");
  assert.match(freshOne.reason, /开始后才通过审核/);
  assert.ok(!/连拍/.test(freshOne.reason), "它不是被连拍去重挡下的");

  // 下一期它就有资格了，这时才轮到连拍去重管它：同组只留一张。
  const next = buildHomeFeed(archive, { edition: editionAt(new Date("2026-09-13T18:30:00+08:00")) });
  const nextPool = next.photoCandidates.filter((c) => c.cooldown).map((c) => c.photo.media.id);
  assert.equal(nextPool.length, 2, "同一时刻的两张下一期只占一个名额，所以池子还是两组");
  assert.ok(nextPool.includes("m-a-new"), "下一期由 mediaId 序取组代表，轮到新的那张");
  const bumped = next.photoCandidates.find((c) => c.photo.media.id === "m-z-old");
  assert.match(bumped.reason, /连拍/, "这一期它才是被连拍去重挡下的那张");
});

// 2026-09-14：生产账本 reviewedAt 是不带时区的上海本地时间（"2026-09-14 19:02:13.893609"），生产容器
// 是 UTC。判断必须与进程时区无关：同一个时刻用上海裸写法、+08:00、Z 三种写法断言同一个结果。
test("账本裸时间按上海解释，与进程时区无关", () => {
  const bare = "2026-09-14 19:02:13.893609";
  assert.equal(parseLedgerTime(bare), Date.parse("2026-09-14T11:02:13.893Z"), "上海 19:02 = UTC 11:02，不是 UTC 19:02");
  assert.equal(parseLedgerTime("2026-09-14T19:02:13.893+08:00"), parseLedgerTime(bare));
  assert.equal(parseLedgerTime("2026-09-14 19:02"), Date.parse("2026-09-14T11:02:00Z"));
  assert.equal(parseLedgerTime("2026-09-14T11:02:13Z"), Date.parse("2026-09-14T11:02:13Z"));
  assert.equal(parseLedgerTime("2026-09-14 19:02:13+0800"), Date.parse("2026-09-14T11:02:13Z"));
  assert.ok(Number.isNaN(parseLedgerTime("x")));
  // 今晚那一期（#3 从 18:00 开始）：19:02 批的本期不进；下一期 00:00 起进。
  assert.equal(isAtOrAfterEditionStart(bare, "2026-09-14T18:00:00+08:00"), true, "本期内批的，本期待定");
  assert.equal(isAtOrAfterEditionStart(bare, "2026-09-15T00:00:00+08:00"), false, "下一期 00:00 起参与，不多挡一期");
  assert.equal(isAtOrAfterEditionStart("2026-09-14 18:00:00.000000", "2026-09-14T18:00:00+08:00"), true, "恰好等于期始算本期");
  assert.equal(isAtOrAfterEditionStart("2026-09-14 17:59:59.999", "2026-09-14T18:00:00+08:00"), false, "早 1ms 算上一期");
  assert.equal(isAtOrAfterEditionStart("2026-09-14 17:59:59.999", "2026-09-14T10:00:00Z"), false, "期始用 Z 写法也按时刻比");
  // 同一份判断在子进程 TZ=UTC 与 TZ=Asia/Shanghai 下结果一致（进程时区不进入判断）。
  const probe = `import { isAtOrAfterEditionStart as f } from ${JSON.stringify(new URL("../lib/home-feed.ts", import.meta.url).href)};`
    + `console.log(JSON.stringify([f(${JSON.stringify(bare)}, "2026-09-14T18:00:00+08:00"), f(${JSON.stringify(bare)}, "2026-09-15T00:00:00+08:00")]))`;
  for (const tz of ["UTC", "Asia/Shanghai"]) {
    const out = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", probe], { env: { ...process.env, TZ: tz }, encoding: "utf8" });
    assert.equal(out.trim().split("\n").pop(), "[true,false]", `TZ=${tz}`);
  }
});

test("跨时区写法按时刻比较：isAtOrAfterEditionStart 的边界", () => {
  const start = "2026-09-13T12:00:00+08:00";
  assert.equal(isAtOrAfterEditionStart("2026-09-13T04:30:00.000Z", start), true, "UTC 04:30 = 上海 12:30，在本期开始之后");
  assert.equal(isAtOrAfterEditionStart("2026-09-13T04:00:00Z", start), true, "恰好等于开始时刻算本期之后");
  assert.equal(isAtOrAfterEditionStart("2026-09-13T03:59:59.999Z", start), false, "早一毫秒就是本期之前");
  assert.equal(isAtOrAfterEditionStart("2026-09-13T11:00:00Z", start), true, "UTC 11:00 字符串上排在 12:00 前面，时刻上是上海 19:00");
  assert.equal(isAtOrAfterEditionStart("2026-09-13T13:00:00+08:00", "2026-09-13T04:00:00Z"), true, "反过来的写法组合也按时刻比");
  assert.equal(isAtOrAfterEditionStart("not-a-time", start), false, "解析不出来的时间不挡候选");
  assert.equal(isAtOrAfterEditionStart("2026-09-13T13:00:00Z", "x"), false);
});

test("UTC 写法的本期新批准照片不进本期轮换；本期前批准的照常参与", () => {
  const p1 = photo("m-1", "2026-09-07");
  const p2 = photo("m-2", "2026-08-20", { takenAt: "2026-08-20T11:00:00+08:00" });
  const fresh = photo("m-3", "2026-08-10", { takenAt: "2026-08-10T11:00:00+08:00" });
  const justBefore = photo("m-4", "2026-08-01", { takenAt: "2026-08-01T11:00:00+08:00" });
  const events = [
    event("e-1", "2026-09-07", { mediaIds: [p1.id] }),
    event("e-2", "2026-08-20", { mediaIds: [p2.id] }),
    event("e-3", "2026-08-10", { mediaIds: [fresh.id] }),
    event("e-4", "2026-08-01", { mediaIds: [justBefore.id] }),
  ];
  const edition = editionAt(new Date("2026-09-13T14:00:00+08:00"));
  const reviews = [
    binding("e-1", p1.id, "approved", { reviewedAt: "2026-09-01T00:00:00Z" }),
    binding("e-2", p2.id, "approved", { reviewedAt: "2026-09-01T00:00:00Z" }),
    // 上海 12:30 批的，写成 UTC：字符串上比 "2026-09-13T12:00:00+08:00" 小。
    binding("e-3", fresh.id, "approved", { reviewedAt: "2026-09-13T04:30:00.000Z" }),
    // 上海 11:59:59 批的：本期开始前，照常参与。
    binding("e-4", justBefore.id, "approved", { reviewedAt: "2026-09-13T03:59:59.000Z" }),
  ];
  const archive = archiveOf({ events, media: [p1, p2, fresh, justBefore], reviews });
  const pool = (feed) => feed.photoCandidates.filter((c) => c.cooldown).map((c) => c.photo.media.id).sort();
  const feed = buildHomeFeed(archive, { edition });
  assert.deepEqual(pool(feed), ["m-1", "m-2", "m-4"], "期中获批的 UTC 写法那张不参与本期");
  assert.match(feed.photoCandidates.find((c) => c.photo.media.id === "m-3").reason, /开始后才通过审核/);
  // 同一期里任意时刻刷新，池子都是这三张（六小时稳定）。
  for (const at of ["2026-09-13T12:00:00+08:00", "2026-09-13T15:10:00+08:00", "2026-09-13T17:59:59+08:00"]) {
    assert.deepEqual(pool(buildHomeFeed(archive, { edition: editionAt(new Date(at)) })), ["m-1", "m-2", "m-4"], at);
  }
  assert.deepEqual(pool(buildHomeFeed(archive, { edition: editionAt(new Date("2026-09-13T18:00:00+08:00")) })), ["m-1", "m-2", "m-3", "m-4"], "下一期起才进池");
});

test("UTC 写法的期中视觉评分本期也不生效", () => {
  const { archive } = poolOf(3);
  const edition = editionAt(new Date("2026-09-13T14:00:00+08:00"));
  const scored = (assessedAt) => () => ({ score: 99, interaction: 0, readability: 0, context: 0, distinction: 0, source: "ai_vision", model: "m", assessedAt });
  assert.equal(buildHomeFeed(archive, { edition, quality: scored("2026-09-13T05:00:00Z") }).lead.photo.quality.source, "deterministic", "上海 13:00 写下的");
  assert.equal(buildHomeFeed(archive, { edition, quality: scored("2026-09-13T03:00:00Z") }).lead.photo.quality.source, "ai_vision", "上海 11:00 写下的");
});

// ── 近期优先（2026-09-16 视觉验收 ①）─────────────────────────────────────────
// 验收当天线上首页轮到的是 2025-05-13 的照片，离今天 16 个月，原则一的检验句不过。
// 但 60 天硬窗口正是 2026-09-14 被用户拿掉的东西（「换张照片」来回只有 3 张），所以这里钉住的
// 是**分级**行为：窗内候选够多才收窄，撑不起就退回全库——09-14 那个失败形态不能回来。
const photoStory = (id, day, mediaId) => ({
  id,
  title: `${day} 这一天`,
  excerpt: undefined,
  weight: "memory",
  signature: { day, dateLabel: day, ageLabel: undefined },
  lead: { id: mediaId, src: `/api/media/${mediaId}?variant=web`, width: 1600, height: 1200, alt: "照片", type: "photo" },
});

test("近期优先：窗内候选够多时，更早的照片不进本轮轮换，并写明原因", () => {
  const edition = editionAt(new Date("2026-09-16T09:00:00+08:00"));
  const recent = ["2026-07-01", "2026-07-11", "2026-07-21", "2026-08-01", "2026-08-11", "2026-08-21", "2026-09-01", "2026-09-11"]
    .map((day, i) => photoStory(`r${i}`, day, `m-r${i}`));
  const old = photoStory("old", "2025-05-13", "m-old");
  const candidates = buildPhotoCandidates({ memories: [...recent, old], birthDay: BIRTH, today: "2026-09-16", edition });
  const inRotation = candidates.filter((c) => c.cooldown);
  assert.equal(inRotation.length, 8, "窗内 8 组都在轮换里");
  assert.ok(!inRotation.some((c) => c.story.eventId === "old"), "16 个月前那张不该轮到");
  const dropped = candidates.find((c) => c.story.eventId === "old");
  assert.match(dropped?.reason ?? "", /近期优先：本轮用最近 90 天的窗口/);
});

test("近期优先：窗内撑不起一轮时退回全库——09-14 那个「来回只有 3 张」不能回来", () => {
  const edition = editionAt(new Date("2026-09-16T09:00:00+08:00"));
  const few = [photoStory("n1", "2026-09-01", "m-n1"), photoStory("n2", "2026-09-05", "m-n2")];
  const older = ["2025-05-13", "2025-08-02", "2026-01-03", "2026-03-09"].map((day, i) => photoStory(`o${i}`, day, `m-o${i}`));
  const candidates = buildPhotoCandidates({ memories: [...few, ...older], birthDay: BIRTH, today: "2026-09-16", edition });
  const inRotation = candidates.filter((c) => c.cooldown);
  assert.equal(inRotation.length, 6, "三个窗口都撑不起 8 组，池子就是全部 6 组，一张都没被窗口压掉");
  assert.ok(inRotation.some((c) => c.story.eventId === "o0"), "2025-05 那张在这种情况下仍然要能轮到");
});

test("近期优先只按照片自己的日子收窄，不动别的门槛：窗内的每一组都还在", () => {
  const edition = editionAt(new Date("2026-09-16T09:00:00+08:00"));
  const days = ["2026-06-20", "2026-06-30", "2026-07-10", "2026-07-20", "2026-07-30", "2026-08-09", "2026-08-19", "2026-08-29", "2026-09-08"];
  const memories = days.map((day, i) => photoStory(`w${i}`, day, `m-w${i}`));
  const candidates = buildPhotoCandidates({ memories, birthDay: BIRTH, today: "2026-09-16", edition });
  const inRotation = candidates.filter((c) => c.cooldown);
  assert.equal(inRotation.length, days.length, "全部落在 90 天内，一组都不该少");
});
