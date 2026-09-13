// 首页数据契约的有界真实核验（HOME-20260913, 2026-09-13）。
//
// 为什么不是直接连生产库跑。生产渲染用的是阿里云 RDS，本机没有那台 ECS 的 .pem，也没有转发出来的
// 数据库端口（netstat 上只有 18080 这一个私有站隧道）。`v2/.env.local` 指向的 Neon 是**另一份更小的
// 数据**：0 条 media_binding、0 条 media_subject_check、最新事件 2026-09-03、连 upcoming_items 这张表
// 都不存在（migration 0014/0015 没在那边跑过）。在 Neon 上跑出来的「0 个候选」是那个库的事实，
// 不是首页逻辑的事实——把它当成核验结果就是拿错的库去证对的代码。
//
// 所以这里做的是**把生产数据回放进本轨代码**：候选与待办全部来自两处生产证据，
// 不是手编的 fixture，也不是 Neon：
//
//   · 三对 (故事, 照片)：来自生产快照 slots-055e919.json（2026-09-13T09:47Z 采自生产库，
//     reviewRows 1636 / lifeEvents 845 / media 10860），eventId 与标题来自线上私有站
//     http://127.0.0.1:18080/memory/2026/09 与 /2026/08 的实际 DOM。
//   · 十八条待办：来自线上私有站首页 http://127.0.0.1:18080/ 的实际 DOM，
//     含每条真实的提出日（记录于）与真实的 when。
//
// 它证明的是：**给定生产今天真实持有的这些行，首页会选什么、会让什么退场、理由是什么。**
// 它不能代替一次生产渲染的验收——那要么等能直连 RDS，要么等页面轨把新首页部署到私有站之后
// 在页面上实测。这条限制写在输出文件里，不许被读成「已在生产核验通过」。
//
// 用法：node --import tsx scripts/home-feed-verify.mjs --live <live-upcoming.json> --out <dir>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { buildChapters } from "../lib/memory-chapters.ts";
import { storyPhotoConfirmationsFrom } from "../lib/media/story-binding.ts";
import { buildHomeFeed, editionAt } from "../lib/home-feed.ts";
import { freshnessOf } from "../lib/upcoming-freshness.ts";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : fallback;
};
const LIVE = flag("live");
const OUT = flag("out");
if (!LIVE || !OUT) { console.error("用法：--live <live-upcoming.json> --out <dir>"); process.exit(2); }

const TODAY = "2026-09-13";
const BIRTH = "2025-01-03";

// ── 生产证据 1：三对 (故事, 照片) ────────────────────────────────────────────
// **标题这类家庭原文不进 Git**（任务卡：照片/家庭原文/完整数据快照仅留在 NianlifeOps）。
// 所以这份数据从 --pairs 指向的文件读，仓库里只有读它的代码。
// 文件本身记着自己的来源：mediaId/day/px 来自 slots-055e919.json 的 storyCard(memory_led) 三行，
// eventId/title 来自线上月页的实际 DOM。三张都是 inConfirmed=true、hasSubjectCheck=false。
const PAIRS_FILE = flag("pairs");
if (!PAIRS_FILE) { console.error("用法：--pairs <production-pairs.json>（放在 NianlifeOps，不进 Git）"); process.exit(2); }
const pairsInput = JSON.parse(readFileSync(PAIRS_FILE, "utf8"));
const PRODUCTION_PAIRS = pairsInput.pairs;
const PRODUCTION_TEXT_ONLY = pairsInput.textOnly ?? [];
if (!Array.isArray(PRODUCTION_PAIRS) || PRODUCTION_PAIRS.length === 0) {
  console.error("--pairs 文件里没有 pairs 数组，中止（不拿手编数据冒充生产证据）");
  process.exit(2);
}

const eventOf = ({ eventId, day, title, mediaIds = [] }) => ({
  id: eventId, profileId: "profile-zhangnian", title, story: "（正文不进本文件）",
  occurredAt: `${day} 00:00:00+00`, people: [], tags: [], contentTypes: ["family"],
  mediaIds, sourceIds: [], growthRecordIds: [], careRecordIds: [], eventType: "moment",
  memoryWeight: "memory", scopes: ["family"], visibility: "family", keptInYearbook: false,
});

