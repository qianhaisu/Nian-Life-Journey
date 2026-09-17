// 妈妈月报 — the curated, real text of 苏静's own monthly reports, one entry per month.
//
// This is NOT organizer output and NOT a growth_records/care_records read. It is a hand-transcribed
// copy of content that already existed, already reviewed, in this same repository: the 2026 年 8 月
// section of the root `index.html` (V1.3 — 苏静's monthly report, hand-built into the original site
// before V2 existed). Every string below is traceable to that page (cross-checked against the
// original V1.3 zip Teddy supplied on 2026-09-17); nothing here was generated, summarised, or
// estimated for this page. The DB's own `monthly_snapshot`/`monthly_focus_goals` tables hold a
// DIFFERENT, later, AI-written summary of published life_events — that is not this, and this module
// must never be presented as if it were that (or the reverse).
//
// 2026-09-17 revision: 苏静 asked for full V1.3 fidelity — every section V1.3 had, including 闪光
// 时刻 and the Outside Food Guide (both previously cut from the redesign brief). Colour/typography
// may be tuned to fit the site; content and section structure may not. See
// docs/mom-reports-implementation-handoff.md for the full history of that decision.
//
// Adding a month later means adding another entry here — nothing about the pipeline changes, and
// nothing here should ever be produced by a script. A month with no real 苏静月报 text does not get
// an entry, and the page (lib/mom-report-view.ts) will say so rather than inventing one.
export type MomReportAspectKey = "personality" | "health" | "sleep" | "food" | "motor" | "language";
export type MomReportTone = "yellow" | "green" | "blue" | "coral" | "purple";

export type MomReportAspect = { key: MomReportAspectKey; label: string; icon: string; tone: MomReportTone; lead: string; detail: string };

export type MomReportTag = { label: string; tone: MomReportTone };

// `height`/`weight` are null exactly where the original report has no figure — never interpolated,
// never carried forward from a neighbouring month. `dayKnown` is false for every point today: the
// report only ever named a month ("2026 年 8 月"), never a measurement day.
export type MomReportMeasurementPoint = { month: string; height: number | null; weight: number | null; dayKnown: boolean };

export type MomReportSleepStage = { label: string; current?: boolean };

export type MomReportHealthDetail = { label: string; text: string };

// One card per item, matching V1.3's flat list (no grouping/folding — every item's detail is
// always visible, exactly as 苏静's page showed it). `settled` mirrors V1.3's `.stable` class: a
// quieter visual treatment for items that are not actively being watched, never a claim that the
// matter is resolved (a jaundice history and an active symptom both keep their own real status).
export type MomReportHealthItem = {
  id: string;
  icon: string;
  tone: MomReportTone;
  title: string;
  status: string;
  statusTone: "watch" | "later" | "good";
  settled?: boolean;
  details: MomReportHealthDetail[];
};

export type MomReportFocusItem = { title: string; note: string };

// 闪光时刻 (Joy & Love Moments). All six are illustrated cards — V1.3's own label says so ("正式插画
// 版"), and every one of these six `<img>` tags in the source HTML carries an alt text ending in
// "插画" (illustration), including the two that happen to be PNG rather than the other four's
// embedded WebP. (An earlier draft of this file wrongly assumed the two PNGs were real photos on
// file-format alone, without checking their own alt text against the same HTML already quoted
// above — caught during 2026-09-17 review and corrected. Only the hero photo and the four Outside
// Food Guide photos are real camera photos in this report; nothing here claims otherwise.)
export type MomReportMoment = {
  id: string;
  image: string;
  width: number;
  height: number;
  alt: string;
  title: string;
  note: string;
  tag: string;
  tone: MomReportTone;
};

export type MomReportFoodScene = { id: string; image: string; width: number; height: number; alt: string; title: string; items: string; tip: string };

export type MomReportFoodGuide = {
  heading: string;
  entryNote: string;
  principle: string;
  scenes: MomReportFoodScene[];
  fallbackQuestion: string;
  fallbackAnswer: string;
};

