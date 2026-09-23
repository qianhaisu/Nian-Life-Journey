// 哪几天是里程碑：第一次走路、出牙、第一次开口叫人、生日、第一次出远门……（第三轮 5.2，2026-09-23）
//
// 原则五（Not Equal Weight）：重要的日子和普通的一天要一眼分辨。lib/month-day-weight.ts 只有「写了多少、
// 拍了多少」的代理信号，并留了 emphasis:"lead" 的出口等人标。这里补的是**文字里写明了的里程碑**：
// 只认明确的说法（「迈出了第一步」「第八颗牙冒出来」「满一周岁」「第一次坐飞机」），不猜。
// 标题和正文由编辑器按原话写成、并过了引语校验（「第一次」必须出自原消息），所以这里读到的「第一次」是有来源的。
//
// 识别到的日子：月页上抬成领头日（配首图、大标题），并加一个小标记（「第一次」「生日」「出牙」）。
// 内容文件手写的 emphasis:"quiet" 压过这里——人说不抬就不抬。纯函数，不读库。

export type MilestoneKind = "birth" | "birthday" | "walk" | "tooth" | "words" | "trip" | "first";
export type Milestone = { kind: MilestoneKind; badge: string };

// 顺序即优先级：一天命中多条时取最前面的那条。
const RULES: { kind: MilestoneKind; badge: string; re: RegExp }[] = [
  { kind: "walk", badge: "第一次", re: /迈出了?(独立走路的)?第一步|第一次(自己|独立)?(走路|走了|迈步)|会(自己|独立)?走路了|独立行走/ },
  { kind: "tooth", badge: "出牙", re: /(第[一二两三四五六七八九十\d]+颗|第一颗)牙|(长|冒|出|萌)(出)?了?(第一颗)?(小)?牙|牙(齿)?(冒|爆|长)出来/ },
  { kind: "words", badge: "第一次", re: /第一次(开口)?(叫|喊|说)|(会|开口)(叫|喊)(爸爸|妈妈|奶奶|爷爷|外婆|外公)/ },
  { kind: "trip", badge: "第一次", re: /第一次(坐|乘)(飞机|火车|高铁|动车|船)|第一次(出远门|旅行|旅游|出国)/ },
  { kind: "first", badge: "第一次", re: /第一次|头一回/ },
];

const BIRTH_DAY_DEFAULT = "2025-01-03";

/**
 * @param day       YYYY-MM-DD
 * @param texts     这一天的标题与正文（标题放第一个）；只读引号外的叙述和引号里的原话都算——原话本来就是来源。
 * @param birthDay  出生日期
 */
export function detectMilestone(day: string, texts: readonly (string | null | undefined)[], birthDay: string = BIRTH_DAY_DEFAULT): Milestone | null {
  if (day === birthDay) return { kind: "birth", badge: "出生" };
  if (day.slice(5) === birthDay.slice(5) && day > birthDay) {
    const years = Number(day.slice(0, 4)) - Number(birthDay.slice(0, 4));
    return { kind: "birthday", badge: `${years} 岁生日` };
  }
  const text = texts.filter(Boolean).join("\n");
  for (const rule of RULES) if (rule.re.test(text)) return { kind: rule.kind, badge: rule.badge };
  return null;
}

/** 这一天在月页上该不该抬：手写 quiet 不抬，手写 lead 照旧，里程碑自动抬。 */
export function emphasisWithMilestone(written: unknown, milestone: Milestone | null): "lead" | "quiet" | undefined {
  if (written === "quiet" || written === "lead") return written;
  return milestone ? "lead" : undefined;
}
