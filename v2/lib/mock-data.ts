import type { CareEpisode, CareRecord, CandidateMemory, Contributor, CurrentPortrait, DailyTrace, GrowthRecord, LifeEvent, Media, MonthArchive, MonthlySnapshot, Profile, RawSource, SleepPhase, YearArchive } from "./types";

export const profile: Profile = { id: "profile-zhangnian", displayName: "张年", birthDate: "2025-01-03", timezone: "Asia/Shanghai", bio: "把照片、原话和日子，慢慢放回他的时间里。", visibility: "family" };

export const contributors: Contributor[] = [
  { id: "contributor-mom", profileId: profile.id, role: "mother", displayName: "妈妈" },
  { id: "contributor-dad", profileId: profile.id, role: "father", displayName: "爸爸" },
  { id: "contributor-teacher", profileId: profile.id, role: "teacher", displayName: "老师" },
  { id: "contributor-hospital", profileId: profile.id, role: "hospital", displayName: "医院" },
  { id: "contributor-system", profileId: profile.id, role: "system_import", displayName: "系统导入" },
];

const image = (id: string, src: string, alt: string, takenAt: string, lifeEventId?: string, rawSourceId?: string): Media => ({ id, profileId: profile.id, lifeEventId, rawSourceId, type: "photo", src, alt, takenAt, visibility: "family", width: 1200, height: 900 });
const video = (id: string, src: string, alt: string, takenAt: string, durationSeconds: number, lifeEventId?: string, rawSourceId?: string): Media => ({ id, profileId: profile.id, lifeEventId, rawSourceId, type: "video", src, alt, takenAt, durationSeconds, posterSrc: src, visibility: "family", width: 1200, height: 900 });

export const media: Media[] = [
  image("media-ball-daycare", "/images/hero/2026-08-hero-walk.jpg", "张年追着托班里的哥哥姐姐一起踢球", "2026-08-28", "event-daycare-ball", "source-inbox-daycare-photos"),
  image("media-car", "/images/moments/2026-08-xiaoai.png", "张年看着窗外的车并用手指给家人看", "2026-08-27", "event-car", "source-car-photo"),
  image("media-lake", "/images/moments/2026-08-dongqian-lake.png", "张年在雨中的东钱湖边认真看着湖面", "2026-08-23", "event-lake", "source-lake-photos"),
  image("media-lake-2", "/images/moments/2026-08-dongqian-lake.png", "雨幕里的张年转身看向家人", "2026-08-23", "event-lake", "source-lake-photos"),
  video("media-lake-video", "/images/moments/2026-08-dongqian-lake.png", "张年站在露台边看雨的视频画面", "2026-08-23", 17, "event-lake", "source-lake-video"),
  image("media-xiaoai", "/images/moments/2026-08-xiaoai.png", "睡前的张年回应家人呼唤", "2026-08-20", "event-xiaoai", "source-xiaoai-photo"),
  image("media-walk", "/images/hero/2026-08-hero-walk.jpg", "张年笑着向前走的近期照片", "2026-08-17", "event-walk", "source-walk-photo"),
  image("media-pool", "/images/moments/2026-08-dongqian-lake.png", "张年在夏日泳池边玩水的家庭记录", "2026-08-10", "event-pool", "source-pool-photo"),
  video("media-pool-video", "/images/moments/2026-08-dongqian-lake.png", "张年在泳池边向前跑的视频画面", "2026-08-10", 23, "event-pool", "source-pool-video"),
  image("media-bus", "/images/moments/2026-08-xiaoai.png", "张年听到公交车歌曲时做出表演动作", "2026-08-08", "event-bus", "source-bus-photo"),
  image("media-ball", "/images/hero/2026-08-hero-walk.jpg", "张年和妈妈在客厅踢球的家庭记录", "2026-08-03", "event-ball", "source-ball-photo"),
  image("media-book", "/images/moments/2026-08-xiaoai.png", "张年和家人一起翻看绘本", "2026-07-28", "event-book", "source-book-photo"),
  image("media-hat", "/images/moments/2026-08-dongqian-lake.png", "张年把尿不湿戴在头上开心地笑", "2026-07-21", "event-hat", "source-hat-photo"),
  ...Array.from({ length: 8 }, (_, index) => image(`inbox-daycare-${index + 1}`, index % 2 === 0 ? "/images/hero/2026-08-hero-walk.jpg" : "/images/moments/2026-08-dongqian-lake.png", `张年在托班户外活动中追球的第 ${index + 1} 张记录`, "2026-08-28", undefined, "source-inbox-daycare-photos")),
  video("inbox-dad-video", "/images/hero/2026-08-hero-walk.jpg", "张年回家后还在客厅追球的视频画面", "2026-08-28", 23, undefined, "source-inbox-dad-video"),
];

