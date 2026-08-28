import type { CareRecord, CandidateMemory, DailyTrace, GrowthRecord, LifeEvent, Media, MonthlySnapshot, MonthArchive, Profile, RawSource, YearArchive } from "./types";

export const profile: Profile = { id: "profile-zhangnian", displayName: "张年", birthDate: "2025-01-03", timezone: "Asia/Shanghai", bio: "把留下来的照片、话和日子，慢慢放回他的时间里。", visibility: "family" };

const image = (id: string, src: string, alt: string, takenAt: string, lifeEventId?: string, rawSourceId?: string): Media => ({ id, profileId: profile.id, lifeEventId, rawSourceId, type: "photo", src, alt, takenAt, visibility: "family", width: 1200, height: 900 });
const video = (id: string, src: string, alt: string, takenAt: string, durationSeconds: number, lifeEventId?: string, rawSourceId?: string): Media => ({ id, profileId: profile.id, lifeEventId, rawSourceId, type: "video", src, alt, takenAt, durationSeconds, visibility: "family", width: 1200, height: 900 });

export const media: Media[] = [
  image("media-lake", "/v2/images/moments/2026-08-dongqian-lake.png", "张年在雨中的东钱湖边认真看着湖面", "2026-08-22", "event-lake", "source-lake-photos"),
  image("media-lake-2", "/v2/images/moments/2026-08-dongqian-lake.png", "雨幕里的张年转身看向家人", "2026-08-22", "event-lake", "source-lake-photos"),
  video("media-lake-video", "/v2/images/moments/2026-08-dongqian-lake.png", "张年站在露台边看雨的视频画面", "2026-08-22", 17, "event-lake", "source-lake-video"),
  image("media-xiaoai", "/v2/images/moments/2026-08-xiaoai.png", "睡前的张年回应家人呼唤", "2026-08-20", "event-xiaoai", "source-xiaoai-photo"),
  image("media-walk", "/v2/images/hero/2026-08-hero-walk.jpg", "张年笑着向前走的近期照片", "2026-08-17", "event-walk", "source-walk-photo"),
  image("media-pool", "/v2/images/moments/2026-08-dongqian-lake.png", "张年在夏日泳池边玩水的家庭记录", "2026-08-10", "event-pool", "source-pool-photo"),
  video("media-pool-video", "/v2/images/moments/2026-08-dongqian-lake.png", "张年在泳池边向前跑的视频画面", "2026-08-10", 23, "event-pool", "source-pool-video"),
  image("media-bus", "/v2/images/moments/2026-08-xiaoai.png", "张年听到公交车歌曲时做出表演动作", "2026-08-08", "event-bus", "source-bus-photo"),
  image("media-ball", "/v2/images/hero/2026-08-hero-walk.jpg", "张年和妈妈在客厅踢球的家庭记录", "2026-08-03", "event-ball", "source-ball-photo"),
  image("media-book", "/v2/images/moments/2026-08-xiaoai.png", "张年和家人一起翻看绘本", "2026-07-28", "event-book", "source-book-photo"),
  image("media-hat", "/v2/images/moments/2026-08-dongqian-lake.png", "张年把尿不湿戴在头上开心地笑", "2026-07-21", "event-hat", "source-hat-photo"),
  image("inbox-daycare-1", "/v2/images/moments/2026-08-dongqian-lake.png", "张年在托班户外活动中追着球跑", "2026-08-28", undefined, "source-inbox-daycare-photos"),
  image("inbox-daycare-2", "/v2/images/hero/2026-08-hero-walk.jpg", "张年在托班操场上回头看球", "2026-08-28", undefined, "source-inbox-daycare-photos"),
  image("inbox-daycare-3", "/v2/images/moments/2026-08-xiaoai.png", "张年在户外活动中伸手接近足球", "2026-08-28", undefined, "source-inbox-daycare-photos"),
  image("inbox-daycare-4", "/v2/images/moments/2026-08-dongqian-lake.png", "张年站在托班操场边观察大家踢球", "2026-08-28", undefined, "source-inbox-daycare-photos"),
  image("inbox-daycare-5", "/v2/images/hero/2026-08-hero-walk.jpg", "张年在托班户外活动里迈步向前", "2026-08-28", undefined, "source-inbox-daycare-photos"),
  image("inbox-daycare-6", "/v2/images/moments/2026-08-xiaoai.png", "张年抱着球站在操场中央", "2026-08-28", undefined, "source-inbox-daycare-photos"),
  image("inbox-daycare-7", "/v2/images/moments/2026-08-dongqian-lake.png", "张年在托班活动后朝老师笑", "2026-08-28", undefined, "source-inbox-daycare-photos"),
  image("inbox-daycare-8", "/v2/images/hero/2026-08-hero-walk.jpg", "张年追着球跑过一小段路", "2026-08-28", undefined, "source-inbox-daycare-photos"),
  video("inbox-dad-video", "/v2/images/hero/2026-08-hero-walk.jpg", "张年回家后还在客厅追球的视频画面", "2026-08-28", 23, undefined, "source-inbox-dad-video"),
];