const mediaOf = ({ mediaId, day, width, height }) => ({
  id: mediaId, profileId: "profile-zhangnian", type: "photo",
  src: `/api/media/${encodeURIComponent(mediaId)}`, thumbnailSrc: `/api/media/${encodeURIComponent(mediaId)}?v=thumb`,
  width, height, takenAt: `${day}T10:00:00+08:00`, visibility: "family", rawSourceId: `raw-${mediaId.slice(-8)}`,
});

const events = [...PRODUCTION_PAIRS.map((p) => eventOf({ ...p, mediaIds: [p.mediaId] })), ...PRODUCTION_TEXT_ONLY.map(eventOf)];
const media = PRODUCTION_PAIRS.map(mediaOf);
// 生产账本里这三对各有一条 media_binding=approved。走生产那条读法，不自己简化。
const reviews = PRODUCTION_PAIRS.map((p, i) => ({
  id: `rev-prod-${i}`, targetKind: "media_binding", targetId: `${p.eventId}|${p.mediaId}`,
  decision: "approved", reviewedAt: "2026-09-13T08:40:43Z",
}));
const confirmations = storyPhotoConfirmationsFrom(reviews);
const deliverable = new Set(media.map((m) => m.id));

const archive = {
  store: { qualityReviews: reviews },
  media, events, traceEvents: [], eventIdentities: events,
  chapters: buildChapters({ events, traces: [], media, deliverable, birthDay: BIRTH, photoConfirmations: confirmations }),
  birthDay: BIRTH, snapshots: [], privilege: { confirmed: new Set(), trusted: new Set(), checked: new Set() },
  time: { today: TODAY, activityDay: TODAY },
};

// ── 生产证据 2：十八条真实待办 ───────────────────────────────────────────────
const live = JSON.parse(readFileSync(LIVE, "utf8"));
const stripLabel = (title) => title.replace(/(待定|已完成|已取消)$/, "").trim();
const upcomingItems = live.map((row) => ({
  id: `live-${row.i}`,
  title: stripLabel(row.title),
  note: row.note,
  when: row.whenDays.length === 2
    ? { kind: "window", fromDay: row.whenDays[0], toDay: row.whenDays[1] }
    : row.whenDays.length === 1 ? { kind: "day", day: row.whenDays[0] } : { kind: "unconfirmed" },
  status: row.status,
  // 真实的提出日（页面上的「记录于」），就是保鲜的起算点。
  evidence: { day: row.raised },
  // done 的三条在线上是带完成证据的（页面画了删除线），所以这里给它一条，
  // 否则 normalize 会把它降回 open，那就不是生产现在的状态了。
  statusEvidence: row.status === "done" ? { day: row.whenDays[row.whenDays.length - 1] ?? row.raised } : undefined,
}));

// ── 跑四期，把选择与退场全部记下来 ──────────────────────────────────────────
const editions = ["02:00", "08:00", "14:00", "20:00"].map((clock) => editionAt(new Date(`${TODAY}T${clock}:00+08:00`)));
const rounds = editions.map((edition) => {
  const feed = buildHomeFeed(archive, { edition, upcoming: { status: "ready", items: upcomingItems } });
  return {
    期次: edition.id,
    有效期: `${edition.startedAt} → ${edition.expiresAt}`,
    主故事: feed.lead && {
      eventId: feed.lead.story.eventId, 标题: feed.lead.story.title,
      日期: feed.lead.story.day, 当时: feed.lead.story.ageLabel,
      配图: feed.lead.photo?.media.id, 配图批准: feed.lead.photo?.approval,
      配图日期: feed.lead.photo?.day, 配图当时: feed.lead.photo?.ageLabel,
      质量来源: feed.lead.photo?.quality?.source, 质量分: feed.lead.photo?.quality?.score,
      降级原因: feed.lead.photo?.quality?.degraded,
      没有配图的原因: feed.lead.photoAbsence,
    },
    近况: feed.recentFact && { eventId: feed.recentFact.eventId, 标题: feed.recentFact.title, 日期: feed.recentFact.day },
    候选: feed.photoCandidates.map((c) => ({ key: c.key, 选中: c.chosen, 日期: c.photo.day, 分数: c.photo.quality?.score, 理由: c.reason })),
    提醒_默认露出: feed.reminders.shown?.map((r) => ({ 标题: r.title, 状态: r.state, 期限: r.deadlineLabel, 关键: r.important, 理由: r.reason })),
    提醒_退场: feed.reminders.retired?.map((r) => ({ 标题: r.title, 库内状态: r.status, 退场原因: r.reason })),
    提醒_折叠可达: feed.reminders.more?.length,
  };
});