export const growthRecords: GrowthRecord[] = [
  { id: "height-2025-11", profileId: profile.id, kind: "height", observedAt: "2025-11-03", value: 73.2, unit: "cm", note: "家庭历史测量。", source: "家庭测量", visibility: "family" },
  { id: "height-2026-03", profileId: profile.id, kind: "height", observedAt: "2026-03-03", value: 82, unit: "cm", note: "家庭历史测量。", source: "家庭测量", visibility: "family" },
  { id: "height-2026-05", profileId: profile.id, kind: "height", observedAt: "2026-05-03", value: 85, unit: "cm", note: "家庭历史测量。", source: "家庭测量", visibility: "family" },
  { id: "height-2026-08", profileId: profile.id, kind: "height", observedAt: "2026-08-25", value: 86, unit: "cm", note: "8 月测量；历史记录继续保留。", source: "家庭测量", visibility: "family" },
  { id: "weight-2025-11", profileId: profile.id, kind: "weight", observedAt: "2025-11-03", value: 10.2, unit: "kg", note: "家庭历史测量。", source: "家庭测量", visibility: "family" },
  { id: "weight-2026-02", profileId: profile.id, kind: "weight", observedAt: "2026-02-03", value: 11.45, unit: "kg", note: "家庭历史测量。", source: "家庭测量", visibility: "family" },
  { id: "weight-2026-03", profileId: profile.id, kind: "weight", observedAt: "2026-03-03", value: 11.48, unit: "kg", note: "家庭历史测量。", source: "家庭测量", visibility: "family" },
  { id: "weight-2026-05", profileId: profile.id, kind: "weight", observedAt: "2026-05-03", value: 11.2, unit: "kg", note: "家庭历史测量。", source: "家庭测量", visibility: "family" },
  { id: "weight-2026-08", profileId: profile.id, kind: "weight", observedAt: "2026-08-25", value: 12.1, unit: "kg", note: "8 月测量。", source: "家庭测量", visibility: "family" },
  { id: "language-baba", profileId: profile.id, kind: "language", observedAt: "2026-06-18", note: "开始稳定地叫“爸爸”。", source: "家庭聊天", visibility: "family" },
  { id: "language-mama", profileId: profile.id, kind: "language", observedAt: "2026-08-18", note: "偶尔会叫“妈妈”。", source: "日常观察", visibility: "family" },
  { id: "language-xiaoai", profileId: profile.id, lifeEventId: "event-xiaoai", kind: "language", observedAt: "2026-08-20", note: "听到“小爱”时认真答：“诶、诶。”", source: "家庭视频", visibility: "family" },
  { id: "language-car", profileId: profile.id, lifeEventId: "event-car", kind: "language", observedAt: "2026-08-27", note: "看到车辆会说“车车”，也会主动指给家人看。", source: "家庭聊天", visibility: "family" },
  { id: "motor-walk", profileId: profile.id, lifeEventId: "event-walk", kind: "motor", observedAt: "2026-08-17", note: "走路越来越稳。", source: "家庭照片", visibility: "family" },
  { id: "motor-run", profileId: profile.id, lifeEventId: "event-pool", kind: "motor", observedAt: "2026-08-10", note: "开始跑，喜欢玩水。", source: "日常观察", visibility: "family" },
  { id: "motor-ball", profileId: profile.id, lifeEventId: "event-daycare-ball", kind: "motor", observedAt: "2026-08-28", note: "开始主动追着其他孩子踢球。", source: "托班记录", visibility: "family" },
  { id: "social-ball", profileId: profile.id, lifeEventId: "event-daycare-ball", kind: "social", observedAt: "2026-08-28", note: "开始主动参与其他孩子的活动。", source: "托班记录", visibility: "family" },
];

