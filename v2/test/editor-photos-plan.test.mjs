import test from "node:test";
import assert from "node:assert/strict";
import { decidePhoto, decidePregnancyPhoto, pickPhotos, mergeDayMedia, batchLooksBroken, spread } from "../scripts/editor/photos-plan.mjs";

const life = { kind: "life", child_present: true, reference_child: "yes", face_visible: true, children_count: 1, main_child_size: "large", other_children_identifiable: false, sensitive: "none" };

test("清楚的张年单人照放行", () => assert.equal(decidePhoto(life).decision, "approved"));
test("班级合影（别的孩子入镜）在认出张年时放行", () => {
  const d = decidePhoto({ ...life, children_count: 6, other_children_identifiable: true });
  assert.equal(d.decision, "approved"); assert.equal(d.preset, "withkids");
});
test("保守项不松：认不出/太小/背对/洗澡/医疗/别的孩子", () => {
  for (const o of [{ reference_child: "uncertain" }, { reference_child: "no" }, { main_child_size: "small" }, { face_visible: false }, { sensitive: "nudity_or_bath" }, { sensitive: "health" }, { sensitive: "finance" }])
    assert.equal(decidePhoto({ ...life, ...o }).decision, "needs_human_review", JSON.stringify(o));
});
test("截图/文档/物品/无孩子 → 不上页面；出错 → 留给人", () => {
  for (const k of ["screenshot", "document", "object", "collage"]) assert.equal(decidePhoto({ ...life, kind: k }).decision, "store_only");
  assert.equal(decidePhoto({ ...life, child_present: false }).decision, "store_only");
  assert.equal(decidePhoto({ error: "x" }).decision, "needs_human_review");
  assert.equal(decidePhoto(undefined).decision, "needs_human_review");
});
test("pickPhotos：只取窗口内、未见过的，按日期排，受上限", () => {
  const rows = [{ id: "a", takenDay: "2026-09-18" }, { id: "b", takenDay: "2026-07-01" }, { id: "c", takenDay: "2026-09-15" }, { id: "d", takenDay: "2026-09-16" }];
  const got = pickPhotos(rows, { today: "2026-09-20", seen: { d: { status: "held" } }, max: 5 });
  assert.deepEqual(got.map((r) => r.id), ["c", "a"]);
  assert.equal(pickPhotos(rows, { today: "2026-09-20", seen: {}, max: 1 }).length, 1);
});
test("spread 均匀取样且保持顺序", () => {
  assert.deepEqual(spread([1, 2, 3], 5), [1, 2, 3]);
  const s = spread(Array.from({ length: 20 }, (_, i) => i), 4);
  assert.deepEqual(s, [0, 5, 10, 15]);
});
const content = { days: [{ day: "2026-09-18", expandedMediaIds: ["x"], firstScreenMediaIds: [] }, { day: "2026-09-19", expandedMediaIds: [], firstScreenMediaIds: [] }] };
test("mergeDayMedia：只加不删，原有顺序不动，不改入参", () => {
  const before = JSON.stringify(content);
  const r = mergeDayMedia(content, "2026-09-18", ["x", "y", "z"]);
  assert.deepEqual(r.content.days[0].expandedMediaIds, ["x", "y", "z"]);
  assert.deepEqual(r.added, ["y", "z"]);
  assert.equal(JSON.stringify(content), before);
  assert.ok(r.content.days[0].firstScreenMediaIds.every((id) => r.content.days[0].expandedMediaIds.includes(id)));
});
test("mergeDayMedia：没有这一天/没有新增 → null；上限 12", () => {
  assert.equal(mergeDayMedia(content, "2026-09-25", ["a"]), null);
  assert.equal(mergeDayMedia(content, "2026-09-18", ["x"]), null);
  const many = Array.from({ length: 30 }, (_, i) => `p${i}`);
  assert.equal(mergeDayMedia(content, "2026-09-19", many).content.days[1].expandedMediaIds.length, 12);
});
test("batchLooksBroken：样本够而一张不放行 → 不可信", () => {
  assert.equal(batchLooksBroken(Array.from({ length: 50 }, () => ({ ...life, reference_child: "uncertain" }))).broken, true);
  assert.equal(batchLooksBroken(Array.from({ length: 50 }, () => ({ error: "x" }))).broken, true);
  assert.equal(batchLooksBroken([life, life]).broken, false);
});