export type MomReportContent = {
  month: string; // "YYYY-MM"
  // V1.3's actual hero heading is the child's name, not an editorial title per month — "张小年",
  // verbatim (index.html <h2>). `release` is V1.3's own badge text; `heroBadge` is the caption V1.3
  // overlaid on the hero photo itself.
  title: string;
  release: string;
  heroBadge: string;
  heroImage: { src: string; width: number; height: number; alt: string };
  heroStats: { heightLabel: string; weightLabel: string; ageLabel: string };
  summaryLead: string;
  summaryEmphasis: string;
  summaryBody: string;
  tags: MomReportTag[];
  // Order fixed by Teddy's brief: 性格、健康、睡眠、饮食、运动、语言.
  aspects: MomReportAspect[];
  measurements: MomReportMeasurementPoint[];
  chartNote: string;
  sleep: {
    heading: string;
    caption: string;
    nightWaking: string;
    fallingAsleep: string;
    stages: MomReportSleepStage[];
    sourceNote: string;
  };
  health: { intro: string; sourceNote: string; items: MomReportHealthItem[] };
  moments: { intro: string; items: MomReportMoment[] };
  foodGuide: MomReportFoodGuide;
  nextMonth: MomReportFocusItem[];
  source: { author: string; curator: string; note: string; originLabel: string };
};

const IMG = "/mom-reports/2026-08";

