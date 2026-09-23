// 月页正文里「谁」可以被点名：唯一依据是 lib/organizer/family-registry.ts。
//
// 2026-09-23 之前，校验器里有一张手写的「未确认称呼」表；上一轮为了让「外婆」「小雪」能出现，
// 直接把它们从表里删掉了——校验器自己做了身份判断。这是错的：称谓能不能出现，只取决于注册表里
// 有没有这个人。所以这里不再手写允许名单，而是：
//   允许的称谓 = 注册表里每个人的 narrativeLabel（Teddy 确认过的称呼）
//   禁止的称谓 = 下面这张「汉语亲属/照护称谓」词表 − 允许的称谓
// 注册表里加一个人，这个人的称谓自动放行；删一个人，自动拦下。校验器里不存在第二份身份名单。
import { FAMILY_REGISTRY } from "../../lib/organizer/family-registry.ts";
import { resolveSpeaker } from "../../lib/organizer/identity.ts";

/**
 * 可能被写成「某个具体的人」的称谓。这是一张词表，不是身份判断：它只回答「这个词是不是在点名一个人」。
 * 哥哥/姐姐不在表里——托班里的其他小朋友常被这样叫，它们不指向家里的某个人。
 */
export const KINSHIP_TERMS = Object.freeze([
  "外婆", "外公", "姥姥", "姥爷", "爷爷", "奶奶", "太奶奶", "太爷爷", "太外婆", "太外公",
  "雪姨", "小雪", "干妈", "干爹", "小姨", "姨妈", "姨夫", "晴姨", "舅舅", "舅妈", "姑姑", "姑父",
  "叔叔", "婶婶", "伯伯", "伯母", "阿姨", "保姆", "育儿嫂", "园长",
]);

/** 注册表里 Teddy 确认过的称呼（去重）。 */
export function registeredLabels(registry = FAMILY_REGISTRY) {
  return [...new Set(registry.participants.map((p) => p.narrativeLabel).filter(Boolean))];
}

/** 引号外不许出现的称谓：词表里、但注册表里没有的。 */
export function unconfirmedNames(registry = FAMILY_REGISTRY) {
  const allowed = new Set(registeredLabels(registry));
  return KINSHIP_TERMS.filter((term) => !allowed.has(term));
}

/**
 * 这条消息的发送人在正文里叫什么。未登记的人返回 null——他们不能被点名，他们的话也不能被归到谁名下。
 * conversationId 必须给：注册表里有些条目只在确认过的会话里生效（同一个显示名在别的群里可能是别人）。
 */
export function labelForSender(senderDigest, conversationId, registry = FAMILY_REGISTRY) {
  if (!senderDigest) return null;
  const speaker = resolveSpeaker(senderDigest, registry, { conversationId: conversationId ?? undefined });
  return speaker.narrativeLabel ?? null;
}

/**
 * 同一个人在消息原文里的其它叫法——只用来判断「这条消息有没有提到这个人」（照片人物证据），
 * 绝不用来决定正文里怎么称呼。只收家里真实会用的口语叫法。
 */
export const LABEL_MENTIONS = Object.freeze({
  爸爸: ["爸爸", "爸比", "老爸"],
  妈妈: ["妈妈", "麻麻", "老妈", "妈咪"],
  奶奶: ["奶奶"],
  爷爷: ["爷爷"],
  外婆: ["外婆", "姥姥"],
  外公: ["外公", "姥爷"],
  雪姨: ["雪姨", "小雪", "阿姨"],
  大兵老师: ["大兵"],
  潇潇老师: ["潇潇", "潇老师"],
  阳阳老师: ["阳阳"],
  多多: ["多多", "干妈"],
  吴艳: ["吴艳"],
  老师: ["老师"],
});

export const mentionsOf = (label) => LABEL_MENTIONS[label] ?? [label];