import { applyLead } from "../scripts/editor/photos-plan.mjs";
test("applyLead：把选中的那张挪到最前，一张都不少", () => {
  const c = { days: [{ day: "2026-09-18", expandedMediaIds: ["a", "b", "c", "d"], firstScreenMediaIds: ["a", "b"] }] };
  const r = applyLead(c, "2026-09-18", "c");
  assert.deepEqual(r.content.days[0].expandedMediaIds, ["c", "a", "b", "d"]);
  assert.deepEqual(r.content.days[0].firstScreenMediaIds, ["c", "a"]);
  assert.deepEqual(c.days[0].expandedMediaIds, ["a", "b", "c", "d"], "不改入参");
});
test("applyLead：已经在最前 / 不在这一天 / 没这天 → null", () => {
  const c = { days: [{ day: "2026-09-18", expandedMediaIds: ["a", "b"], firstScreenMediaIds: ["a"] }] };
  assert.equal(applyLead(c, "2026-09-18", "a"), null);
  assert.equal(applyLead(c, "2026-09-18", "zz"), null);
  assert.equal(applyLead(c, "2026-09-19", "a"), null);
});

// ---- 孕期分类器 v2：每个安全字段都要明确 ----

test("孕期 v2：穿衣孕肚、B 超、产检、待产准备、妈妈的日常放行；糊掉的不放行", () => {
  for (const subtype of ["belly", "ultrasound", "prenatal", "nursery", "baby_items"]) assert.equal(decidePregnancyPhoto({ kind: "pregnancy", subtype, quality: "ok", sensitive: "none" }).decision, "approved");
  assert.equal(decidePregnancyPhoto({ kind: "family_life", subtype: null, quality: "good", sensitive: "none" }).decision, "approved");
  assert.equal(decidePregnancyPhoto({ kind: "pregnancy", subtype: "belly", quality: "poor", sensitive: "none" }).decision, "store_only");
  assert.equal(decidePregnancyPhoto({ kind: "family_life", subtype: null, quality: "poor", sensitive: "none" }).decision, "store_only");
});
test("孕期 v2：皮肤症状特写、裸露孕肚、洗澡裸露、医疗、证件、账单一律不放行（Teddy 2026-09-27 撤下 12 月 5 张的规则化）", () => {
  for (const sensitive of ["skin_symptom", "bare_belly", "nudity_or_bath", "health", "finance", "identity_document"]) {
    const d = decidePregnancyPhoto({ kind: "pregnancy", subtype: "belly", quality: "good", sensitive });
    assert.equal(d.decision, "store_only", sensitive); assert.equal(d.why, `sensitive:${sensitive}`);
    assert.equal(decidePregnancyPhoto({ kind: "family_life", subtype: null, quality: "good", sensitive }).decision, "store_only", sensitive);
  }
});
test("孕期 v2：sensitive 必须 === 'none'——null / 空串 / 不认识的值 / 非字符串都不放行；quality 只认 good/ok", () => {
  for (const sensitive of [null, "", "unknown", "None", false, 0, {}]) {
    const d = decidePregnancyPhoto({ kind: "pregnancy", subtype: "belly", quality: "good", sensitive });
    assert.equal(d.decision, "needs_human_review", JSON.stringify(sensitive)); assert.equal(d.why, "sensitive-unknown");
  }
  for (const quality of [null, "", "great", "fine", undefined]) {
    const d = decidePregnancyPhoto({ kind: "pregnancy", subtype: "belly", quality, sensitive: "none" });
    assert.equal(d.decision, "needs_human_review", JSON.stringify(quality)); assert.equal(d.why, "quality-unknown");
  }
});
test("孕期 v1 缓存（缺 sensitive 字段）：放行不可直接信任 → 拿不准、要重判；拒绝可沿用", () => {
  const stale = decidePregnancyPhoto({ kind: "pregnancy", subtype: "belly", quality: "good" });
  assert.equal(stale.decision, "needs_human_review"); assert.equal(stale.why, "legacy-no-sensitive-field");
  assert.equal(decidePregnancyPhoto({ kind: "family_life", subtype: null, quality: "ok" }).decision, "needs_human_review");
  assert.equal(decidePregnancyPhoto({ kind: "screenshot", subtype: null, quality: "good" }).decision, "store_only");
  assert.equal(decidePregnancyPhoto({ kind: "pregnancy", subtype: "belly", quality: "poor" }).decision, "store_only");
});
test("孕期：截图、证件、无关风景随手拍不放行；模型出错拿不准", () => {
  for (const kind of ["screenshot", "document", "scenery_object"]) assert.equal(decidePregnancyPhoto({ kind, subtype: null, quality: "good", sensitive: "none" }).decision, "store_only");
  assert.equal(decidePregnancyPhoto({ error: "x" }).decision, "needs_human_review");
});

