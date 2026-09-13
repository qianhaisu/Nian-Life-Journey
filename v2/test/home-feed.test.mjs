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
  QUALITY_NOT_ASSESSED, reminderStateOf, REMINDERS_MAX_SHOWN, cooldownOf,
} from "../lib/home-feed.ts";

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
  assert.deepEqual(buildPhotoCandidates([], BIRTH, TODAY, edition, undefined), []);
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

test("同事件冷却是构造保证的：任意两个候选的事件必不相同，所以相邻期次不会重复同一段故事", () => {
  // 一段记忆只贡献一个候选（memory.lead 是单数）。这条测试钉住那个不变量：哪天 memory.lead 变成
  // 能给一段记忆返回多张图，这里会失败，而不是首页悄悄开始连着两期推同一段故事。
  const a1 = photo("m-a1", "2026-09-07", { takenAt: "2026-09-07T09:00:00+08:00" });
  const a2 = photo("m-a2", "2026-09-07", { takenAt: "2026-09-07T15:00:00+08:00" });
  const b1 = photo("m-b1", "2026-08-20", { takenAt: "2026-08-20T11:00:00+08:00" });
  const events = [
    event("e-a", "2026-09-07", { mediaIds: [a1.id, a2.id] }),
    event("e-b", "2026-08-20", { mediaIds: [b1.id] }),
  ];
  const archive = archiveOf({
    events, media: [a1, a2, b1],
    // e-a 的两张都获批了 —— 但它只能贡献一个候选。
    reviews: [binding("e-a", a1.id), binding("e-a", a2.id), binding("e-b", b1.id)],
  });
  const candidates = buildHomeFeed(archive, { edition: { id: "t", startedAt: "x", expiresAt: "y", slot: 0, index: 0 } }).photoCandidates;
  const eventIds = candidates.map((candidate) => candidate.story.eventId);
  assert.equal(new Set(eventIds).size, eventIds.length, "候选之间不许共用同一个事件");
  const chosen = [0, 1, 2, 3].map((index) =>
    buildHomeFeed(archive, { edition: { id: `t${index}`, startedAt: "x", expiresAt: "y", slot: 0, index } }).lead.story.eventId);
  for (let i = 1; i < chosen.length; i += 1) {
    assert.notEqual(chosen[i], chosen[i - 1], "相邻期次不该是同一段故事");
  }
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

test("质量分决定谁进轮换 band 以及 qualityRank，但不决定轮到谁", () => {
  const photos = ["m-a", "m-b", "m-c", "m-d", "m-e", "m-f", "m-g"].map((id, i) =>
    photo(id, "2026-09-01", { takenAt: `2026-09-0${i + 1}T10:00:00+08:00` }));
  const events = photos.map((p, i) => event(`e-${i}`, "2026-09-01", { mediaIds: [p.id] }));
  const archive = archiveOf({ events, media: photos, reviews: photos.map((p, i) => binding(`e-${i}`, p.id)) });
  const scores = { "m-a": 10, "m-b": 20, "m-c": 30, "m-d": 40, "m-e": 50, "m-f": 60, "m-g": 70 };
  const feed = buildHomeFeed(archive, {
    edition: editionAt(new Date("2026-09-13T09:00:00+08:00")),
    quality: (mediaId) => ({ score: scores[mediaId], interaction: 0, readability: 0, context: 0, distinction: 0, source: "ai_vision", model: "m", assessedAt: "t" }),
  });
  const rotating = feed.photoCandidates.filter((candidate) => candidate.cooldown);
  const benched = feed.photoCandidates.filter((candidate) => !candidate.cooldown);
  assert.equal(rotating.length, 6, "band 上限 6 组参与轮换");
  assert.equal(benched.length, 1);
  assert.equal(benched[0].photo.media.id, "m-a", "分最低的那一张被挤出 band");
  assert.match(benched[0].reason, /质量分排在第 7 位/);
  assert.equal(benched[0].qualityRank, 7);
  assert.deepEqual(rotating.map((candidate) => candidate.photo.media.id), ["m-b", "m-c", "m-d", "m-e", "m-f", "m-g"]);
  assert.equal(rotating.find((candidate) => candidate.photo.media.id === "m-g").qualityRank, 1);
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