export const currentPortrait: CurrentPortrait[] = [
  { label: "语言", summary: "会说“爸爸、妈妈、车车”，也会认真回应。", recordId: "language-car" },
  { label: "运动", summary: "走稳了，开始跑，也开始追着球走进人群。", recordId: "motor-ball" },
  { label: "饮食", summary: "愿意自己动手吃，正在形成自己的选择。" },
  { label: "睡眠", summary: "夜间已经稳定，正在过渡到自主入睡。", private: true },
  { label: "兴趣", summary: "车、绘本、球，还有雨落在湖面上的样子。" },
  { label: "性格", summary: "开朗、好奇，越来越愿意主动参与。" },
];

export const sleepJourney: SleepPhase[] = [
  { id: "sleep-1", label: "频繁夜醒", startedAt: "2025-07", note: "夜里醒来很多次，需要抱着重新入睡。" },
  { id: "sleep-2", label: "夜醒减少", startedAt: "2025-11", note: "夜醒次数开始下降。" },
  { id: "sleep-3", label: "夜间稳定", startedAt: "2026-04", note: "大部分夜晚可以连续睡眠。" },
  { id: "sleep-4", label: "抱睡退出", startedAt: "2026-07", note: "逐步减少抱睡。" },
  { id: "sleep-5", label: "自主入睡过渡", startedAt: "2026-08", note: "当前关注从夜醒转向如何自己睡着。", current: true },
];

export const careRecords: CareRecord[] = [
  { id: "care-cold-start", profileId: profile.id, careEpisodeId: "episode-cold-aug", observedAt: "2026-08-19", kind: "health_observation", status: "观察中", title: "呼吸道", note: "开始流鼻涕，随后出现咳嗽；未记录发热。", history: "2026 年 7 月曾有一轮呼吸道症状，已恢复。", nextStep: "继续记录变化；本档案不作诊断。", source: "家庭观察", visibility: "private" },
  { id: "care-cold-sleep", profileId: profile.id, careEpisodeId: "episode-cold-aug", observedAt: "2026-08-24", kind: "sleep_note", status: "观察中", title: "睡眠受到影响", note: "夜间睡眠较平时不稳。", source: "家庭观察", visibility: "private" },
  { id: "care-cold-visit", profileId: profile.id, careEpisodeId: "episode-cold-aug", observedAt: "2026-08-26", kind: "medical_visit", status: "观察中", title: "就医记录", note: "保留检查与医生原始记录；Mock 中不展示具体医疗事实。", source: "医疗文档", sourceIds: ["source-medical-mock"], visibility: "private" },
  { id: "care-cold-better", profileId: profile.id, careEpisodeId: "episode-cold-aug", observedAt: "2026-08-27", kind: "health_observation", status: "已稳定", title: "状态改善", note: "家庭观察到状态转好。", source: "家庭观察", visibility: "private" },
  { id: "care-toe", profileId: profile.id, observedAt: "2026-08-01", kind: "health_observation", status: "长期关注", title: "双侧大脚趾甲沟／边缘", note: "无明显疼痛或急性感染表现。", nextStep: "下次儿童保健时现场评估。", source: "家庭观察", visibility: "private" },
  { id: "care-brushing", profileId: profile.id, observedAt: "2026-08-01", kind: "reminder", status: "习惯建立", title: "牙齿与刷牙", note: "对刷牙配合度一般，有效清洁仍需巩固。", nextStep: "保持固定流程。", source: "家庭记录", visibility: "private" },
  { id: "care-scar", profileId: profile.id, observedAt: "2026-08-01", kind: "health_observation", status: "护理中", title: "疤痕", note: "保留历史护理记录。", source: "家庭记录", visibility: "private" },
  { id: "care-screen", profileId: profile.id, observedAt: "2026-08-01", kind: "reminder", status: "记录中", title: "屏幕使用", note: "先记录频率与时长，再按家庭节奏调整。", source: "家庭记录", visibility: "private" },
  { id: "care-jaundice", profileId: profile.id, observedAt: "2025-01-05", kind: "health_observation", status: "历史", title: "新生儿黄疸", note: "历史记录已稳定，仅保留原始事实。", source: "历史记录", visibility: "private" },
];