import {
  decideFamilyLifePhoto, familyEvidenceFromTags, familyEvidenceFromScenery, familyEvidenceFromModel, subjectVerdictIsFinal, isLockedReview,
  readSensitive, resolveStaleApproved, partitionReviewRows, isFamilyApprovedRow, installGate,
  FAMILY_POLICY_VERSION, PREGNANCY_POLICY_VERSION, LEGACY_FAMILY_POLICY_VERSIONS,
} from "../scripts/editor/photos-plan.mjs";

// 完整的家庭生活证据（family-life-photo-v2 的六个字段都明确）
const ev = (over) => ({ scene: "meal", who: "baby_and_adult", quality: "ok", stranger_faces: false, commercial: false, sensitive: "none", caption: "x", basis: "family-life-photo-v2", ...over });
const uncertain = { ...life, reference_child: "uncertain" };
const adultsRaw = { ...life, child_present: false };

test("readSensitive：只有 'none' 是安全；已知类别是坏值；其余都是「说不清」", () => {
  assert.deepEqual(readSensitive("none"), { safe: true });
  assert.deepEqual(readSensitive("bare_belly"), { safe: false, kind: "bare_belly" });
  for (const v of [null, undefined, "", "unknown", "NONE", true, 1]) assert.equal(readSensitive(v).unknown, true, JSON.stringify(v));
});

