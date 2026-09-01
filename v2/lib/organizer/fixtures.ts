// 24 synthetic fixtures (§11). No real family data — the subject is "合成儿童 A" (synthetic child
// A), matching the task's convention. Each fixture builds a real EvidenceWindow through the same
// deterministic Evidence Builder the pipeline uses, then states what the pipeline must produce.
import { buildEvidenceWindows } from "./evidence/window";
import type { EvidenceWindow, WindowSource } from "./evidence/types";
import type { OrganizerOutcome } from "./contract";
import type { ValidatorContext } from "./validator";

export const SUBJECT = { primaryName: "合成儿童A", aliases: ["小A", "他"] };
export const OTHER_CHILD_NAME = "合成儿童B";
export const NOW = "2026-08-31T12:00:00.000Z";

let sourceOrdinal = 0;
function src(overrides: Partial<WindowSource> & { text?: string; capturedAt: string; contributorRole: string }): WindowSource {
  sourceOrdinal += 1;
  return {
    id: overrides.id ?? `fixture-source-${sourceOrdinal}`,
    profileId: "fixture-profile",
    sourceType: overrides.sourceType ?? "wechat",
    contentTypes: overrides.contentTypes ?? ["daily", "family"],
    contributorId: overrides.contributorId ?? `contributor-${overrides.contributorRole}`,
    capturedAt: overrides.capturedAt,
    text: overrides.text ?? "",
    mediaIds: overrides.mediaIds ?? [],
    visibility: overrides.visibility ?? "private",
    metadata: overrides.metadata ?? {},
    sourceLabel: overrides.sourceLabel ?? "fixture-conversation",
    contributorRole: overrides.contributorRole,
  };
}

function windowFrom(conversationId: string, sources: WindowSource[], priorContext: EvidenceWindow["priorContext"] = { dailyTraces: [], lifeEvents: [] }): EvidenceWindow {
  const windows = buildEvidenceWindows(conversationId, "fixture-profile", sources, priorContext);
  if (windows.length !== 1) throw new Error(`fixture expected exactly one window, got ${windows.length}`);
  return windows[0];
}

export type OrganizerFixture = {
  id: string;
  description: string;
  window: EvidenceWindow;
  context: Omit<ValidatorContext, "now" | "modelVersion">;
  expectedAction: OrganizerOutcome["action"] | OrganizerOutcome["action"][];
  expectedReview?: "auto_accept" | "needs_review" | "n/a";
  forbiddenPhrases?: RegExp[];
  isNegative?: boolean;
};

const baseContext = { existingLifeEvents: [], recentSameTypeCount: 0 };