export const careEpisodes: CareEpisode[] = [{ id: "episode-cold-aug", profileId: profile.id, title: "八月呼吸道观察", startedAt: "2026-08-19", endedAt: "2026-08-27", recordIds: ["care-cold-start", "care-cold-sleep", "care-cold-visit", "care-cold-better"], sourceIds: ["source-medical-mock"], status: "resolved", visibility: "private" }];

export const rawSources: RawSource[] = [
  { id: "source-inbox-daycare-photos", profileId: profile.id, sourceType: "daycare_photo", contentTypes: ["daycare", "motor", "growth"], contributorId: "contributor-teacher", capturedAt: "2026-08-28T16:20:00+08:00", importedAt: "2026-08-28T20:06:00+08:00", mediaIds: Array.from({ length: 8 }, (_, index) => `inbox-daycare-${index + 1}`), sourceLabel: "托班相册", visibility: "family", status: "inbox" },
  { id: "source-inbox-daycare-note", profileId: profile.id, sourceType: "daycare_note", contentTypes: ["daycare", "motor"], contributorId: "contributor-teacher", capturedAt: "2026-08-28T16:35:00+08:00", importedAt: "2026-08-28T20:06:00+08:00", text: "今天户外活动的时候特别喜欢追着球跑。", mediaIds: [], sourceLabel: "老师记录", visibility: "family", status: "inbox" },
  { id: "source-inbox-mom-wechat", profileId: profile.id, sourceType: "wechat", contentTypes: ["language", "family"], contributorId: "contributor-mom", capturedAt: "2026-08-28T18:42:00+08:00", importedAt: "2026-08-28T20:14:00+08:00", text: "今天回来一直在说车车，感觉突然一下会说好多东西了。", mediaIds: [], sourceLabel: "家庭微信", visibility: "family", status: "inbox" },
  { id: "source-inbox-dad-wechat", profileId: profile.id, sourceType: "wechat", contentTypes: ["language", "family"], contributorId: "contributor-dad", capturedAt: "2026-08-28T19:03:00+08:00", importedAt: "2026-08-28T20:14:00+08:00", text: "他看到车就指给我看，今天一路都在说。", mediaIds: [], sourceLabel: "家庭微信", visibility: "family", status: "inbox" },
  { id: "source-inbox-dad-video", profileId: profile.id, sourceType: "family_video", contentTypes: ["motor", "family"], contributorId: "contributor-dad", capturedAt: "2026-08-28T19:21:00+08:00", importedAt: "2026-08-28T20:20:00+08:00", mediaIds: ["inbox-dad-video"], sourceLabel: "爸爸的手机", visibility: "family", status: "inbox" },
  { id: "source-medical-mock", profileId: profile.id, sourceType: "medical_document", contentTypes: ["health"], contributorId: "contributor-hospital", capturedAt: "2026-08-26T10:00:00+08:00", importedAt: "2026-08-26T20:00:00+08:00", mediaIds: [], sourceLabel: "就医资料（Mock）", visibility: "private", status: "reviewed", extractedMedicalFacts: { hospital: "某医院", examinationType: "门诊记录", recordedAt: "2026-08-26", facts: ["等待家庭确认的结构化事实"] } },
  { id: "source-lake-photos", profileId: profile.id, sourceType: "family_photo", contentTypes: ["travel", "daily"], contributorId: "contributor-mom", capturedAt: "2026-08-23T16:18:00+08:00", importedAt: "2026-08-23T21:10:00+08:00", mediaIds: ["media-lake", "media-lake-2"], sourceLabel: "妈妈的手机", visibility: "family", status: "attached", relatedLifeEventId: "event-lake" },
  { id: "source-lake-video", profileId: profile.id, sourceType: "family_video", contentTypes: ["travel"], contributorId: "contributor-dad", capturedAt: "2026-08-23T18:31:00+08:00", importedAt: "2026-08-23T21:10:00+08:00", mediaIds: ["media-lake-video"], sourceLabel: "爸爸的手机", visibility: "family", status: "attached", relatedLifeEventId: "event-lake" },
  { id: "source-lake-wechat", profileId: profile.id, sourceType: "wechat", contentTypes: ["travel", "family"], contributorId: "contributor-mom", capturedAt: "2026-08-23T18:42:00+08:00", importedAt: "2026-08-23T21:10:00+08:00", text: "他居然看了十几分钟都没走。", mediaIds: [], sourceLabel: "家庭微信", visibility: "family", status: "attached", relatedLifeEventId: "event-lake" },
  { id: "source-lake-note", profileId: profile.id, sourceType: "parent_note", contentTypes: ["travel", "family"], contributorId: "contributor-mom", capturedAt: "2026-08-23T21:03:00+08:00", importedAt: "2026-08-23T21:03:00+08:00", text: "雨下得很大，但他一直没有害怕，只是认真看着。", mediaIds: [], sourceLabel: "家庭备注", visibility: "family", status: "attached", relatedLifeEventId: "event-lake" },
  { id: "source-xiaoai-photo", profileId: profile.id, sourceType: "family_photo", contentTypes: ["language", "family"], contributorId: "contributor-mom", capturedAt: "2026-08-20T20:11:00+08:00", importedAt: "2026-08-20T21:00:00+08:00", mediaIds: ["media-xiaoai"], sourceLabel: "妈妈的手机", visibility: "family", status: "attached", relatedLifeEventId: "event-xiaoai" },
  { id: "source-xiaoai-wechat", profileId: profile.id, sourceType: "wechat", contentTypes: ["language", "family"], contributorId: "contributor-mom", capturedAt: "2026-08-20T21:26:00+08:00", importedAt: "2026-08-20T21:30:00+08:00", text: "今天喊小爱，他居然答了两声诶。", mediaIds: [], sourceLabel: "家庭微信", visibility: "family", status: "attached", relatedLifeEventId: "event-xiaoai" },
  { id: "source-walk-photo", profileId: profile.id, sourceType: "family_photo", contentTypes: ["daily", "motor"], contributorId: "contributor-mom", capturedAt: "2026-08-17T16:05:00+08:00", importedAt: "2026-08-17T20:00:00+08:00", text: "走得稳一点以后，散步开始有了自己的方向。", mediaIds: ["media-walk"], sourceLabel: "妈妈的手机", visibility: "family", status: "attached", relatedLifeEventId: "event-walk" },
  { id: "source-pool-photo", profileId: profile.id, sourceType: "family_photo", contentTypes: ["travel", "motor"], contributorId: "contributor-mom", capturedAt: "2026-08-10T15:30:00+08:00", importedAt: "2026-08-10T20:10:00+08:00", mediaIds: ["media-pool"], sourceLabel: "妈妈的手机", visibility: "family", status: "attached", relatedLifeEventId: "event-pool" },
  { id: "source-pool-video", profileId: profile.id, sourceType: "family_video", contentTypes: ["travel", "motor"], contributorId: "contributor-dad", capturedAt: "2026-08-10T15:42:00+08:00", importedAt: "2026-08-10T20:10:00+08:00", mediaIds: ["media-pool-video"], sourceLabel: "爸爸的手机", visibility: "family", status: "attached", relatedLifeEventId: "event-pool" },
  { id: "source-bus-photo", profileId: profile.id, sourceType: "family_photo", contentTypes: ["interest", "funny_moment"], contributorId: "contributor-mom", capturedAt: "2026-08-08T19:15:00+08:00", importedAt: "2026-08-08T20:00:00+08:00", text: "听到公交车的歌，会先看我们有没有准备好看他的表演。", mediaIds: ["media-bus"], sourceLabel: "妈妈的手机", visibility: "family", status: "attached", relatedLifeEventId: "event-bus" },
  { id: "source-ball-photo", profileId: profile.id, sourceType: "family_photo", contentTypes: ["motor", "family"], contributorId: "contributor-mom", capturedAt: "2026-08-03T20:05:00+08:00", importedAt: "2026-08-03T21:00:00+08:00", text: "球滚远了，他会自己走过去捡回来。", mediaIds: ["media-ball"], sourceLabel: "妈妈的手机", visibility: "family", status: "attached", relatedLifeEventId: "event-ball" },
  { id: "source-book-photo", profileId: profile.id, sourceType: "family_photo", contentTypes: ["interest", "language"], contributorId: "contributor-mom", capturedAt: "2026-07-28T19:40:00+08:00", importedAt: "2026-07-28T21:00:00+08:00", text: "他开始自己决定要翻哪一页了。", mediaIds: ["media-book"], sourceLabel: "妈妈的手机", visibility: "family", status: "attached", relatedLifeEventId: "event-book" },
  { id: "source-hat-photo", profileId: profile.id, sourceType: "family_photo", contentTypes: ["funny_moment", "family"], contributorId: "contributor-mom", capturedAt: "2026-07-21T18:25:00+08:00", importedAt: "2026-07-21T20:00:00+08:00", mediaIds: ["media-hat"], sourceLabel: "妈妈的手机", visibility: "family", status: "attached", relatedLifeEventId: "event-hat" },
];

