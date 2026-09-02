// Presentation-only cleaning for raw evidence shown on an event page.
//
// The evidence layer exists so the family can see what was actually there ("故事可以修改；当时真正
// 留下的东西永远保留"), so this NEVER edits a RawSource — it only decides how one reads on screen.
// WeChat exports carry markdown escaping, media placeholders, markdown paths into media/, and
// template tokens from the exporter. Rendering those verbatim shows the reader plumbing, not
// evidence: the photo or video itself is already displayed by the media grid next to the text.
const MEDIA_MARKDOWN = /!?\[[^\]]*\]\(\s*media\/[^)]*\)/g;
const PLACEHOLDER_TOKEN = /\[(media|图片|视频|视频文件|表情包|动画表情|语音|文件|位置|链接|链接分享|名片|转账|红包)\]/g;
const EXPORTER_TOKEN = /\$(names|username|revoke|emoji)\$/g;
const WECHAT_ESCAPE = /\\([[\]().*_~`>#+\-!\\])/g;
const RECALL_NOTICE = /撤回了一条消息|你邀请.*加入了群聊|邀请你和.*加入了群聊|^\s*\d+\s*条聊天记录\s*$/;
const URL_PATTERN = /https?:\/\/\S+/g;
// Service/marketing SMS that happens to address the child by name is not a family memory, and it
// arrives carrying a link. A hospital satisfaction-survey SMS was being rendered inside a published
// event's evidence layer.
// A quoted reply arrives as a markdown blockquote header naming the person being replied to
// ("> hxx.:"). That header is exporter syntax, not something the family wrote; the reply's own text
// follows it and is what belongs on the page.
// The blockquote line holds the name AND the text being replied to; the reply itself follows on a
// later line. Dropping the leading blockquote lines keeps the reply and discards the duplicate.
function stripQuotedReply(text: string): string {
  const lines = text.split(/\r?\n/);
  let start = 0;
  while (start < lines.length && /^[ \t]*>/.test(lines[start])) start += 1;
  return lines.slice(start).join("\n");
}

const SERVICE_MESSAGE = /满意度调查|问卷|退订|回复\s*TD|验证码|【[^】]{2,12}】.{0,40}(?:您|尊敬的)/;

// Returns the text as it should be displayed, or an empty string when nothing readable is left.
// An empty result means "render the media, not a caption" — never "hide the evidence item".
export function presentableEvidenceText(text: string | undefined | null): string {
  if (!text) return "";
  const unescaped = text.replace(WECHAT_ESCAPE, "$1");
  if (RECALL_NOTICE.test(unescaped.trim())) return "";
  if (SERVICE_MESSAGE.test(unescaped)) return "";
  const cleaned = stripQuotedReply(unescaped)
    .replace(MEDIA_MARKDOWN, " ")
    .replace(PLACEHOLDER_TOKEN, " ")
    .replace(EXPORTER_TOKEN, " ")
    .replace(URL_PATTERN, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
  // A line that was only a quote marker or punctuation once the plumbing is gone is not text.
  return /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : "";
}

// Internal identifiers (a conversation digest, an import batch id) are plumbing, not provenance.
// Only a label a person would recognise is worth showing next to a piece of evidence.
const INTERNAL_LABEL = /^(conversation|wechat-import|artifact|batch|document):/i;

export function presentableSourceLabel(label: string | undefined | null): string {
  if (!label) return "";
  const trimmed = label.trim();
  if (INTERNAL_LABEL.test(trimmed)) return "";
  if (/^[0-9a-f]{16,}$/i.test(trimmed)) return "";
  return trimmed;
}