export const growthRecords: GrowthRecord[] = [
  { id: "growth-height-aug", profileId: profile.id, kind: "height", observedAt: "2026-08-25", value: 86, unit: "cm", note: "8月测量，历史记录继续保留。", source: "家庭测量", visibility: "family" },
  { id: "growth-weight-aug", profileId: profile.id, kind: "weight", observedAt: "2026-08-25", value: 12.1, unit: "kg", note: "8月测量。", source: "家庭测量", visibility: "family" },
  { id: "growth-language-baba", profileId: profile.id, kind: "language", observedAt: "2026-06-18", note: "开始稳定地叫“爸爸”。", source: "家庭聊天", visibility: "family" },
  { id: "growth-language-mama", profileId: profile.id, kind: "language", observedAt: "2026-08-18", note: "偶尔会叫“妈妈”，开始主动回应家人的话。", source: "日常观察", visibility: "family" },
  { id: "growth-language-xiaoai", profileId: profile.id, lifeEventId: "event-xiaoai", kind: "language", observedAt: "2026-08-20", note: "听到“小爱”时停顿，然后认真答：“诶、诶。”", source: "家庭视频", visibility: "family" },
  { id: "growth-language-car", profileId: profile.id, kind: "language", observedAt: "2026-08-27", note: "最近会说“车车”，看到窗外车辆会主动指给家人看。", source: "家庭聊天", visibility: "family" },
  { id: "growth-motor-walk", profileId: profile.id, lifeEventId: "event-walk", kind: "motor", observedAt: "2026-08-17", note: "走路越来越稳，开始把注意力放到更远的地方。", source: "家庭照片", visibility: "family" },
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

export const rawSources: RawSource[] = [
  { id: "source-inbox-daycare-photos", profileId: profile.id, sourceType: "daycare_photo", capturedAt: "2026-08-28T16:20:00+08:00", importedAt: "2026-08-28T20:06:00+08:00", mediaIds: ["inbox-daycare-1", "inbox-daycare-2", "inbox-daycare-3", "inbox-daycare-4", "inbox-daycare-5", "inbox-daycare-6", "inbox-daycare-7", "inbox-daycare-8"], sourceLabel: "托班", authorLabel: "老师", visibility: "family", status: "inbox" },
  { id: "source-inbox-daycare-note", profileId: profile.id, sourceType: "daycare_note", capturedAt: "2026-08-28T16:35:00+08:00", importedAt: "2026-08-28T20:06:00+08:00", text: "今天户外活动的时候特别喜欢追着球跑。", mediaIds: [], sourceLabel: "托班", authorLabel: "老师", visibility: "family", status: "inbox" },
  { id: "source-inbox-mom-wechat", profileId: profile.id, sourceType: "wechat", capturedAt: "2026-08-28T18:42:00+08:00", importedAt: "2026-08-28T20:14:00+08:00", text: "今天回来一直在说车车，感觉突然一下会说好多东西了。", mediaIds: [], sourceLabel: "妈妈微信", authorLabel: "妈妈", visibility: "family", status: "inbox" },
  { id: "source-inbox-dad-wechat", profileId: profile.id, sourceType: "wechat", capturedAt: "2026-08-28T19:08:00+08:00", importedAt: "2026-08-28T20:14:00+08:00", text: "他看到车就指给我看，今天一路都在说车车。", mediaIds: [], sourceLabel: "爸爸微信", authorLabel: "爸爸", visibility: "family", status: "inbox" },
  { id: "source-inbox-dad-video", profileId: profile.id, sourceType: "family_video", capturedAt: "2026-08-28T19:21:00+08:00", importedAt: "2026-08-28T20:20:00+08:00", mediaIds: ["inbox-dad-video"], sourceLabel: "爸爸", authorLabel: "爸爸", visibility: "family", status: "inbox" },
  { id: "source-lake-photos", profileId: profile.id, sourceType: "family_photo", capturedAt: "2026-08-22T16:18:00+08:00", importedAt: "2026-08-22T21:10:00+08:00", mediaIds: ["media-lake", "media-lake-2"], sourceLabel: "妈妈的手机", authorLabel: "妈妈", visibility: "family", status: "attached", relatedLifeEventId: "event-lake" },
  { id: "source-lake-video", profileId: profile.id, sourceType: "family_video", capturedAt: "2026-08-22T18:31:00+08:00", importedAt: "2026-08-22T21:10:00+08:00", mediaIds: ["media-lake-video"], sourceLabel: "爸爸的手机", authorLabel: "爸爸", visibility: "family", status: "attached", relatedLifeEventId: "event-lake" },
  { id: "source-lake-wechat", profileId: profile.id, sourceType: "wechat", capturedAt: "2026-08-22T18:42:00+08:00", importedAt: "2026-08-22T21:10:00+08:00", text: "他居然看了十几分钟都没走。", mediaIds: [], sourceLabel: "微信", authorLabel: "妈妈", visibility: "family", status: "attached", relatedLifeEventId: "event-lake" },
  { id: "source-lake-note", profileId: profile.id, sourceType: "parent_note", capturedAt: "2026-08-22T21:03:00+08:00", importedAt: "2026-08-22T21:03:00+08:00", text: "雨下得很大，但他一直没有害怕，只是认真看着。", mediaIds: [], sourceLabel: "家庭备注", authorLabel: "妈妈", visibility: "family", status: "attached", relatedLifeEventId: "event-lake" },
  { id: "source-xiaoai-photo", profileId: profile.id, sourceType: "family_photo", capturedAt: "2026-08-20T20:11:00+08:00", importedAt: "2026-08-20T21:00:00+08:00", mediaIds: ["media-xiaoai"], sourceLabel: "妈妈的手机", authorLabel: "妈妈", visibility: "family", status: "attached", relatedLifeEventId: "event-xiaoai" },
  { id: "source-xiaoai-wechat", profileId: profile.id, sourceType: "wechat", capturedAt: "2026-08-20T21:26:00+08:00", importedAt: "2026-08-20T21:30:00+08:00", text: "今天喊小爱，他居然答了两声诶。", mediaIds: [], sourceLabel: "微信", authorLabel: "妈妈", visibility: "family", status: "attached", relatedLifeEventId: "event-xiaoai" },
  { id: "source-walk-photo", profileId: profile.id, sourceType: "family_photo", capturedAt: "2026-08-17T16:05:00+08:00", importedAt: "2026-08-17T20:00:00+08:00", mediaIds: ["media-walk"], sourceLabel: "妈妈的手机", authorLabel: "妈妈", visibility: "family", status: "attached", relatedLifeEventId: "event-walk" },
  { id: "source-walk-photo-note", profileId: profile.id, sourceType: "parent_note", capturedAt: "2026-08-17T20:15:00+08:00", importedAt: "2026-08-17T20:15:00+08:00", text: "走得稳一点以后，散步开始有了自己的方向。", mediaIds: [], sourceLabel: "家庭备注", authorLabel: "妈妈", visibility: "family", status: "attached", relatedLifeEventId: "event-walk" },
  { id: "source-pool-photo", profileId: profile.id, sourceType: "family_photo", capturedAt: "2026-08-10T15:30:00+08:00", importedAt: "2026-08-10T20:10:00+08:00", mediaIds: ["media-pool"], sourceLabel: "妈妈的手机", authorLabel: "妈妈", visibility: "family", status: "attached", relatedLifeEventId: "event-pool" },
  { id: "source-pool-video", profileId: profile.id, sourceType: "family_video", capturedAt: "2026-08-10T15:42:00+08:00", importedAt: "2026-08-10T20:10:00+08:00", mediaIds: ["media-pool-video"], sourceLabel: "爸爸的手机", authorLabel: "爸爸", visibility: "family", status: "attached", relatedLifeEventId: "event-pool" },
  { id: "source-bus-photo", profileId: profile.id, sourceType: "family_photo", capturedAt: "2026-08-08T19:15:00+08:00", importedAt: "2026-08-08T20:00:00+08:00", mediaIds: ["media-bus"], sourceLabel: "妈妈的手机", authorLabel: "妈妈", visibility: "family", status: "attached", relatedLifeEventId: "event-bus" },
  { id: "source-bus-note", profileId: profile.id, sourceType: "parent_note", capturedAt: "2026-08-08T20:10:00+08:00", importedAt: "2026-08-08T20:10:00+08:00", text: "现在听到公交车的歌，会先看我们有没有准备好看他的表演。", mediaIds: [], sourceLabel: "家庭备注", authorLabel: "妈妈", visibility: "family", status: "attached", relatedLifeEventId: "event-bus" },
  { id: "source-ball-photo", profileId: profile.id, sourceType: "family_photo", capturedAt: "2026-08-03T20:05:00+08:00", importedAt: "2026-08-03T21:00:00+08:00", mediaIds: ["media-ball"], sourceLabel: "妈妈的手机", authorLabel: "妈妈", visibility: "family", status: "attached", relatedLifeEventId: "event-ball" },
  { id: "source-ball-note", profileId: profile.id, sourceType: "parent_note", capturedAt: "2026-08-03T21:20:00+08:00", importedAt: "2026-08-03T21:20:00+08:00", text: "球滚远了，他会自己走过去捡回来。", mediaIds: [], sourceLabel: "家庭备注", authorLabel: "妈妈", visibility: "family", status: "attached", relatedLifeEventId: "event-ball" },
  { id: "source-book-photo", profileId: profile.id, sourceType: "family_photo", capturedAt: "2026-07-28T19:40:00+08:00", importedAt: "2026-07-28T21:00:00+08:00", mediaIds: ["media-book"], sourceLabel: "妈妈的手机", authorLabel: "妈妈", visibility: "family", status: "attached", relatedLifeEventId: "event-book" },
  { id: "source-book-note", profileId: profile.id, sourceType: "parent_note", capturedAt: "2026-07-28T21:10:00+08:00", importedAt: "2026-07-28T21:10:00+08:00", text: "他开始自己决定要翻哪一页了。", mediaIds: [], sourceLabel: "家庭备注", authorLabel: "妈妈", visibility: "family", status: "attached", relatedLifeEventId: "event-book" },
  { id: "source-hat-photo", profileId: profile.id, sourceType: "family_photo", capturedAt: "2026-07-21T18:25:00+08:00", importedAt: "2026-07-21T20:00:00+08:00", mediaIds: ["media-hat"], sourceLabel: "妈妈的手机", authorLabel: "妈妈", visibility: "family", status: "attached", relatedLifeEventId: "event-hat" },
  { id: "source-daycare-0819", profileId: profile.id, sourceType: "daycare_note", capturedAt: "2026-08-19T17:10:00+08:00", importedAt: "2026-08-19T20:00:00+08:00", text: "托班户外活动后，回家还在找球。", mediaIds: [], sourceLabel: "托班", authorLabel: "老师", visibility: "family", status: "attached" },
  { id: "source-home-0819", profileId: profile.id, sourceType: "parent_note", capturedAt: "2026-08-19T19:30:00+08:00", importedAt: "2026-08-19T19:30:00+08:00", text: "晚上自己吃完半碗饭。", mediaIds: [], sourceLabel: "家庭备注", authorLabel: "妈妈", visibility: "family", status: "attached" },
  { id: "source-home-0814", profileId: profile.id, sourceType: "parent_note", capturedAt: "2026-08-14T20:10:00+08:00", importedAt: "2026-08-14T20:10:00+08:00", text: "午睡醒来后自己把积木搬到窗边。", mediaIds: [], sourceLabel: "家庭备注", authorLabel: "爸爸", visibility: "family", status: "attached" },
];

export const events: LifeEvent[] = [
  { id: "event-lake", profileId: profile.id, title: "东钱湖暴雨看湖", story: "宁波东钱湖遇上暴雨，他在临湖餐厅和露台附近认真看湖面、雨水、蜻蜓和小鸟。想记住的，是他面对外部世界时那份好奇与专注。", storySections: ["雨声很大，家人都在说要不要先回去。他没有急着走，只是趴在栏杆附近，看雨水一阵一阵落到湖面。", "后来我们发现，所谓长大，常常不是学会了什么新动作，而是他开始有了自己的观看方式。"], occurredAt: "2026-08-22", locationLabel: "宁波 · 东钱湖", people: ["妈妈", "爷爷奶奶"], tags: ["好奇", "旅行", "自然"], mediaIds: ["media-lake", "media-lake-2", "media-lake-video"], sourceIds: ["source-lake-photos", "source-lake-video", "source-lake-wechat", "source-lake-note"], growthRecordIds: ["growth-social"], careRecordIds: [], eventType: "outing", memoryWeight: "feature", scopes: ["outing", "family", "growth"], heroMediaId: "media-lake", visibility: "family" },
  { id: "event-xiaoai", profileId: profile.id, title: "睡前“小爱——诶、诶”", story: "灯光渐暗，张年躺在床上咿咿呀呀。家长喊不同家人时，他一开始几乎都回答“baba”；听到“小爱”却停顿了一下，认真答：“诶、诶。”", storySections: ["那一声并不标准，也不是每次都会出现。但他听见了，想了一下，再把自己的回答送回来。"], occurredAt: "2026-08-20", locationLabel: "家里 · 睡前", people: ["妈妈"], tags: ["语言互动", "睡前", "回应"], mediaIds: ["media-xiaoai"], sourceIds: ["source-xiaoai-photo", "source-xiaoai-wechat"], growthRecordIds: ["growth-language-xiaoai"], careRecordIds: ["care-sleep"], eventType: "routine", memoryWeight: "memory", scopes: ["family", "growth"], heroMediaId: "media-xiaoai", visibility: "family" },
  { id: "event-walk", profileId: profile.id, title: "向前走的下午", story: "一段普通的散步，张年笑着往前走。现在的他，对脚下的路和身边的人都有自己的节奏。", storySections: ["我们没有给这段路安排目的地。走到哪里算哪里，他偶尔停下来，再自己决定下一步。"], occurredAt: "2026-08-17", locationLabel: "小区附近", people: ["家人"], tags: ["散步", "日常"], mediaIds: ["media-walk"], sourceIds: ["source-walk-photo", "source-walk-photo-note"], growthRecordIds: ["growth-motor-walk"], careRecordIds: [], eventType: "moment", memoryWeight: "memory", scopes: ["family", "growth"], heroMediaId: "media-walk", visibility: "family" },
  { id: "event-pool", profileId: profile.id, title: "池边一直跑到天快黑", story: "周末到泳池玩水，张年开心得不想停下来。即使不小心呛到一点水，也没哭，还是继续兴奋地玩。", storySections: ["他把每一次迈步都当作新的出发，跑回来，再跑出去。水边的下午很快过去了，留下的是一整段停不下来的身体记忆。"], occurredAt: "2026-08-10", locationLabel: "宁波 · 泳池", people: ["妈妈", "爸爸"], tags: ["夏日", "玩水", "运动"], mediaIds: ["media-pool", "media-pool-video"], sourceIds: ["source-pool-photo", "source-pool-video"], growthRecordIds: ["growth-motor"], careRecordIds: [], eventType: "outing", memoryWeight: "feature", scopes: ["outing", "family", "growth"], heroMediaId: "media-pool", visibility: "family" },
  { id: "event-bus", profileId: profile.id, title: "公交车表演家", story: "听到《The Wheels on the Bus》，他会开心地比划动作，特别喜欢右手握拳敲左手手腕的位置来“表演”。", storySections: ["现在他会先等我们看向他，再把整套动作做完。一个小小的家庭舞台，已经有了明确的观众和演员。"], occurredAt: "2026-08-08", locationLabel: "家里 · 客厅", people: ["家人"], tags: ["音乐", "模仿", "动作"], mediaIds: ["media-bus"], sourceIds: ["source-bus-photo", "source-bus-note"], growthRecordIds: [], careRecordIds: [], eventType: "moment", memoryWeight: "memory", scopes: ["family"], heroMediaId: "media-bus", visibility: "family" },
  { id: "event-ball", profileId: profile.id, title: "客厅足球夜", story: "和妈妈在客厅来回踢球，一个普通、却特别幸福的晚上。", storySections: ["球滚到沙发底下时，他没有叫人，弯下腰找了很久。找回来以后，游戏继续。"], occurredAt: "2026-08-03", locationLabel: "家里 · 客厅", people: ["妈妈"], tags: ["妈妈", "运动", "晚上"], mediaIds: ["media-ball"], sourceIds: ["source-ball-photo", "source-ball-note"], growthRecordIds: [], careRecordIds: [], eventType: "moment", memoryWeight: "memory", scopes: ["family"], heroMediaId: "media-ball", visibility: "family" },
  { id: "event-book", profileId: profile.id, title: "第一次主动翻绘本", story: "绘本被放到身边时，张年开始自己翻页，也愿意停下来听一会儿。", storySections: ["他不再只是等着下一页被翻开，而是伸手决定故事什么时候继续。"], occurredAt: "2026-07-28", locationLabel: "家里 · 沙发", people: ["妈妈"], tags: ["绘本", "语言", "专注"], mediaIds: ["media-book"], sourceIds: ["source-book-photo", "source-book-note"], growthRecordIds: [], careRecordIds: [], eventType: "milestone", memoryWeight: "feature", scopes: ["family", "growth"], heroMediaId: "media-book", visibility: "family" },
  { id: "event-hat", profileId: profile.id, title: "尿不湿小帽子", story: "换尿不湿时，他坚持把尿不湿戴到头上，笑得特别开心。", occurredAt: "2026-07-21", locationLabel: "家里", people: ["家人"], tags: ["快乐", "游戏"], mediaIds: ["media-hat"], sourceIds: ["source-hat-photo"], growthRecordIds: [], careRecordIds: [], eventType: "moment", memoryWeight: "daily_trace", scopes: ["family"], heroMediaId: "media-hat", visibility: "family" },
];

export const dailyTraces: DailyTrace[] = [
  { id: "trace-0819", profileId: profile.id, occurredAt: "2026-08-19", entries: ["托班户外活动 · 1 条老师记录", "晚上自己吃完半碗饭", "新增一个词：“车车”"], sourceIds: ["source-daycare-0819", "source-home-0819"], scopes: ["daycare", "family", "growth"], visibility: "family" },
  { id: "trace-0814", profileId: profile.id, occurredAt: "2026-08-14", entries: ["午睡醒来后自己搬积木", "在窗边看了很久的车"], sourceIds: ["source-home-0814"], scopes: ["family", "growth"], visibility: "family" },
];

export const candidateMemories: CandidateMemory[] = [
  { id: "candidate-ball-0828", profileId: profile.id, occurredAt: "2026-08-28", title: "追着球跑的下午", description: "同一天里，托班照片、老师的话和家里聊到的“球”落在了同一条线上。", sourceIds: ["source-inbox-daycare-photos", "source-inbox-daycare-note", "source-inbox-mom-wechat", "source-inbox-dad-wechat", "source-inbox-dad-video"], status: "suggested", visibility: "family" },
];

export const monthlySnapshot: MonthlySnapshot = { id: "snapshot-2026-08", profileId: profile.id, month: "2026-08", summary: "这个月，他开始把更多东西指给我们看，也开始用自己的声音把回应送回来。", highlights: ["开始说“车车”", "走路更稳", "主动翻绘本", "会追着球跑"], visibility: "family" };

export const monthArchives: MonthArchive[] = [{ id: "archive-month-2026-08", profileId: profile.id, month: "2026-08", label: "August", coverMediaId: "media-lake", summary: "他开始把更多东西指给我们看，也开始用自己的声音把回应送回来。", highlights: ["开始说“车车”", "走路更稳", "主动翻绘本", "会追着球跑"], momentCount: 23, photoCount: 186, videoCount: 12, visibility: "family" }];
export const yearArchive: YearArchive = { id: "archive-year-2026", profileId: profile.id, year: "2026", title: "正在长成的一年", intro: "这一年还没有结束。我们先把已经留下来的部分，放在这里。", monthIds: monthArchives.map((month) => month.id), visibility: "family" };

export const inboxSources = rawSources.filter((source) => source.status === "inbox");

export function getEvent(id: string) { return events.find((event) => event.id === id); }
export function getMediaForEvent(event: LifeEvent) { const ids = new Set(event.mediaIds); return media.filter((item) => ids.has(item.id)); }
export function getSourcesForEvent(event: LifeEvent) { const ids = new Set(event.sourceIds); return rawSources.filter((source) => ids.has(source.id)); }
export function getMediaForSource(source: RawSource) { const ids = new Set(source.mediaIds); return media.filter((item) => ids.has(item.id)); }
export function getGrowthForEvent(event: LifeEvent) { const ids = new Set(event.growthRecordIds); return growthRecords.filter((record) => ids.has(record.id)); }
export function getCareForEvent(event: LifeEvent) { const ids = new Set(event.careRecordIds); return careRecords.filter((record) => ids.has(record.id) && record.visibility !== "private"); }