export const events: LifeEvent[] = [
  { id: "event-daycare-ball", profileId: profile.id, title: "追着哥哥姐姐一起踢球", story: "户外活动时，他不再只站在旁边看，开始追着球和其他孩子一起跑。", occurredAt: "2026-08-28", locationLabel: "托班", people: ["老师", "托班伙伴"], tags: ["托班", "运动", "社交"], contentTypes: ["daycare", "motor", "growth"], mediaIds: ["media-ball-daycare"], sourceIds: [], growthRecordIds: ["motor-ball", "social-ball"], careRecordIds: [], eventType: "milestone", memoryWeight: "highlight", scopes: ["daycare", "growth"], heroMediaId: "media-ball-daycare", visibility: "family", keptInYearbook: true },
  { id: "event-car", profileId: profile.id, title: "开始一直说“车车”", story: "看到车时，他会指给我们看，再认真地说一遍“车车”。", occurredAt: "2026-08-27", locationLabel: "回家路上", people: ["妈妈", "爸爸"], tags: ["语言", "车车"], contentTypes: ["language", "growth"], mediaIds: ["media-car"], sourceIds: [], growthRecordIds: ["language-car"], careRecordIds: [], eventType: "milestone", memoryWeight: "highlight", scopes: ["family", "growth"], heroMediaId: "media-car", visibility: "family", keptInYearbook: true },
  { id: "event-lake", profileId: profile.id, title: "暴雨的时候看了很久的湖", story: "宁波东钱湖遇上暴雨，他在临湖露台认真看湖面、雨水、蜻蜓和小鸟。", storySections: ["雨声很大，家人都在说要不要先回去。他没有急着走，只是看雨水一阵一阵落到湖面。", "所谓长大，有时只是他开始有了自己的观看方式。"], occurredAt: "2026-08-23", locationLabel: "宁波 · 东钱湖", people: ["妈妈", "爷爷奶奶"], tags: ["好奇", "旅行", "自然"], contentTypes: ["travel", "growth"], mediaIds: ["media-lake", "media-lake-2", "media-lake-video"], sourceIds: ["source-lake-photos", "source-lake-video", "source-lake-wechat", "source-lake-note"], growthRecordIds: [], careRecordIds: [], eventType: "chapter", memoryWeight: "chapter", scopes: ["outing", "family", "growth"], heroMediaId: "media-lake", visibility: "family", keptInYearbook: true },
  { id: "event-xiaoai", profileId: profile.id, title: "第一次认真回应“小爱”", story: "灯光渐暗，家人喊“小爱”，他停顿了一下，认真答：“诶、诶。”", storySections: ["那一声并不标准，也不是每次都会出现。但他听见了，想了一下，再把自己的回答送回来。"], occurredAt: "2026-08-20", locationLabel: "家里 · 睡前", people: ["妈妈"], tags: ["语言互动", "睡前", "回应"], contentTypes: ["language", "milestone"], mediaIds: ["media-xiaoai"], sourceIds: ["source-xiaoai-photo", "source-xiaoai-wechat"], growthRecordIds: ["language-xiaoai"], careRecordIds: [], eventType: "milestone", memoryWeight: "highlight", scopes: ["family", "growth"], heroMediaId: "media-xiaoai", visibility: "family", keptInYearbook: true },
  { id: "event-walk", profileId: profile.id, title: "向前走的下午", story: "一段普通的散步，张年笑着往前走。", occurredAt: "2026-08-17", locationLabel: "小区附近", people: ["家人"], tags: ["散步", "日常"], contentTypes: ["daily", "motor"], mediaIds: ["media-walk"], sourceIds: ["source-walk-photo"], growthRecordIds: ["motor-walk"], careRecordIds: [], eventType: "moment", memoryWeight: "memory", scopes: ["family", "growth"], heroMediaId: "media-walk", visibility: "family", keptInYearbook: false },
  { id: "event-pool", profileId: profile.id, title: "池边一直跑到天快黑", story: "周末到泳池玩水，张年开心得不想停下来。", occurredAt: "2026-08-10", locationLabel: "宁波 · 泳池", people: ["妈妈", "爸爸"], tags: ["夏日", "玩水", "运动"], contentTypes: ["travel", "motor"], mediaIds: ["media-pool", "media-pool-video"], sourceIds: ["source-pool-photo", "source-pool-video"], growthRecordIds: ["motor-run"], careRecordIds: [], eventType: "outing", memoryWeight: "chapter", scopes: ["outing", "family", "growth"], heroMediaId: "media-pool", visibility: "family", keptInYearbook: true },
  { id: "event-bus", profileId: profile.id, title: "公交车表演家", story: "听到《The Wheels on the Bus》，他会开心地比划动作。", occurredAt: "2026-08-08", locationLabel: "家里 · 客厅", people: ["家人"], tags: ["音乐", "模仿"], contentTypes: ["interest", "funny_moment"], mediaIds: ["media-bus"], sourceIds: ["source-bus-photo"], growthRecordIds: [], careRecordIds: [], eventType: "moment", memoryWeight: "memory", scopes: ["family"], heroMediaId: "media-bus", visibility: "family", keptInYearbook: false },
  { id: "event-ball", profileId: profile.id, title: "客厅足球夜", story: "和妈妈在客厅来回踢球，一个普通、却特别幸福的晚上。", occurredAt: "2026-08-03", locationLabel: "家里 · 客厅", people: ["妈妈"], tags: ["妈妈", "运动"], contentTypes: ["motor", "family"], mediaIds: ["media-ball"], sourceIds: ["source-ball-photo"], growthRecordIds: [], careRecordIds: [], eventType: "moment", memoryWeight: "memory", scopes: ["family"], heroMediaId: "media-ball", visibility: "family", keptInYearbook: true },
  { id: "event-book", profileId: profile.id, title: "第一次主动翻绘本", story: "绘本被放到身边时，张年开始自己翻页。", occurredAt: "2026-07-28", locationLabel: "家里 · 沙发", people: ["妈妈"], tags: ["绘本", "语言"], contentTypes: ["interest", "milestone"], mediaIds: ["media-book"], sourceIds: ["source-book-photo"], growthRecordIds: [], careRecordIds: [], eventType: "milestone", memoryWeight: "highlight", scopes: ["family", "growth"], heroMediaId: "media-book", visibility: "family", keptInYearbook: true },
  { id: "event-hat", profileId: profile.id, title: "尿不湿小帽子", story: "换尿不湿时，他坚持把尿不湿戴到头上，笑得特别开心。", occurredAt: "2026-07-21", locationLabel: "家里", people: ["家人"], tags: ["快乐", "游戏"], contentTypes: ["funny_moment", "family"], mediaIds: ["media-hat"], sourceIds: ["source-hat-photo"], growthRecordIds: [], careRecordIds: [], eventType: "moment", memoryWeight: "trace", scopes: ["family"], heroMediaId: "media-hat", visibility: "family", keptInYearbook: false },
];

