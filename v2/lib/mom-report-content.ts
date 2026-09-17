// 妈妈月报 — the curated, real text of 苏静's own monthly reports, one entry per month.
//
// This is NOT organizer output and NOT a growth_records/care_records read. It is a hand-transcribed
// copy of content that already existed, already reviewed, in this same repository: the 2026 年 8 月
// section of the root `index.html` (V1 — 苏静's monthly report, hand-built into the original site
// before V2 existed), refined once more in the 2026-09-16/17 design pass
// (docs/nianlife-zhangnian-design-2026-09-16.md) that this page implements. Every string below is
// traceable to one of those two places; nothing here was generated, summarised, or estimated for
// this page. The DB's own `monthly_snapshot`/`monthly_focus_goals` tables hold a DIFFERENT, later,
// AI-written summary of published life_events — that is not this, and this module must never be
// presented as if it were that (or the reverse).
//
// Adding a month later means adding another entry here — nothing about the pipeline changes, and
// nothing here should ever be produced by a script. A month with no real 苏静月报 text does not get
// an entry, and the page (lib/mom-report-view.ts) will say so rather than inventing one.
export type MomReportAspectKey = "personality" | "health" | "sleep" | "food" | "motor" | "language";

export type MomReportAspect = { key: MomReportAspectKey; label: string; lead: string; detail: string };

// `height`/`weight` are null exactly where the original report has no figure — never interpolated,
// never carried forward from a neighbouring month. `dayKnown` is false for every point today: the
// report only ever named a month ("2026 年 8 月"), never a measurement day.
export type MomReportMeasurementPoint = { month: string; height: number | null; weight: number | null; dayKnown: boolean };

export type MomReportSleepStage = { label: string; current?: boolean };

export type MomReportHealthDetail = { label: string; text: string };

export type MomReportHealthItem = {
  id: string;
  title: string;
  subtitle: string;
  status: string;
  tone: "watch" | "later" | "stable" | "good";
  details: MomReportHealthDetail[];
};

export type MomReportFocusItem = { title: string; note: string };

export type MomReportContent = {
  month: string; // "YYYY-MM"
  title: string;
  tagline: string;
  summaryLead: string;
  summaryEmphasis: string;
  summaryBody: string;
  // Order fixed by Teddy's brief: 性格、健康、睡眠、饮食、运动、语言.
  aspects: MomReportAspect[];
  measurements: MomReportMeasurementPoint[];
  sleep: {
    heading: string;
    caption: string;
    nightWaking: string;
    fallingAsleep: string;
    stages: MomReportSleepStage[];
    sourceNote: string;
  };
  health: { intro: string; sourceNote: string; items: MomReportHealthItem[] };
  nextMonth: MomReportFocusItem[];
  source: { author: string; curator: string; note: string; originLabel: string };
};

