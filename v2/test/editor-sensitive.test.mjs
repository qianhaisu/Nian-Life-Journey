import test from "node:test";
import assert from "node:assert/strict";
import { validateDayText } from "../scripts/editor/validate-day.mjs";
import { decideSensitivePhoto } from "../scripts/editor/photo-sensitive.mjs";
import { decidePhoto } from "../scripts/editor/photos-plan.mjs";

// 2026-09-23 Teddy 的敏感信息标准：孕期内容自动判定、直接上页面，由 Cowork 事后抽查。合成文字。
const day = (p) => ({ day: "2024-09-10", title: "一个标题", paragraphs: [p] });
const src = (speaker, text) => ({ id: `s-${text.length}`, speaker, text });
const errs = (p, s) => validateDayText(day(p), s ?? []).errors.join();

test("文字：妈妈本人的病情、用药、指标不写；与宝宝有关的结论可以写", () => {
  assert.match(errs("妈妈说「今天血糖有点高」。", [src("妈妈", "今天血糖有点高")]), /敏感信息（妈妈本人/);
  assert.match(errs("医生开了黄体酮。"), /敏感信息/);
  assert.doesNotMatch(errs("妈妈说「产检一切正常」。", [src("妈妈", "产检一切正常")]), /敏感/);
  assert.doesNotMatch(errs("妈妈说「宝宝比预计大五天」。", [src("妈妈", "宝宝比预计大五天")]), /敏感/);
});

test("文字：钱、证件与签证、精确地址电话、争执，连引号里的原话也不行", () => {
  assert.match(errs("爸爸说「这次花了三千二百元」。", [src("爸爸", "这次花了三千二百元")]), /敏感信息（钱）/);
  assert.match(errs("他们去办了签证。"), /证件与身份/);
  assert.match(errs("住在3号楼2单元。"), /精确地址/);
  assert.match(errs("妈妈说「13812345678」。", [src("妈妈", "13812345678")]), /精确地址与电话/);
  assert.match(errs("两个人吵架了。"), /争执/);
  assert.doesNotMatch(errs("他们去了杭州的小公园。"), /敏感/, "城市、公园名可以写");
});

test("照片：穿着衣服的孕肚、干净的 B 超影像可以用", () => {
  assert.equal(decideSensitivePhoto({ category: "bump", nudity: "none", document_type: "none", has_patient_identifiers: false, has_address_or_phone: false, third_party_only: false }).allow, true);
  assert.equal(decideSensitivePhoto({ category: "ultrasound", nudity: "none", document_type: "medical_image", has_patient_identifiers: false, has_address_or_phone: false }).allow, true);
});

test("照片：裸露、证件、单据、带患者信息的报告、无关第三方、拿不准，一律不用", () => {
  const base = { category: "checkup", nudity: "none", document_type: "none", has_patient_identifiers: false, has_address_or_phone: false, third_party_only: false };
  for (const [patch, re] of [
    [{ nudity: "partial" }, /裸露/], [{ document_type: "identity_document" }, /证件/], [{ document_type: "payslip" }, /单据/],
    [{ has_address_or_phone: true }, /地址或电话/], [{ has_patient_identifiers: true }, /打不了码/], [{ third_party_only: true }, /第三方/],
    [{ category: "unsure" }, /不确定/], [{ has_patient_identifiers: "unsure" }, /不确定/],
  ]) assert.match(decideSensitivePhoto({ ...base, ...patch }).reason, re, JSON.stringify(patch));
});

test("照片：截图、海报、商品页、检验报告不是家里拍的照片，不上页面；家里拍的照片与干净的 B 超影像可以", () => {
  const ok = { category: "checkup", nudity: "none", document_type: "none", has_patient_identifiers: false, has_address_or_phone: false, third_party_only: false };
  for (const kind of ["screenshot", "poster_or_ad", "document"]) assert.match(decideSensitivePhoto({ ...ok, image_kind: kind }).reason, /不是家里拍的照片/, kind);
  assert.match(decideSensitivePhoto({ ...ok, image_kind: "camera_photo", document_type: "medical_report" }).reason, /妈妈本人的检查指标/);
  assert.equal(decideSensitivePhoto({ ...ok, image_kind: "camera_photo", category: "bump" }).allow, true);
  assert.equal(decideSensitivePhoto({ ...ok, image_kind: "ultrasound_image", category: "ultrasound", document_type: "medical_image" }).allow, true);
});

test("新入库的媒体（夜间照片流程）同样拦下证件、截图、医疗、裸露", () => {
  const ok = { kind: "life", child_present: true, reference_child: "yes", face_visible: true, children_count: 1, main_child_size: "large", other_children_identifiable: false, sensitive: "none" };
  assert.notEqual(decidePhoto({ ...ok, sensitive: "identity_document" }).decision, "approved");
  assert.notEqual(decidePhoto({ ...ok, sensitive: "nudity_or_bath" }).decision, "approved");
  assert.notEqual(decidePhoto({ ...ok, sensitive: "health" }).decision, "approved");
  assert.notEqual(decidePhoto({ ...ok, kind: "document" }).decision, "approved");
});