export const dailyTraces: DailyTrace[] = [
  { id: "trace-0819", profileId: profile.id, occurredAt: "2026-08-19", entries: ["托班户外活动 · 8 张照片", "晚上自己吃完半碗饭", "新增一个词：“车车”"], sourceIds: [], scopes: ["daycare", "family", "growth"], visibility: "family" },
  { id: "trace-0814", profileId: profile.id, occurredAt: "2026-08-14", entries: ["午睡醒来后自己搬积木", "在窗边看了很久的车"], sourceIds: [], scopes: ["family", "growth"], visibility: "family" },
];

export const candidateMemories: CandidateMemory[] = [{ id: "candidate-ball-0828", profileId: profile.id, occurredAt: "2026-08-28", contextLabel: "托班", title: "第一次追着哥哥姐姐一起踢球", description: "12 张托班照片、1 段视频、1 条老师记录和 2 条家庭聊天落在了同一条线上。", sourceIds: ["source-inbox-daycare-photos", "source-inbox-daycare-note", "source-inbox-mom-wechat", "source-inbox-dad-wechat", "source-inbox-dad-video"], suggestedContentTypes: ["daycare", "motor", "growth"], suggestedTags: ["托班", "运动", "社交"], growthInsight: "开始主动参与其他孩子的活动。", storyDraft: "户外活动时，他不再只站在旁边看，开始追着球和哥哥姐姐一起跑。", status: "suggested", visibility: "family" }];