// 每条待办逐条的保鲜判定，含起算点。
const perItem = upcomingItems.map((item) => {
  const verdict = freshnessOf(item, TODAY);
  return {
    标题: item.title, 库内状态: item.status, when: item.when,
    起算点_提出日: verdict.raisedOn, 分类: verdict.klass,
    新鲜期最后一天: verdict.freshThrough ?? "（这一类不按时钟过期）",
    退场: verdict.stale, 理由: verdict.reason,
  };
});

const clockCheck = {
  今天: archive.time.today,
  今天几岁: buildHomeFeed(archive, { edition: editions[0], upcoming: { status: "ready", items: upcomingItems } }).clock.ageToday,
  说明: "首页时钟只来自 archive.time.today，不随选中的故事日期移动；每段内容各带自己的当时年龄。",
};

const report = {
  任务: "HOME-20260913-DATA · 首页数据契约有界真实核验",
  生成时间: new Date().toISOString(),
  代码: { 契约: "home-feed/1.0.0", 提交: "见 docs/HOME-DATA-STATUS.md 的 SHA" },
  这份文件证明什么: "给定生产今天真实持有的这 3 对 (故事,照片) 与 18 条待办，首页会选什么、让什么退场、理由是什么。",
  这份文件不证明什么: [
    "**不是**一次生产渲染的验收。生产库是阿里云 RDS，本机没有 .pem、没有转发端口，无法直连。",
    "**不是**在 Neon 上跑出来的结果。Neon 是另一份更小的数据：0 条 media_binding、0 条 media_subject_check、无 upcoming_items 表。",
    "新首页尚未部署到私有站，页面级验收由页面轨在 Codex 终审后统一执行。",
  ],
  数据来源: {
    "三对故事配图": "slots-055e919.json（2026-09-13T09:47Z 采自生产）+ 线上月页 DOM 取 eventId/标题",
    "十八条待办": "线上私有站首页 DOM（http://127.0.0.1:18080/），含真实提出日与真实 when",
  },
  时钟: clockCheck,
  四期轮换: rounds,
  逐条保鲜判定: perItem,
  合计: {
    合格候选组数: rounds[0].候选.length,
    默认露出条数: rounds.map((r) => r.提醒_默认露出.length),
    退场条数: rounds[0].提醒_退场.length,
    折叠可达条数: rounds[0].提醒_折叠可达,
    待办总数: upcomingItems.length,
    "AI 视觉评估": "未执行——生产 provider deepseek-v4-pro 在能力门上不通过（图片被换成 [Unsupported Image]）。所有分数 source=deterministic 并写明降级原因。",
  },
};

mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, "home-feed-verification.json");
writeFileSync(file, `${JSON.stringify(report, null, 1)}\n`, "utf8");

console.log(`写入：${file}`);
console.log(`\n合格 (故事,照片) 候选：${rounds[0].候选.length} 组`);
for (const round of rounds) {
  console.log(`\n期次 ${round.期次}`);
  console.log(`  主故事：${round.主故事?.标题}（${round.主故事?.日期}，当时 ${round.主故事?.当时}）`);
  console.log(`  配图：${round.主故事?.配图?.slice(0, 34) ?? "（无合格配图：" + round.主故事?.没有配图的原因 + "）"}  质量来源=${round.主故事?.质量来源}`);
  console.log(`  近况：${round.近况?.标题}（${round.近况?.日期}）`);
  console.log(`  默认露出 ${round.提醒_默认露出.length} 条：${round.提醒_默认露出.map((r) => `${r.标题}[${r.状态}]`).join("、")}`);
}
console.log(`\n退场 ${rounds[0].提醒_退场.length} 条（库内状态全部未改）：`);
for (const r of rounds[0].提醒_退场) console.log(`  ${r.标题}  库内=${r.库内状态}  ${r.退场原因}`);
console.log(`\n折叠可达：${rounds[0].提醒_折叠可达} 条；待办总数 ${upcomingItems.length} 条`);