const AUGUST_2026: MomReportContent = {
  month: "2026-08",
  title: "张小年",
  release: "2026.08 · V1.3",
  heroBadge: "✨ 最近的张小年",
  heroImage: { src: `${IMG}/hero.jpg`, width: 958, height: 1704, alt: "张小年笑着向前走的近期照片" },
  heroStats: { heightLabel: "86 cm", weightLabel: "12.1 kg", ageLabel: "1 岁 7 个月" },
  summaryLead: "每天都有一点新的变化，",
  summaryEmphasis: "也还是一样可爱。",
  summaryBody:
    "8 月又长大了一点。夜间睡眠更稳定，开始进入自主入睡的新阶段；吃饭越来越喜欢自己来。这个月又经历了一轮流鼻涕和咳嗽，也开始偶尔叫“妈妈”、喜欢翻绘本了。每天都有一点新的变化，也还是一样可爱。",
  tags: [
    { label: "自主入睡过渡", tone: "purple" },
    { label: "自主进食", tone: "green" },
    { label: "偶尔叫妈妈", tone: "coral" },
    { label: "爱上绘本", tone: "yellow" },
  ],
  aspects: [
    { key: "personality", label: "性格", icon: "☀️", tone: "yellow", lead: "开朗好奇，爱笑爱互动", detail: "对周围的人和新鲜事越来越感兴趣。" },
    { key: "health", label: "健康", icon: "✚", tone: "green", lead: "整体状态不错", detail: "入托后呼吸道感染较频繁，本月第二轮流涕。" },
    { key: "sleep", label: "睡眠", icon: "☾", tone: "blue", lead: "夜间睡眠已明显稳定", detail: "正在从抱睡进入自主入睡阶段。" },
    { key: "food", label: "饮食", icon: "🥣", tone: "coral", lead: "开始更多自主进食", detail: "愿意自己动手，也越来越有自己的选择。" },
    { key: "motor", label: "运动", icon: "⚽", tone: "purple", lead: "大运动发展不错", detail: "喜欢走、跑、玩水，活动意愿很强。" },
    { key: "language", label: "语言", icon: "💬", tone: "green", lead: "表达正在慢慢增加", detail: "偶尔会叫“妈妈”，开始喜欢一起看绘本。" },
  ],
  // 2025.11 → 2026.08，与根目录 index.html（V1.3）生长曲线一致：
  // 身高 73.2 / 未记录 / 82.0 / 85.0 / 86.0 cm；体重 10.2 / 11.45 / 11.48 / 11.2 / 12.1 kg。
  measurements: [
    { month: "2025-11", height: 73.2, weight: 10.2, dayKnown: false },
    { month: "2026-02", height: null, weight: 11.45, dayKnown: false },
    { month: "2026-03", height: 82.0, weight: 11.48, dayKnown: false },
    { month: "2026-05", height: 85.0, weight: 11.2, dayKnown: false },
    { month: "2026-08", height: 86.0, weight: 12.1, dayKnown: false },
  ],
  chartNote: "8 月更新：2026 年 8 月身高 86 cm、体重 12.1 kg；历史测量数据全部保留，继续按同一条成长曲线观察。",
  sleep: {
    heading: "从“夜里醒”，到“自己睡着”",
    caption: "夜间睡眠已经稳定，那时的关注从“夜醒”转向“如何自己睡着”。",
    nightWaking: "基本稳定",
    fallingAsleep: "约 1–2 小时",
    stages: [
      { label: "频繁夜醒" },
      { label: "夜醒减少" },
      { label: "夜间稳定" },
      { label: "抱睡退出" },
      { label: "自主入睡过渡", current: true },
    ],
    sourceNote: "按原月报呈现阶段顺序；各阶段未提供具体起止日期。8 月月报记载走到“自主入睡过渡”，不代表现在的阶段。",
  },
  health: {
    intro: "有些事需要多留意，有些事留作以后的参照。",
    sourceNote: "以下均为 8 月月报记载的历史状态，不代表现在的情况。",
    items: [
      {
        id: "respiratory",
        icon: "🌧️",
        tone: "blue",
        title: "呼吸道／感冒发烧",
        status: "观察中",
        statusTone: "watch",
        details: [
          { label: "最近", text: "2026.08.19 起再次流鼻涕，后续出现较浓绿色鼻涕和咳嗽；暂无发热报告。周末晨起更明显、下午减轻，08/23–08/24 夜间睡眠受到影响。" },
          { label: "历史", text: "2026.07 一轮呼吸道感染，已恢复；2026.04–06 入托后感染次数增加；曾有鼻窦炎持续约一个月；1 岁以内曾有一次高热急诊史。" },
          { label: "当前", text: "继续观察本轮症状是否逐步改善。本次只记录症状 episode，不作确定诊断。" },
        ],
      },
      {
        id: "toenail",
        icon: "🦶",
        tone: "yellow",
        title: "双侧大脚趾甲沟／边缘",
        status: "长期观察",
        statusTone: "later",
        details: [
          { label: "最近", text: "持续半年以上甚至更久；无明显疼痛，触碰不明显敏感，与鞋子挤压关系不明确，暂无明显急性感染表现。" },
          { label: "历史", text: "剪甲一直谨慎，没有刻意剪两侧角；穿凉拖期间仍然存在。" },
          { label: "当前", text: "下次儿童保健时现场评估。" },
        ],
      },
      {
        id: "teeth",
        icon: "🦷",
        tone: "purple",
        title: "牙齿／刷牙",
        status: "习惯建立",
        statusTone: "watch",
        settled: true,
        details: [
          { label: "状态", text: "目前对刷牙配合度一般，有效清洁仍需巩固。" },
          { label: "当前", text: "保持固定流程，先保证每天至少一次真正刷到牙面。" },
        ],
      },
      {
        id: "scar",
        icon: "🩹",
        tone: "coral",
        title: "烫伤疤痕",
        status: "护理中",
        statusTone: "watch",
        settled: true,
        details: [
          { label: "状态", text: "肋骨和膝盖处留有疤痕。" },
          { label: "当前", text: "继续使用硅酮凝胶做日常护理。" },
        ],
      },
      {
        id: "screen-time",
        icon: "📱",
        tone: "blue",
        title: "屏幕使用",
        status: "记录中",
        statusTone: "later",
        settled: true,
        details: [
          { label: "状态", text: "近期较喜欢电视和手机。" },
          { label: "当前", text: "先记录频率与时长，再根据家庭节奏决定是否调整。" },
        ],
      },
      {
        id: "hair",
        icon: "🧑‍🦲",
        tone: "yellow",
        title: "头发偏少",
        status: "两岁复盘",
        statusTone: "later",
        settled: true,
        details: [
          { label: "状态", text: "发量相对偏少，发际线略呈 M 形。" },
          { label: "当前", text: "保留月度对比照片，计划两岁时复盘。" },
        ],
      },
      {
        id: "jaundice",
        icon: "👶",
        tone: "yellow",
        title: "新生儿黄疸",
        status: "历史 · 已处理",
        statusTone: "good",
        settled: true,
        details: [
          { label: "历史", text: "出生后出现，照蓝光 1 天，复查正常。" },
          { label: "当前", text: "已稳定，仅作为历史记录保留。" },
        ],
      },
    ],
  },
  // 苏静 2026-09-17：闪光时刻按 V1.3 原样保留，六条全部是插画（原文标注 "Joy & Love Moments ·
  // 正式插画版"，六个 <img> 的 alt 全部以"插画"结尾）——这是苏静自己在原月报里的呈现方式。
  moments: {
    intro: "把一些说不清具体日期、但很想记住的瞬间留在这里。",
    items: [
      {
        id: "xiaoai",
        image: `${IMG}/moment-xiaoai.png`,
        width: 1064,
        height: 1398,
        alt: "睡前小年回应小爱同学的插画",
        title: "睡前“小爱——诶、诶”",
        note: "灯光渐暗，小年躺在床上咿咿呀呀。家长喊不同家人时，他一开始几乎都回答“baba”；听到“小爱”却停顿了一下，认真答：“诶、诶。”",
        tag: "语言互动 · 2026.08",
        tone: "purple",
      },
      {
        id: "dongqian-lake",
        image: `${IMG}/moment-dongqian-lake.png`,
        width: 1056,
        height: 1408,
        alt: "小年认真看东钱湖暴雨湖面的插画",
        title: "东钱湖暴雨看湖",
        note: "宁波东钱湖遇上暴雨，他在临湖餐厅／露台附近认真看湖面、雨水、蜻蜓和小鸟。想记住的，是他面对外部世界时那份好奇与专注。",
        tag: "好奇与专注 · 2026.08",
        tone: "blue",
      },
      {
        id: "pool",
        image: `${IMG}/moment-pool.webp`,
        width: 640,
        height: 853,
        alt: "快乐池畔嬉戏时光插画",
        title: "快乐池畔嬉戏时光",
        note: "周末到泳池玩水，小年开心得不想停下来。即使不小心呛到一点水，也没哭，还是继续兴奋地玩。",
        tag: "夏日快乐",
        tone: "yellow",
      },
      {
        id: "bus",
        image: `${IMG}/moment-bus.webp`,
        width: 640,
        height: 853,
        alt: "公交车表演家插画",
        title: "公交车表演家",
        note: "听到《The Wheels on the Bus》，他会开心地比划动作，特别喜欢右手握拳敲左手手腕的位置来“表演”。",
        tag: "音乐时刻",
        tone: "blue",
      },
      {
        id: "football",
        image: `${IMG}/moment-football.webp`,
        width: 640,
        height: 853,
        alt: "客厅足球夜插画",
        title: "客厅足球夜",
        note: "和妈妈在客厅来回踢球，一个普通、却特别幸福的晚上。",
        tag: "妈妈记忆",
        tone: "coral",
      },
      {
        id: "diaper-hat",
        image: `${IMG}/moment-diaper-hat.webp`,
        width: 640,
        height: 853,
        alt: "尿不湿小帽子插画",
        title: "尿不湿小帽子",
        note: "换尿不湿时，他坚持把尿不湿戴到头上，笑得特别开心。",
        tag: "快乐",
        tone: "yellow",
      },
    ],
  },
  foodGuide: {
    heading: "给爷爷奶奶的外出小抄",
    entryNote: "便利店、面包店、餐厅、面馆直接照着选。",
    principle: "不知道买什么：原味 · 软一点 · 少馅料",
    scenes: [
      { id: "convenience-store", image: `${IMG}/food-convenience-store.jpg`, width: 720, height: 478, alt: "便利店可选的香蕉、白煮蛋、原味玉米和纯牛奶", title: "便利店", items: "香蕉 · 白煮蛋 · 玉米 · 纯牛奶", tip: "拿 2–3 样就行" },
      { id: "bakery", image: `${IMG}/food-bakery.jpg`, width: 720, height: 478, alt: "面包店可选的原味吐司、小餐包、纯牛奶和香蕉", title: "面包店", items: "原味吐司 · 小餐包 · 牛奶 · 香蕉", tip: "撕小块，少夹心" },
      { id: "restaurant", image: `${IMG}/food-restaurant.jpg`, width: 720, height: 478, alt: "餐馆可选的米饭、蒸蛋和软青菜", title: "餐馆", items: "米饭 · 蒸蛋 · 软青菜", tip: "宝宝吃，少盐" },
      { id: "noodles", image: `${IMG}/food-noodles.jpg`, width: 720, height: 478, alt: "面馆可选的清汤面和鸡蛋", title: "面馆", items: "清汤面 · 鸡蛋", tip: "剪短 · 不辣 · 少喝汤" },
    ],
    fallbackQuestion: "实在不知道怎么选？",
    fallbackAnswer: "饭 + 蛋 + 软蔬菜。",
  },
  nextMonth: [
    { title: "自主入睡", note: "观察入睡耗时是否逐渐缩短。" },
    { title: "语言发展", note: "继续记录新的主动表达，尤其是“妈妈”等清晰称呼。" },
    { title: "绘本兴趣", note: "观察是否逐渐形成主动翻书、听读和互动兴趣。" },
    { title: "健康与儿保", note: "观察本轮呼吸道症状恢复；下次儿保现场看看长期大脚趾甲沟情况。" },
  ],
  source: {
    author: "苏静",
    curator: "Nianlife",
    note: "这份月报最早写于 2026 年 8 月，是这个小小网站最初的样子——记录留住当时，日子继续向前。",
    originLabel: "2026 年 8 月月报 · V1.3",
  },
};

// Keyed by "YYYY-MM". Only months with a real, reviewed 苏静月报 belong here — see the file header.
export const MOM_REPORTS: Record<string, MomReportContent> = {
  [AUGUST_2026.month]: AUGUST_2026,
};

export function listMomReportMonths(): string[] {
  return Object.keys(MOM_REPORTS).sort();
}