export const monthlySnapshot: MonthlySnapshot = { id: "snapshot-2026-08", profileId: profile.id, month: "2026-08", summary: "这个月，他开始说更多话，也越来越会回应我们了。", highlights: ["开始说“车车”", "走路更稳", "主动翻绘本", "会追着球跑"], visibility: "family" };
export const monthArchives: MonthArchive[] = [{ id: "archive-month-2026-08", profileId: profile.id, month: "2026-08", label: "八月", coverMediaId: "media-lake", summary: monthlySnapshot.summary, highlights: monthlySnapshot.highlights, momentCount: 23, photoCount: 186, videoCount: 12, visibility: "family" }];
export const yearArchive: YearArchive = { id: "archive-year-2026", profileId: profile.id, year: "2026", title: "正在长成的一年", intro: "这一年还没有结束。我们先把已经留下来的部分，放在这里。", monthIds: monthArchives.map((month) => month.id), visibility: "family" };

export const inboxSources = rawSources.filter((source) => source.status === "inbox");
export const getContributor = (id: string) => contributors.find((item) => item.id === id);
export const getEvent = (id: string) => events.find((event) => event.id === id);
export const getMediaForEvent = (event: LifeEvent) => { const ids = new Set(event.mediaIds); return media.filter((item) => ids.has(item.id)); };
export const getSourcesForEvent = (event: LifeEvent) => { const ids = new Set(event.sourceIds); return rawSources.filter((source) => ids.has(source.id)); };
export const getMediaForSource = (source: RawSource) => { const ids = new Set(source.mediaIds); return media.filter((item) => ids.has(item.id)); };
export const getGrowthForEvent = (event: LifeEvent) => { const ids = new Set(event.growthRecordIds); return growthRecords.filter((record) => ids.has(record.id)); };
export const getCareForEvent = (event: LifeEvent) => { const ids = new Set(event.careRecordIds); return careRecords.filter((record) => ids.has(record.id) && record.visibility !== "private"); };
