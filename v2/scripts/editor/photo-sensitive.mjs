// 照片上不上页面的敏感信息规则（Teddy 2026-09-23）。孕期照片、以及所有新入库的媒体共用，纯函数。
// 输入是 deepseek-flash 看图后给出的结构化判断（它读图可靠、读小字不可靠，所以只信「这是一张单据」，
// 不信它读出来的具体号码）。判断不确定的一律不用。
//
// 一律不上页面：裸露或私密画面（穿着衣服的孕肚照可以）；证件与能识别个人的单据；
// 带患者姓名/病历号/医院编号的 B 超单或检查报告（需要打码——我们没有可靠的自动打码，打不了码的不用）；
// 与张年及这次怀孕无关的第三方；任何拿不准的。

export const PHOTO_REJECT_REASONS = Object.freeze({
  nudity_or_private: "裸露或私密画面",
  identity_document: "证件",
  personal_record: "能识别个人的单据（工资条、银行/支付截图、快递单、带地址或电话）",
  patient_identifiers: "B 超单/检查报告上有患者姓名、病历号或医院编号，打不了码",
  unrelated_third_party: "与张年及这次怀孕无关的第三方",
  not_a_family_photo: "截图、海报、广告、商品页或文件，不是家里拍的照片",
  mother_medical: "检验报告：妈妈本人的检查指标",
  uncertain: "判断不确定",
});

/**
 * @param {{category?:string, nudity?:string, document_type?:string, has_patient_identifiers?:boolean|string, has_address_or_phone?:boolean|string, third_party_only?:boolean|string, confidence?:string}} v
 * @returns {{allow:boolean, reason:string, redact:false}}
 */
export function decideSensitivePhoto(v) {
  const yes = (x) => x === true || x === "yes" || x === "true";
  const unsure = (x) => x === "unsure" || x === "uncertain";
  if (!v || v.category === "unsure" || v.category === "error" || unsure(v.nudity) || unsure(v.has_patient_identifiers) || unsure(v.has_address_or_phone) || v.confidence === "low") return { allow: false, reason: PHOTO_REJECT_REASONS.uncertain, redact: false };
  // 只要家里拍的照片和干净的 B 超影像：截图、海报、广告、商品页、备忘录、聊天记录、文件一律不上页面
  // （2026-09-23 第一遍放行里混进了费用备忘录、别人的车祸帖、妈妈的血常规报告）。
  if (v.image_kind !== undefined && v.image_kind !== "camera_photo" && v.image_kind !== "ultrasound_image") return { allow: false, reason: PHOTO_REJECT_REASONS.not_a_family_photo, redact: false };
  if (v.document_type === "medical_report") return { allow: false, reason: PHOTO_REJECT_REASONS.mother_medical, redact: false };
  if (v.nudity && v.nudity !== "none") return { allow: false, reason: PHOTO_REJECT_REASONS.nudity_or_private, redact: false };
  if (v.document_type === "identity_document") return { allow: false, reason: PHOTO_REJECT_REASONS.identity_document, redact: false };
  if (["payslip", "bank_or_payment", "shipping_label", "bill_or_invoice"].includes(v.document_type) || yes(v.has_address_or_phone)) return { allow: false, reason: PHOTO_REJECT_REASONS.personal_record, redact: false };
  if (yes(v.has_patient_identifiers)) return { allow: false, reason: PHOTO_REJECT_REASONS.patient_identifiers, redact: false };
  if (yes(v.third_party_only)) return { allow: false, reason: PHOTO_REJECT_REASONS.unrelated_third_party, redact: false };
  return { allow: true, reason: "通过敏感信息规则", redact: false };
}
