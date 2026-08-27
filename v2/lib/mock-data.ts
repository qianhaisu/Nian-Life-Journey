import type { CareRecord, GrowthRecord, LifeEvent, Media, MonthlySnapshot, Profile } from "./types";

export const profile: Profile = { id: "profile-zhangnian", displayName: "张年", birthDate: "2025-01-03", timezone: "Asia/Shanghai", bio: "每天都在长大一点，也在把世界看得更认真。", visibility: "family" };

const image = (id: string, src: string, alt: string, lifeEventId: string, takenAt: string): Media => ({ id, profileId: profile.id, lifeEventId, type: "photo", src, alt, takenAt, visibility: "family", width: 1200, height: 900 });
export const media: Media[] = [
  image("media-lake", "/v2/images/moments/2026-08-dongqian-lake.png", "张年在雨中的东钱湖边认真看着湖面", "event-lake", "2026-08-22"),
  image("media-xiaoai", "/v2/images/moments/2026-08-xiaoai.png", "睡前的张年回应家人呼唤", "event-xiaoai", "2026-08-20"),
  image("media-walk", "/v2/images/hero/2026-08-hero-walk.jpg", "张年笑着向前走的近期照片", "event-walk", "2026-08-17"),
  image("media-pool", "/v2/images/moments/2026-08-dongqian-lake.png", "张年在夏日泳池边玩水的记录插画", "event-pool", "2026-08-10"),
  image("media-bus", "/v2/images/moments/2026-08-xiaoai.png", "张年听到公交车歌曲时做出表演动作", "event-bus", "2026-08-08"),
  image("media-ball", "/v2/images/hero/2026-08-hero-walk.jpg", "张年和妈妈在客厅踢球的家庭记录", "event-ball", "2026-08-03"),
  image("media-book", "/v2/images/moments/2026-08-xiaoai.png", "张年和家人一起翻看绘本", "event-book", "2026-07-28"),
  image("media-hat", "/v2/images/moments/2026-08-dongqian-lake.png", "张年把尿不湿戴在头上开心地笑", "event-hat", "2026-07-21"),
];

export const growthRecords: GrowthRecord[] = [
  { id: "growth-height-aug", profileId: profile.id, kind: "height", observedAt: "2026-08-25", value: 86, unit: "cm", note: "8月测量，历史记录继续保留。", source: "家庭测量", visibility: "family" },
  { id: "growth-weight-aug", profileId: profile.id, kind: "weight", observedAt: "2026-08-25", value: 12.1, unit: "kg", note: "8月测量。", source: "家庭测量", visibility: "family" },
  { id: "growth-language", profileId: profile.id, lifeEventId: "event-xiaoai", kind: "language", observedAt: "2026-08-20", note: "偶尔会叫“妈妈”，开始对睡前语言互动作出明确回应。", source: "日常观察", visibility: "family" },
  { id: "growth-motor", profileId: profile.id, lifeEventId: "event-pool", kind: "motor", observedAt: "2026-08-10", note: "喜欢走、跑、玩水，活动意愿很强。", source: "日常观察", visibility: "family" },
  { id: "growth-social", profileId: profile.id, lifeEventId: "event-lake", kind: "social", observedAt: "2026-08-22", note: "面对外部世界时，观察和专注的时间变长了。", source: "日常观察", visibility: "family" },
  { id: "growth-sleep", profileId: profile.id, kind: "sleep", observedAt: "2026-08-24", note: "夜间睡眠已明显稳定，进入自主入睡过渡阶段。", source: "睡眠观察", visibility: "family" },
];

export const careRecords: CareRecord[] = [
  { id: "care-cold", profileId: profile.id, observedAt: "2026-08-19", kind: "health_observation", status: "观察中", note: "再次流鼻涕并伴随咳嗽，记录症状变化，不作确定诊断。", source: "家庭观察", visibility: "private" },
  { id: "care-sleep", profileId: profile.id, lifeEventId: "event-xiaoai", observedAt: "2026-08-24", kind: "sleep_note", status: "稳定", note: "夜间睡眠基本稳定，当前关注入睡方式。", source: "家庭观察", visibility: "private" },
  { id: "care-feeding", profileId: profile.id, observedAt: "2026-08-12", kind: "feeding_guidance", status: "记录中", note: "开始更多自主进食，外出优先选择原味、软一点、少馅料。", source: "家庭记录", visibility: "family" },
  { id: "care-checkup", profileId: profile.id, observedAt: "2026-09-01", kind: "reminder", status: "待关注", note: "下次儿保时现场评估脚趾甲沟情况。", source: "家庭提醒", visibility: "private" },
];