export const ORGANIZER_FIXTURES: OrganizerFixture[] = [
  { id: "F01-explicit-first-time-needs-review", description: "老师明确记录第一次爬滑梯，milestone 必须人工确认", expectedAction: "life_event_candidate", expectedReview: "needs_review", context: baseContext, window: windowFrom("conv-milestone", [src({ contributorRole: "teacher", capturedAt: "2026-08-20T15:42:00+08:00", text: "今天他第一次自己爬上了滑梯，来回爬了三次" })]) },
  { id: "F02-hedged-first-time", description: "疑似第一次但只是猜测，不能升级为事实", expectedAction: ["daily_trace", "store_only"], context: baseContext, isNegative: true, forbiddenPhrases: [/^第一次/], window: windowFrom("conv-hedge", [src({ contributorRole: "mother", capturedAt: "2026-08-21T20:11:00+08:00", text: "他今天好像是第一次这么说话吧" })]) },
  { id: "F03-plan-not-occurred", description: "只有计划，没有发生的证据", expectedAction: "plan_marker", context: baseContext, isNegative: true, window: windowFrom("conv-plan", [src({ contributorRole: "father", capturedAt: "2026-09-01T21:30:00+08:00", text: "明天带他去游泳" })]) },
  { id: "F04-plan-confirmed", description: "后续证据证实计划已发生", expectedAction: ["life_event_candidate", "daily_trace"], context: baseContext, window: windowFrom("conv-plan-confirmed", [src({ contributorRole: "mother", capturedAt: "2026-08-22T16:20:00+08:00", text: "今天他一直不肯下水，最后坐在台阶上玩了半小时" })]) },
  { id: "F05-ordinary-meal", description: "普通吃饭记录", expectedAction: "daily_trace", context: baseContext, window: windowFrom("conv-meal", [src({ contributorRole: "mother", capturedAt: "2026-08-23T12:40:00+08:00", text: "中午吃了一碗面" })]) },
  { id: "F06-meal-change", description: "吃饭方式出现明显变化", expectedAction: ["daily_trace", "life_event_candidate", "store_only"], context: baseContext, window: windowFrom("conv-meal-change", [src({ contributorRole: "mother", capturedAt: "2026-08-24T12:35:00+08:00", text: "今天他自己拿勺子吃完了整碗，以前都要喂" })]) },
  { id: "F07-teacher-small-moment", description: "老师记录一个具体小动作，不做性格结论", expectedAction: ["daily_trace", "life_event_candidate"], context: baseContext, window: windowFrom("conv-shoes", [src({ contributorRole: "teacher", capturedAt: "2026-08-25T13:10:00+08:00", text: "今天午睡前他把自己的鞋子摆成一排才肯躺下" })]) },
  { id: "F08-funny-quote", description: "有趣但不重要的一句童言", expectedAction: ["daily_trace", "life_event_candidate"], context: baseContext, window: windowFrom("conv-moon", [src({ contributorRole: "mother", capturedAt: "2026-08-26T19:00:00+08:00", text: "他今天说\"月亮跟着我回家\"" })]) },
  { id: "F09-repeated-nap", description: "重复十天的午睡记录，不应制造多条 LifeEvent", expectedAction: ["daily_trace", "store_only"], context: { existingLifeEvents: [], recentSameTypeCount: 9 }, isNegative: true, window: windowFrom("conv-nap", [src({ contributorRole: "mother", capturedAt: "2026-08-27T13:00:00+08:00", contentTypes: ["sleep", "daily"], text: "今天午睡2小时" })]) },
  { id: "F10-symptom-report", description: "家长记录生病症状", expectedAction: "care_observation", expectedReview: "needs_review", context: baseContext, window: windowFrom("conv-symptom", [src({ contributorRole: "mother", capturedAt: "2026-08-28T09:00:00+08:00", contentTypes: ["health"], text: "他从昨晚开始咳嗽，有点低烧37.8" })]) },
  { id: "F11-reported-doctor", description: "家长转述医生判断，必须保留归因、不能确诊", expectedAction: "care_observation", expectedReview: "needs_review", context: baseContext, window: windowFrom("conv-doctor", [src({ contributorRole: "mother", capturedAt: "2026-08-28T18:44:00+08:00", contentTypes: ["health"], text: "医生说可能是支气管炎，先观察" })]) },
  { id: "F12-hospital-report-consistent", description: "医院报告与聊天一致", expectedAction: "care_observation", expectedReview: "needs_review", context: baseContext, window: windowFrom("conv-report-ok", [src({ contributorRole: "hospital", sourceType: "medical_document", capturedAt: "2026-08-29T10:00:00+08:00", contentTypes: ["health"], text: "体检报告：体温正常，无异常" })]) },
  { id: "F13-hospital-report-conflict", description: "医院报告与聊天冲突，必须保留双方并要求 review", expectedAction: "care_observation", expectedReview: "needs_review", context: baseContext, window: windowFrom("conv-report-conflict", [src({ contributorRole: "hospital", sourceType: "medical_document", capturedAt: "2026-08-29T10:05:00+08:00", contentTypes: ["health"], text: "体检报告：体温正常" }), src({ contributorRole: "mother", capturedAt: "2026-08-29T10:06:00+08:00", contentTypes: ["health"], text: "在家量体温烧到38.5" })]) },
  { id: "F14-photo-only-no-text", description: "只有图片，没有可支撑文字", expectedAction: "store_only", context: baseContext, isNegative: true, window: windowFrom("conv-photo-only", [src({ contributorRole: "mother", capturedAt: "2026-08-30T17:03:00+08:00", mediaIds: ["media-1", "media-2"] })]) },
  { id: "F15-weak-media-binding", description: "图片与前后消息存在歧义，弱绑定不能支撑事实", expectedAction: ["daily_trace", "store_only"], context: baseContext, isNegative: true, window: windowFrom("conv-weak-bind", [src({ contributorRole: "mother", capturedAt: "2026-08-30T16:02:00+08:00", mediaIds: ["media-3"] }), src({ contributorRole: "grandmother", capturedAt: "2026-08-30T16:10:00+08:00", text: "他今天在公园玩得很开心" })]) },
  { id: "F16-same-photo-two-providers", description: "同一照片来自微信和 Quark（同一 asset 身份）", expectedAction: ["daily_trace", "life_event_candidate", "store_only"], context: baseContext, window: windowFrom("conv-shared-photo", [src({ contributorRole: "mother", capturedAt: "2026-08-19T10:00:00+08:00", mediaIds: ["media-asset:shared-sha256-abc"], text: "公园里拍的照片" })]) },
  { id: "F17-cross-conversation-duplicate", description: "同一事件在多个群重复讨论", expectedAction: ["daily_trace", "life_event_candidate", "store_only"], context: baseContext, window: windowFrom("conv-family-ball", [src({ contributorRole: "teacher", capturedAt: "2026-08-18T15:00:00+08:00", contentTypes: ["daycare", "motor"], text: "追球活动一起玩了很久" })]) },
  { id: "F18-cross-midnight", description: "跨午夜连续对话必须归到同一个活动日", expectedAction: ["daily_trace", "life_event_candidate", "store_only"], context: baseContext, window: windowFrom("conv-midnight", [src({ contributorRole: "mother", capturedAt: "2026-08-17T23:40:00+08:00", text: "还没睡" }), src({ contributorRole: "mother", capturedAt: "2026-08-18T00:10:00+08:00", text: "他说想再玩一会积木" })]) },
  { id: "F19-multi-subject-chat", description: "多主体聊天，另一个孩子的行为不能算到目标儿童头上", expectedAction: "store_only", context: { existingLifeEvents: [], recentSameTypeCount: 0, otherChildDigests: [] }, isNegative: true, window: windowFrom("conv-multi-child", [src({ contributorRole: "teacher", capturedAt: "2026-08-16T14:00:00+08:00", text: `${OTHER_CHILD_NAME}今天主动分享了玩具` })]) },
  { id: "F20-ambiguous-pronoun", description: "代词指代不明，不能默认是目标儿童", expectedAction: "store_only", context: baseContext, isNegative: true, window: windowFrom("conv-ambiguous", [src({ contributorRole: "father", capturedAt: "2026-08-15T19:00:00+08:00", text: "" })]) },
  { id: "F21-parent-emotion", description: "家长情绪化表达不能变成儿童的事实", expectedAction: ["store_only", "daily_trace"], context: baseContext, isNegative: true, forbiddenPhrases: [/生气|淘气/], window: windowFrom("conv-emotion", [src({ contributorRole: "mother", capturedAt: "2026-08-14T20:00:00+08:00", text: "今天真的要被他气死了" })]) },
  { id: "F22-sarcasm", description: "玩笑和反讽不能字面理解为事实", expectedAction: ["store_only", "daily_trace"], context: baseContext, isNegative: true, window: windowFrom("conv-sarcasm", [src({ contributorRole: "father", capturedAt: "2026-08-13T18:00:00+08:00", text: "他这是要上天了哈哈哈" })]) },
  { id: "F23-ordinary-not-cliche", description: "普通下楼活动，模型容易写成鸡汤但不应该", expectedAction: "daily_trace", context: baseContext, isNegative: true, forbiddenPhrases: [/温暖瞬间|美好时光|满满的爱/], window: windowFrom("conv-downstairs", [src({ contributorRole: "mother", capturedAt: "2026-08-12T16:00:00+08:00", text: "今天天气不错，带他下楼转了转" })]) },
  { id: "F24-warm-daily-glimmer", description: "有具体动作和原话，真正适合保留的日常微光", expectedAction: ["life_event_candidate", "daily_trace"], context: baseContext, window: windowFrom("conv-share-cookie", [src({ contributorRole: "teacher", capturedAt: "2026-08-11T15:20:00+08:00", text: "今天他把自己的饼干掰了一半递给旁边的小朋友，说\"给你\"" })]) },
];

export const NEGATIVE_FIXTURE_IDS = ORGANIZER_FIXTURES.filter((fixture) => fixture.isNegative).map((fixture) => fixture.id);
