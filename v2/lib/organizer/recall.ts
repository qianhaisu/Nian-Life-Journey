// Deterministic recall/prefilter (§7.1, §7.2 of the task). Never outputs an action — only a score
// that decides whether a window is worth a Memory Editor call at all. Keywords may only affect
// this gate, never the final action/contentType/worthiness (checked by tests, not just convention).
import type { EvidenceWindow } from "./evidence/types";

const MILESTONE_WORDS = /第一次|首次|开始|学会|主动|明显|里程碑|生日|旅行|终于|居然|竟然|突然|first\s*time|milestone/i;
const NOISE_WORDS = /红包|接龙|投票|群公告|^https?:\/\/\S+$/i;
const SUBJECT_INDICATOR = /他|她|张年/;
const QUOTE_WORDS = /[""「」]/;
const CONCRETE = /\d/;

export type SubjectConfig = { primaryName: string; aliases: string[] };

// Deliberately generous: the whole point of a recall gate is to filter out the truly empty/noisy
// majority cheaply while sending anything with real content on to the Memory Editor. Precision
// (deciding what a message is actually about) is not this stage's job.
export function recallScore(window: EvidenceWindow, subject: SubjectConfig): number {
  const text = window.items.map((item) => item.text).join("\n");
  let score = 0;
  const names = [subject.primaryName, ...subject.aliases].filter(Boolean);
  if (text.trim().length > 3) score += 2;
  if (names.some((name) => text.includes(name)) || SUBJECT_INDICATOR.test(text)) score += 2;
  if (window.items.some((item) => item.senderRole === "teacher" || item.senderRole === "hospital")) score += 2;
  const boundImages = window.mediaBindings.filter((binding) => binding.confidence >= 0.75).length;
  if (boundImages > 0) score += 2;
  if (QUOTE_WORDS.test(text)) score += 2;
  if (MILESTONE_WORDS.test(text)) score += 2;
  if (/[跑走踢爬跳追球玩递给掰抱亲摸分享说词语言表达喜欢专注感兴趣一起同伴]/.test(text) && /[了过着]/.test(text)) score += 1;
  if (CONCRETE.test(text) || window.items.some((item) => item.text.length > 6)) score += 1;
  const senderMessages = window.items.length;
  if (senderMessages >= 4) score += 1;
  if (window.items.every((item) => !item.text.trim() && item.mediaRefs.length === 0)) score -= 2;
  if (NOISE_WORDS.test(text)) score -= 3;
  return score;
}

export const RECALL_THRESHOLD = 2;

export function passesRecall(window: EvidenceWindow, subject: SubjectConfig, threshold = RECALL_THRESHOLD) {
  return recallScore(window, subject) >= threshold;
}