test("家庭生活分支：自家来源 + 完整证据 + 有信息的场景放行，preset 带场景；来源不是自家的不放行", () => {
  for (const scene of ["meal", "outing", "home", "family_care", "travel", "celebration"]) {
    const d = decideFamilyLifePhoto(uncertain, { ours: true, family: ev({ scene }) });
    assert.equal(d.decision, "approved", scene); assert.equal(d.preset, `family:${scene}`);
  }
  assert.equal(decideFamilyLifePhoto(uncertain, { ours: false, family: ev() }).decision, "store_only");
  assert.equal(decideFamilyLifePhoto(uncertain, { ours: true, family: null }).decision, "needs_human_review");
});
test("家庭生活分支：陌生人大脸、商品/截图、任何敏感项、糊掉的、纯成人人像、无关物件不放行", () => {
  assert.equal(decideFamilyLifePhoto(uncertain, { ours: true, family: ev({ stranger_faces: true }) }).decision, "store_only");
  assert.equal(decideFamilyLifePhoto(uncertain, { ours: true, family: ev({ commercial: true }) }).decision, "store_only");
  for (const sensitive of ["skin_symptom", "bare_belly", "nudity_or_bath", "health", "finance", "identity_document"]) assert.equal(decideFamilyLifePhoto(uncertain, { ours: true, family: ev({ sensitive }) }).decision, "store_only", sensitive);
  assert.equal(decideFamilyLifePhoto(uncertain, { ours: true, family: ev({ quality: "poor" }) }).decision, "store_only");
  const adultPortrait = decideFamilyLifePhoto(adultsRaw, { ours: true, family: ev({ scene: "portrait", who: "adults_only" }) });
  assert.equal(adultPortrait.decision, "store_only"); assert.equal(adultPortrait.preset, "adult");
  assert.equal(decideFamilyLifePhoto(adultsRaw, { ours: true, family: ev({ scene: "family_care", who: "adults_only" }) }).decision, "store_only", "只有大人的「照料」不算");
  assert.equal(decideFamilyLifePhoto(adultsRaw, { ours: true, family: ev({ scene: "meal", who: "adults_only" }) }).decision, "approved", "大人吃饭的场景有信息");
  assert.equal(decideFamilyLifePhoto(uncertain, { ours: true, family: ev({ scene: "none", who: "nobody" }) }).preset, "object");
});
test("家庭生活分支：证据不完整（缺字段 / null / 空 / 不认识的值 / 布尔字段不是布尔）只扣住，绝不放行", () => {
  const hold = (over, field) => {
    const d = decideFamilyLifePhoto(uncertain, { ours: true, family: ev(over) });
    assert.equal(d.decision, "needs_human_review", JSON.stringify(over)); assert.equal(d.why, `evidence-incomplete:${field}`, JSON.stringify(over));
  };
  for (const sensitive of [null, undefined, "", "unknown"]) hold({ sensitive }, "sensitive");
  for (const stranger_faces of [null, undefined, "false", 0]) hold({ stranger_faces }, "stranger_faces");
  for (const commercial of [null, undefined, "no", "", 0]) hold({ commercial }, "commercial");
  for (const quality of [null, undefined, "", "fine"]) hold({ quality }, "quality");
  for (const scene of [null, undefined, "", "picnic"]) hold({ scene }, "scene");
  for (const who of [null, undefined, "", "unknown", "child"]) hold({ who }, "who");
  // 模型原始结果少一个键 → 没有证据
  assert.equal(familyEvidenceFromModel({ scene: "meal", who: "nobody", quality: "ok", stranger_faces: false, commercial: false }, "glm-5.3-flash"), null);
  // 键在、值是错的 → 证据原样带过去（不是 false、不是 "none"），由 decide 扣住
  const bad = familyEvidenceFromModel({ scene: "meal", who: "nobody", quality: "ok", stranger_faces: "false", commercial: null, sensitive: null }, "glm-5.3-flash");
  assert.equal(bad.stranger_faces, null); assert.equal(bad.commercial, null); assert.equal(bad.sensitive, null);
  assert.equal(decideFamilyLifePhoto(uncertain, { ours: true, family: bad }).decision, "needs_human_review");
  const good = familyEvidenceFromModel({ scene: "meal", who: "nobody", quality: "ok", stranger_faces: false, commercial: false, sensitive: "none" }, "glm-5.3-flash");
  assert.equal(good.basis, "family-life-photo-v2");
  assert.equal(decideFamilyLifePhoto(uncertain, { ours: true, family: good }).decision, "approved");
});
test("家庭生活分支：单独一个孩子——睡觉/睁眼/哭是人像，不是照料；要放行必须主体判定 reference_child=yes 且场景有环境信息；没有「不知道是谁的孩子」通道", () => {
  const sole = (r, over) => decideFamilyLifePhoto(r, { ours: true, family: ev({ who: "baby_only", ...over }) });
  // family_care + baby_only：一个人谈不上照料 → 人像，拒
  assert.equal(sole(life, { scene: "family_care" }).decision, "store_only"); assert.equal(sole(life, { scene: "family_care" }).why, "sole-child-not-care");
  assert.equal(sole(life, { scene: "portrait" }).decision, "store_only"); assert.equal(sole(life, { scene: "portrait" }).preset, "portrait");
  // 认出是张年（reference yes，主体规则因为背对/太小没放行）+ 有环境信息的场景 → 放行
  for (const scene of ["meal", "outing", "home", "travel", "celebration"]) assert.equal(sole({ ...life, face_visible: false }, { scene }).decision, "approved", scene);
  // 身份没证明（uncertain / no / 库里没 raw / 没有 reference 字段）→ 扣住，不放行
  for (const r of [uncertain, null, { kind: "life", child_present: true }, adultsRaw]) {
    const d = sole(r, { scene: "outing" });
    assert.equal(d.decision, "needs_human_review", JSON.stringify(r)); assert.equal(d.why, "sole-child-identity-unproven");
  }
  // 模型明确说是别的孩子：分支不翻（01/24 球馆小球迷）
  assert.equal(sole({ ...life, reference_child: "no" }, { scene: "outing" }).why, "model-says-other-child");
});
test("家庭生活分支不翻主体判定的硬结论：截图/证件/拼图、敏感、模型说是别的孩子；主体的 sensitive 说不清也扣住", () => {
  for (const kind of ["document", "screenshot", "collage"]) assert.equal(decideFamilyLifePhoto({ ...life, kind }, { ours: true, family: ev() }).decision, "store_only", kind);
  assert.equal(decideFamilyLifePhoto({ ...uncertain, sensitive: "nudity_or_bath" }, { ours: true, family: ev() }).decision, "needs_human_review");
  assert.equal(decideFamilyLifePhoto({ ...uncertain, sensitive: "finance" }, { ours: true, family: ev() }).decision, "store_only");
  assert.equal(decideFamilyLifePhoto({ ...uncertain, sensitive: null }, { ours: true, family: ev() }).why, "subject-sensitive-unknown");
  assert.equal(decideFamilyLifePhoto({ ...life, reference_child: "no" }, { ours: true, family: ev() }).decision, "needs_human_review");
  assert.equal(decideFamilyLifePhoto(null, { ours: true, family: ev() }).decision, "approved", "库里的旧拒绝没有 raw：宝宝和大人的生活场景凭完整证据放行");
  assert.equal(subjectVerdictIsFinal(life), true); assert.equal(subjectVerdictIsFinal(uncertain), false);
  assert.equal(subjectVerdictIsFinal({ ...life, kind: "screenshot" }), true); assert.equal(subjectVerdictIsFinal({ ...uncertain, sensitive: "health" }), true);
  assert.equal(subjectVerdictIsFinal({ ...life, child_present: false, reference_child: "no" }), false, "只有大人/物件：分支要看");
});
test("旧证据（旅程标签 / 风景判定）没有 commercial：只能拒绝，不能放行；不推断 who=nobody、不把缺失的 sensitive 当 none", () => {
  const tags = (o) => ({ place: "卧室", activity: "睡觉", who: "只有宝宝", appeal: 70, sharp: true, stranger_faces: false, sensitive: "none", caption: "c", model: "glm-5.3-flash", promptVersion: "travel-scene-tags-v1", ...o });
  const t0 = familyEvidenceFromTags(tags());
  assert.equal(t0.scene, "portrait", "只有宝宝睡觉 = 人像"); assert.equal(t0.commercial, null); assert.equal(t0.basis, "travel-scene-tags-v1");
  assert.equal(decideFamilyLifePhoto(life, { ours: true, family: t0 }).decision, "store_only", "人像：旧证据能拒");
  for (const activity of ["躺着醒着", "看镜头", "被抱着"]) assert.equal(familyEvidenceFromTags(tags({ activity })).scene, "portrait", activity);
  assert.equal(familyEvidenceFromTags(tags({ activity: "食物", who: "没有人" })).scene, "meal");
  assert.equal(familyEvidenceFromTags(tags({ place: "户外", activity: "风景", who: "没有人" })).scene, "outing");
  assert.equal(familyEvidenceFromTags(tags({ place: "机场", activity: "推车里", who: "宝宝和大人" })).scene, "travel");
  assert.equal(familyEvidenceFromTags(tags({ activity: "喝奶", who: "宝宝和大人" })).scene, "family_care", "大人在喂 = 照料");
  assert.equal(familyEvidenceFromTags(tags({ activity: "睡觉", who: "宝宝和大人" })).scene, "portrait", "大人在旁边、没互动 ≠ 照料");
  assert.equal(familyEvidenceFromTags(tags({ activity: "物品", who: "没有人", place: "客厅" })).scene, "none");
  assert.equal(familyEvidenceFromTags(tags({ who: "只有大人", activity: "看镜头" })).scene, "portrait");
  assert.equal(familyEvidenceFromTags(tags({ appeal: 30 })).quality, "poor");
  assert.equal(familyEvidenceFromTags(tags({ sharp: false })).quality, "poor");
  assert.equal(familyEvidenceFromTags(tags({ who: "不认识的值" })).who, null);
  assert.equal(familyEvidenceFromTags(tags({ sensitive: undefined })).sensitive, null, "缺失不当 none");
  assert.equal(familyEvidenceFromTags(tags({ stranger_faces: "false" })).stranger_faces, null);
  // 场景有信息、其余字段都好，但 commercial 不知道 → 只扣住（要模型），不放行
  const meal = familyEvidenceFromTags(tags({ activity: "食物", who: "宝宝和大人" }));
  const dm = decideFamilyLifePhoto(uncertain, { ours: true, family: meal });
  assert.equal(dm.decision, "needs_human_review"); assert.equal(dm.why, "evidence-incomplete:commercial");
  assert.equal(familyEvidenceFromTags({ error: "x" }), null); assert.equal(familyEvidenceFromTags(undefined), null);

  const scen = (o) => ({ kind: "scenery", scenic: 70, sharp: true, stranger_faces: false, text_heavy: false, sensitive: "none", caption: "c", model: "glm-5.3-flash", promptVersion: "travel-scenery-v1", ...o });
  const s0 = familyEvidenceFromScenery(scen());
  assert.equal(s0.scene, "outing"); assert.equal(s0.who, null, "风景判定不知道有谁，不推断成没有人"); assert.equal(s0.commercial, null);
  const ds = decideFamilyLifePhoto(uncertain, { ours: true, family: s0 });
  assert.equal(ds.decision, "needs_human_review"); assert.equal(ds.why, "evidence-incomplete:commercial");
  assert.equal(familyEvidenceFromScenery(scen({ scenic: 20 })).quality, "poor");
  assert.equal(familyEvidenceFromScenery(scen({ kind: "food" })).scene, "meal");
  assert.equal(familyEvidenceFromScenery(scen({ kind: "indoor" })).scene, "home");
  assert.equal(familyEvidenceFromScenery(scen({ kind: "screenshot" })).scene, "none");
  assert.equal(familyEvidenceFromScenery(scen({ kind: "object" })).scene, "none");
  assert.equal(decideFamilyLifePhoto(uncertain, { ours: true, family: familyEvidenceFromScenery(scen({ kind: "screenshot" })) }).decision, "store_only", "截图：旧证据能拒");
  assert.equal(decideFamilyLifePhoto(uncertain, { ours: true, family: familyEvidenceFromScenery(scen({ stranger_faces: true })) }).decision, "store_only", "陌生人：旧证据能拒");
  assert.equal(familyEvidenceFromScenery(scen({ kind: "people" })), null, "以成年人为主体：不知道是谁，交给模型");
  assert.equal(familyEvidenceFromScenery(scen({ kind: "child" })), null, "风景判定里的 child 既证明不了是张年、也说不出环境，交给模型");
  assert.equal(familyEvidenceFromScenery(scen({ sensitive: "" })).sensitive, null);
});
test("人工锁：manual / claude-* / manual: 原因码 / teddy-* 不可翻转；deepseek、glm 的自动行可以重审", () => {
  assert.equal(isLockedReview({ decision: "store_only", provider: "manual", promptVersion: "teddy-pilot-feedback-20260927", reasonCodes: ["manual:do-not-display"] }), true);
  assert.equal(isLockedReview({ decision: "store_only", provider: "glm", promptVersion: "x", reasonCodes: ["manual:do-not-display"] }), true);
  assert.equal(isLockedReview({ decision: "store_only", provider: "glm", promptVersion: "teddy-x", reasonCodes: [] }), true);
  assert.equal(isLockedReview({ decision: "approved", provider: "claude-review", promptVersion: "claude-photo-2026-09-16", reasonCodes: [] }), true);
  assert.equal(isLockedReview({ decision: "approved", provider: "claude-code", promptVersion: "quark-subject-check-v1" }), true);
  assert.equal(isLockedReview({ decision: "store_only", provider: "glm", promptVersion: "deepseek-photo-auto-v1", reasonCodes: ["basis:auto-deepseek-policy"] }), false);
  assert.equal(isLockedReview({ decision: "store_only", provider: "deepseek", promptVersion: "deepseek-photo-2026-09-16" }), false);
  assert.equal(isLockedReview(null), false); assert.equal(isLockedReview({}), false);
});