export const events: LifeEvent[] = [
  { id: "event-lake", profileId: profile.id, title: "东钱湖暴雨看湖", story: "宁波东钱湖遇上暴雨，他在临湖餐厅和露台附近认真看湖面、雨水、蜻蜓和小鸟。想记住的，是他面对外部世界时那份好奇与专注。", occurredAt: "2026-08-22", locationLabel: "宁波 · 东钱湖", people: ["妈妈", "爷爷奶奶"], tags: ["好奇", "旅行", "自然"], mediaIds: ["media-lake"], growthRecordIds: ["growth-social"], careRecordIds: [], eventType: "outing", visibility: "family" },
  { id: "event-xiaoai", profileId: profile.id, title: "睡前“小爱——诶、诶”", story: "灯光渐暗，张年躺在床上咿咿呀呀。家长喊不同家人时，他一开始几乎都回答“baba”；听到“小爱”却停顿了一下，认真答：“诶、诶。”", occurredAt: "2026-08-20", locationLabel: "家里 · 睡前", people: ["妈妈"], tags: ["语言互动", "睡前", "回应"], mediaIds: ["media-xiaoai"], growthRecordIds: ["growth-language"], careRecordIds: ["care-sleep"], eventType: "routine", visibility: "family" },
  { id: "event-walk", profileId: profile.id, title: "向前走的下午", story: "一段普通的散步，张年笑着往前走。现在的他，对脚下的路和身边的人都有自己的节奏。", occurredAt: "2026-08-17", locationLabel: "小区附近", people: ["家人"], tags: ["散步", "日常"], mediaIds: ["media-walk"], growthRecordIds: [], careRecordIds: [], eventType: "moment", visibility: "family" },
  { id: "event-pool", profileId: profile.id, title: "快乐池畔嬉戏时光", story: "周末到泳池玩水，张年开心得不想停下来。即使不小心呛到一点水，也没哭，还是继续兴奋地玩。", occurredAt: "2026-08-10", locationLabel: "宁波 · 泳池", people: ["妈妈", "爸爸"], tags: ["夏日", "玩水", "运动"], mediaIds: ["media-pool"], growthRecordIds: ["growth-motor"], careRecordIds: [], eventType: "outing", visibility: "family" },
  { id: "event-bus", profileId: profile.id, title: "公交车表演家", story: "听到《The Wheels on the Bus》，他会开心地比划动作，特别喜欢右手握拳敲左手手腕的位置来“表演”。", occurredAt: "2026-08-08", locationLabel: "家里 · 客厅", people: ["家人"], tags: ["音乐", "模仿", "动作"], mediaIds: ["media-bus"], growthRecordIds: [], careRecordIds: [], eventType: "moment", visibility: "family" },
  { id: "event-ball", profileId: profile.id, title: "客厅足球夜", story: "和妈妈在客厅来回踢球，一个普通、却特别幸福的晚上。", occurredAt: "2026-08-03", locationLabel: "家里 · 客厅", people: ["妈妈"], tags: ["妈妈", "运动", "晚上"], mediaIds: ["media-ball"], growthRecordIds: [], careRecordIds: [], eventType: "moment", visibility: "family" },
  { id: "event-book", profileId: profile.id, title: "第一次主动翻绘本", story: "绘本被放到身边时，张年开始自己翻页，也愿意停下来听一会儿。", occurredAt: "2026-07-28", locationLabel: "家里 · 沙发", people: ["妈妈"], tags: ["绘本", "语言", "专注"], mediaIds: ["media-book"], growthRecordIds: [], careRecordIds: [], eventType: "milestone", visibility: "family" },
  { id: "event-hat", profileId: profile.id, title: "尿不湿小帽子", story: "换尿不湿时，他坚持把尿不湿戴到头上，笑得特别开心。", occurredAt: "2026-07-21", locationLabel: "家里", people: ["家人"], tags: ["快乐", "游戏"], mediaIds: ["media-hat"], growthRecordIds: [], careRecordIds: [], eventType: "moment", visibility: "family" },
];

export const monthlySnapshot: MonthlySnapshot = { id: "snapshot-2026-08", profileId: profile.id, month: "2026-08", summary: "8月又长大了一点。夜间睡眠更稳定，吃饭越来越喜欢自己来，也开始偶尔叫“妈妈”、喜欢翻绘本了。", highlights: ["自主入睡过渡", "自主进食", "偶尔叫妈妈", "爱上绘本"], visibility: "family" };

export function getEvent(id: string) { return events.find((event) => event.id === id); }
export function getMediaForEvent(event: LifeEvent) { return media.filter((item) => event.mediaIds.includes(item.id)); }
export function getGrowthForEvent(event: LifeEvent) { return growthRecords.filter((record) => event.growthRecordIds.includes(record.id)); }
export function getCareForEvent(event: LifeEvent) { return careRecords.filter((record) => event.careRecordIds.includes(record.id)); }