const AUGUST_2026: MomReportContent = {
  month: "2026-08",
  title: "八月的张年",
  tagline: "慢慢长大，也还是一样可爱。",
  summaryLead: "每天都有一点新的变化，",
  summaryEmphasis: "也还是一样可爱。",
  summaryBody:
    "8 月又长大了一点。夜间睡眠更稳定，开始进入自主入睡的新阶段；吃饭越来越喜欢自己来。这个月又经历了一轮流鼻涕和咳嗽，也开始偶尔叫“妈妈”、喜欢翻绘本了。每天都有一点新的变化，也还是一样可爱。",
  aspects: [
    { key: "personality", label: "性格", lead: "开朗好奇，爱笑爱互动", detail: "对周围的人和新鲜事越来越感兴趣。" },
    { key: "health", label: "健康", lead: "整体状态不错", detail: "入托后呼吸道感染较频繁，本月第二轮流涕。" },
    { key: "sleep", label: "睡眠", lead: "夜间睡眠已明显稳定", detail: "正在从抱睡进入自主入睡阶段。" },
    { key: "food", label: "饮食", lead: "开始更多自主进食", detail: "愿意自己动手，也越来越有自己的选择。" },
    { key: "motor", label: "运动", lead: "大运动发展不错", detail: "喜欢走、跑、玩水，活动意愿很强。" },
    { key: "language", label: "语言", lead: "表达正在慢慢增加", detail: "偶尔会叫“妈妈”，开始喜欢一起看绘本。" },
  ],
  // 2025.11 → 2026.08，与 design.js 内嵌的原型图表数值、根目录 index.html 生长曲线一致：
  // 身高 73.2 / 未记录 / 82.0 / 85.0 / 86.0 cm；体重 10.2 / 11.45 / 11.48 / 11.2 / 12.1 kg。
  measurements: [
    { month: "2025-11", height: 73.2, weight: 10.2, dayKnown: false },
    { month: "2026-02", height: null, weight: 11.45, dayKnown: false },
    { month: "2026-03", height: 82.0, weight: 11.48, dayKnown: false },
    { month: "2026-05", height: 85.0, weight: 11.2, dayKnown: false },
    { month: "2026-08", height: 86.0, weight: 12.1, dayKnown: false },
  ],
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
        title: "呼吸道症状",
        subtitle: "本月再次流涕，伴有咳嗽",
        status: "当时观察中",
        tone: "watch",
        details: [
          { label: "最近", text: "2026.08.19 起再次流鼻涕，后续出现较浓绿色鼻涕和咳嗽；暂无发热报告。周末晨起更明显、下午减轻，08/23–08/24 夜间睡眠受到影响。" },
          { label: "历史", text: "2026.07 一轮呼吸道感染，已恢复；2026.04–06 入托后感染次数增加；曾有鼻窦炎持续约一个月；1 岁以内曾有一次高热急诊史。" },
          { label: "当时", text: "继续观察本轮症状是否逐步改善。本次只记录症状 episode，不作确定诊断。" },
        ],
      },
      {
        id: "toenail",
        title: "双侧大脚趾甲沟／边缘",
        subtitle: "持续较久，长期观察项",
        status: "长期观察",
        tone: "later",
        details: [
          { label: "最近", text: "持续半年以上甚至更久；无明显疼痛，触碰不明显敏感，与鞋子挤压关系不明确，暂无明显急性感染表现。" },
          { label: "历史", text: "剪甲一直谨慎，没有刻意剪两侧角；穿凉拖期间仍然存在。" },
          { label: "当时", text: "下次儿童保健时现场评估。" },
        ],
      },
      {
        id: "daily-care",
        title: "刷牙与日常护理",
        subtitle: "对刷牙配合度一般；疤痕护理中",
        status: "习惯建立",
        tone: "watch",
        details: [
          { label: "牙齿／刷牙", text: "目前对刷牙配合度一般，有效清洁仍需巩固。保持固定流程，先保证每天至少一次真正刷到牙面。" },
          { label: "烫伤疤痕", text: "肋骨和膝盖处留有疤痕，当时继续使用硅酮凝胶做日常护理。" },
        ],
      },
      {
        id: "other-notes",
        title: "另外几件小事",
        subtitle: "屏幕使用、发量与已处理的历史",
        status: "留在记录里",
        tone: "stable",
        details: [
          { label: "屏幕使用", text: "近期较喜欢电视和手机，当时以记录频率与时长为主，再根据家庭节奏决定是否调整。" },
          { label: "头发", text: "发量相对偏少，发际线略呈 M 形；月报计划保留月度对比照片、两岁时复盘。" },
          { label: "新生儿黄疸", text: "出生后出现，照蓝光 1 天，复查正常；原月报标为已稳定、仅保留历史。" },
        ],
      },
    ],
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
    originLabel: "2026 年 8 月月报",
  },
};

// Keyed by "YYYY-MM". Only months with a real, reviewed 苏静月报 belong here — see the file header.
export const MOM_REPORTS: Record<string, MomReportContent> = {
  [AUGUST_2026.month]: AUGUST_2026,
};

export function listMomReportMonths(): string[] {
  return Object.keys(MOM_REPORTS).sort();
}