// ---- media-month 的选择与旧版放行处理（纯函数部分）----

const isPreBirth = (day) => day < "2025-01-03";
const row = (id, day, over = {}) => ({ id, day, decision: null, provider: null, promptVersion: null, policyVersion: null, reasonCodes: null, ...over });

test("partitionReviewRows：人工否决（12 月撤下的 5 张）永远在 locked，不进任何重审组；重跑同一份库分组一样", () => {
  const rows = [
    row("veto", "2024-12-01", { decision: "store_only", provider: "manual", promptVersion: "teddy-pilot-feedback-20260927", reasonCodes: ["manual:do-not-display"] }),
    row("claude", "2025-01-05", { decision: "approved", provider: "claude-review", promptVersion: "claude-photo-2026-09-16" }),
    row("new", "2025-01-06"),
    row("rej", "2025-01-07", { decision: "store_only", provider: "glm", promptVersion: "deepseek-photo-auto-v1", policyVersion: "auto-photo-2026-09-20-subject-v1" }),
    row("nhr", "2025-01-08", { decision: "needs_human_review", provider: "glm", promptVersion: "deepseek-photo-auto-v1" }),
    row("preheld", "2024-12-20", { decision: "needs_human_review", provider: "glm", promptVersion: "pregnancy-photo-v2", policyVersion: PREGNANCY_POLICY_VERSION }),
    row("prerej", "2024-12-21", { decision: "store_only", provider: "glm", promptVersion: "pregnancy-photo-v1", policyVersion: "auto-photo-2026-09-26-pregnancy-v1" }),
    row("stalepreg", "2024-12-22", { decision: "approved", provider: "glm", promptVersion: "pregnancy-photo-v1", policyVersion: "auto-photo-2026-09-26-pregnancy-v1" }),
    row("okpreg", "2024-12-23", { decision: "approved", provider: "glm", promptVersion: "pregnancy-photo-v2", policyVersion: PREGNANCY_POLICY_VERSION }),
    row("stalefam", "2025-01-16", { decision: "approved", provider: "glm", promptVersion: "family-life-photo-v1", policyVersion: LEGACY_FAMILY_POLICY_VERSIONS[0] }),
    row("okfam", "2025-01-17", { decision: "approved", provider: "glm", promptVersion: "family-life-photo-v2", policyVersion: FAMILY_POLICY_VERSION, reasonCodes: ["basis:auto-family-life-policy", "label:family:outing"] }),
    row("oksubj", "2025-01-18", { decision: "approved", provider: "glm", promptVersion: "deepseek-photo-auto-v1", policyVersion: "auto-photo-2026-09-20-subject-v1" }),
  ];
  const p = partitionReviewRows(rows, { isPreBirth });
  const ids = (k) => p[k].map((r) => r.id);
  assert.deepEqual(ids("locked"), ["veto", "claude"]);
  assert.deepEqual(ids("unjudged"), ["new"]);
  assert.deepEqual(ids("autoRejected"), ["rej", "nhr"]);
  assert.deepEqual(ids("held"), ["preheld"]);
  assert.deepEqual(ids("staleApproved"), ["stalepreg", "stalefam"], "旧版孕期放行、旧版家庭放行都要重验；当前版本的放行不动");
  assert.deepEqual(partitionReviewRows(rows, { isPreBirth }), p, "同一份库 → 同一份分组");
  const all = new Set(Object.values(p).flat().map((r) => r.id));
  for (const id of ["veto", "claude", "new", "rej", "nhr", "preheld", "stalepreg", "stalefam"]) assert.ok(all.has(id), id);
  for (const id of ["prerej", "okpreg", "okfam", "oksubj"]) assert.ok(!all.has(id), `${id} 不在任何待处理组`);
});
test("isFamilyApprovedRow：只有当前家庭策略、带 basis + label:family:<场景> 的放行行算生活场景（重跑不丢标记，人像不冒充）", () => {
  const ok = { decision: "approved", policyVersion: FAMILY_POLICY_VERSION, reasonCodes: ["basis:auto-family-life-policy", "label:family:meal", "evidence:family-life-photo-v2"] };
  assert.equal(isFamilyApprovedRow(ok), true);
  assert.equal(isFamilyApprovedRow({ ...ok, decision: "store_only" }), false);
  assert.equal(isFamilyApprovedRow({ ...ok, policyVersion: LEGACY_FAMILY_POLICY_VERSIONS[0] }), false, "旧策略的家庭行不算");
  assert.equal(isFamilyApprovedRow({ ...ok, reasonCodes: ["basis:auto-family-life-policy", "label:portrait"] }), false, "没有场景标签不算");
  assert.equal(isFamilyApprovedRow({ ...ok, reasonCodes: ["basis:auto-deepseek-policy", "label:family:meal"] }), false, "主体策略的行不算");
  assert.equal(isFamilyApprovedRow({ ...ok, reasonCodes: null }), false); assert.equal(isFamilyApprovedRow(null), false);
});
test("resolveStaleApproved：旧版放行——重判出错 / 拿不准 / 没判 → 本轮撤下（needs_human_review），拟写行；重判成功 → 用新结论（放行也写新版本行）", () => {
  for (const [fresh, why] of [[null, "not-judged"], [{ decision: "needs_human_review", preset: "unclear", why: "model-error" }, "model-error"], [{ decision: "needs_human_review", preset: "unclear", why: "legacy-no-sensitive-field" }, "legacy-no-sensitive-field"]]) {
    const d = resolveStaleApproved(fresh);
    assert.equal(d.decision, "needs_human_review"); assert.equal(d.preset, "stale-unverified"); assert.equal(d.why, `stale-unverified:${why}`);
  }
  assert.equal(resolveStaleApproved(null, "unavailable:404").why, "stale-unverified:unavailable:404");
  assert.deepEqual(resolveStaleApproved({ decision: "approved", preset: "belly" }), { decision: "approved", preset: "belly" });
  assert.deepEqual(resolveStaleApproved({ decision: "store_only", preset: "bare-belly", why: "sensitive:bare_belly" }), { decision: "store_only", preset: "bare-belly", why: "sensitive:bare_belly" });
});
test("installGate：schema 不过 / 新天正文空白 / 撤下的旧放行还挂着 → 不装；都好 → 空数组", () => {
  const validate = (c, m) => (c?.schema === "ok" && c.month === m ? c : null);
  const day = (d, over = {}) => ({ day: d, kind: "story", title: null, paragraphs: ["有字"], firstScreenMediaIds: [], expandedMediaIds: [], ...over });
  const good = { schema: "ok", month: "2025-01", days: [day("2025-01-05"), day("2025-01-06", { paragraphs: ["新天写好了"], expandedMediaIds: ["p1"] })] };
  assert.deepEqual(installGate(good, "2025-01", { newDays: new Set(["2025-01-06"]), staleUnresolved: new Set(), validate }), []);
  const r1 = installGate({ ...good, schema: "bad" }, "2025-01", { newDays: new Set(), staleUnresolved: new Set(), validate });
  assert.equal(r1.length, 1); assert.match(r1[0], /validateMonthContent/);
  const blankNew = { ...good, days: [day("2025-01-05"), day("2025-01-06", { paragraphs: [], expandedMediaIds: ["p1"] })] };
  const r2 = installGate(blankNew, "2025-01", { newDays: new Set(["2025-01-06"]), staleUnresolved: new Set(), validate });
  assert.equal(r2.length, 1); assert.match(r2[0], /2025-01-06/);
  const blankOld = { ...good, days: [day("2025-01-05", { title: null, paragraphs: ["   "], expandedMediaIds: ["p0"] })] };
  assert.equal(installGate(blankOld, "2025-01", { newDays: new Set(), staleUnresolved: new Set(), validate }).length, 1, "只有空白段落也算空白");
  assert.deepEqual(installGate({ ...good, days: [day("2025-01-05", { title: "有标题", paragraphs: [], expandedMediaIds: ["p0"] })] }, "2025-01", { newDays: new Set(), staleUnresolved: new Set(), validate }), [], "旧天有标题没正文不算空白");
  const r3 = installGate(good, "2025-01", { newDays: new Set(["2025-01-06"]), staleUnresolved: new Set(["p1"]), validate });
  assert.equal(r3.length, 1); assert.match(r3[0], /2025-01-06\/p1/);
});
