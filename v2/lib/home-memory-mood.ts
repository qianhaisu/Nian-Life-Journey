// 一段回忆配哪一首曲子（2026-09-16）。
//
// 用户 2026-09-16：「音轨要求和不同的首页故事内容主题有关，有的欢快有的宁静，iPhone 相册回忆
// 就是这么做的，不是每一段回忆都用相同的音乐。」
//
// ─────────────────────────────────────────────────────────────────────────────
// 这个文件最重要的一条：情绪只能从**档案真的记下来的东西**推出来，不能从照片内容猜
// ─────────────────────────────────────────────────────────────────────────────
//
// 先说三条走不通的路，免得以后有人再走一遍（2026-09-16 对着生产 RDS 查过）：
//
//   · `content_types` —— 全库 1036 条 life_event **全部是 `family`**，没有第二个值。
//   · `tags` —— 同样全库只有 `family` 一个值。
//   · `event_type` / `scopes` —— 全库只有 `moment` / `family`。
//
// 也就是说，库里那几个看起来像"主题分类"的列，一个都没有真的被填成有区分度的东西。
// 拿它们做情绪映射，写出来的代码会长得很像在工作，实际上 1036 天会全部落到同一首曲子上。
//
// 所以依据只有两种，两种都是**已经被记下来的事实**，不是对画面的判断：
//
//   1. 这一天自己的**照片节奏**（metadata，不看画面内容）：
//      拍摄时间跨度、连拍组数、每组多少张。一天从早上 8 点拍到晚上 10 点、平均每组 5 张，
//      和一天只在下午拍了两组、每组 2 张，是两种不同的一天——这是时间戳说的，不是我猜的。
//   2. 这一天**已发布记忆的标题原文**里的实词。标题是人审过、已经发布给家人读的句子
//      （「到了时间，他会自己爬上床」「爸爸说儿子一直在笑」），不是这里生成的。
//
// 配乐不是对孩子下判断。选错了曲子，后果是"这段音乐配得一般"，不是"档案说了一句假话"——
// 这跟配文的标准不一样，配文一个字都不许编（见 lib/home-memory.ts）。但依据仍然要求可追溯：
// 每次判定都带一句 `reason`，写明命中的是哪一条规则、看到的是哪个数字，可以逐条核对。

/** 四种曲子。名字说的是曲子的性格，不是对那一天的评价。 */
export type MemoryMood = "bright" | "tender" | "calm" | "open";

export type MemoryMoodVerdict = {
  mood: MemoryMood;
  /** 人能读的一句话：命中哪条规则、依据的数字或词是什么。写进审计，不显示给家人。 */
  reason: string;
};

/** 判定要用到的、全部来自元数据与已发布标题的输入。没有一项是对画面内容的判断。 */
export type MemoryMoodInput = {
  /** 这一天铺出来的张数（连拍折叠之后）。 */
  slides: number;
  /** 折叠前的总张数，用来算"每组多少张"。 */
  photos: number;
  /** 最早 / 最晚一张的小时（0–23，Asia/Shanghai 墙钟，media.taken_at 的约定）。 */
  firstHour: number;
  lastHour: number;
  /** 这一天已发布记忆的标题原文。可能为空。 */
  titles: readonly string[];
};

/**
 * 词表刻意短、刻意具体，并且只收**动作与场景词**，不收形容词。
 *
 * 为什么不收形容词：「乖」「好」「棒」这类词在这份档案里到处都是（老师的日常反馈），
 * 收进来等于所有日子都命中同一条。动作和场景词才真的把一天彼此分开。
 */
const NIGHT_WORDS = ["睡", "床", "洗澡", "晚安", "夜里", "哄", "奶睡", "关灯"];
const BRIGHT_WORDS = ["笑", "夸", "跳", "跑", "玩", "庆典", "生日", "唱", "拍手", "高兴", "喜欢"];
const OPEN_WORDS = ["出游", "旅游", "公园", "海", "山", "动物园", "出门", "散步", "游泳", "沙滩"];

const hit = (titles: readonly string[], words: readonly string[]): string | undefined =>
  words.find((word) => titles.some((title) => title.includes(word)));

/**
 * 判定顺序即优先级，第一条命中的胜出。顺序本身是有理由的：
 *
 *   夜晚 → 先判，因为它是最不容易判错的一条：晚上 20 点之后还在拍照，这一天的尾巴就是安静的，
 *          不管白天多热闹。曲子跟着家人**现在读到的这一段**走。
 *   出门 → 次之，靠"跨度长 + 组数多"这个**形状**，而不是靠词——一天从早 8 点到晚 10 点、
 *          拍了十组以上，是出门才有的形状，在家的一天拍不出这个跨度。
 *   欢快 → 再次，靠密度（每组张数多 = 连着按快门，通常是在拍一个动起来的人）或明确的动作词。
 *   温柔 → 兜底。**它是默认值，不是"没判出来"**：这份档案里绝大多数是普通的一天，
 *          普通的一天本来就该配一首温柔的曲子，而不是硬塞一个情绪。
 */
export function moodFor(input: MemoryMoodInput): MemoryMoodVerdict {
  const { slides, photos, firstHour, lastHour, titles } = input;
  const spanHours = Math.max(0, lastHour - firstHour);
  const perBurst = slides > 0 ? photos / slides : 0;

  const nightWord = hit(titles, NIGHT_WORDS);
  if (lastHour >= 20) {
    return { mood: "calm", reason: `最后一张拍于 ${lastHour} 点，这一天的尾巴是安静的` };
  }
  if (nightWord) {
    return { mood: "calm", reason: `已发布标题里出现「${nightWord}」` };
  }

  const openWord = hit(titles, OPEN_WORDS);
  if (openWord) {
    return { mood: "open", reason: `已发布标题里出现「${openWord}」` };
  }
  if (spanHours >= 10 && slides >= 10) {
    return { mood: "open", reason: `${firstHour} 点到 ${lastHour} 点、${slides} 组，是出门一整天的形状` };
  }

  const brightWord = hit(titles, BRIGHT_WORDS);
  if (brightWord) {
    return { mood: "bright", reason: `已发布标题里出现「${brightWord}」` };
  }
  if (perBurst >= 7) {
    return { mood: "bright", reason: `平均每组 ${perBurst.toFixed(1)} 张，快门按得密` };
  }

  return {
    mood: "tender",
    reason: `没有命中夜晚/出门/欢快的依据（跨度 ${spanHours} 小时、${slides} 组、每组 ${perBurst.toFixed(1)} 张），按普通的一天配曲`,
  };
}

/** 曲子的静态地址。文件由 scripts/build-memory-music.mjs 生成并提交，运行时不合成。 */
export function trackSrc(mood: MemoryMood): string {
  return `/audio/memory-${mood}.mp3`;
}

/**
 * 屏幕阅读器与播放器上那一行小字读到的曲名。
 *
 * **不是真的歌名**，所以不写成歌名的样子（不加书名号、不署名）——它是一句描述，
 * 说的是"现在放的是哪一种曲子"。设计稿里那个「轻柔钢琴」是示意，不是生产文案。
 */
export const MOOD_LABEL: Record<MemoryMood, string> = {
  bright: "明亮的曲子",
  tender: "温柔的曲子",
  calm: "安静的曲子",
  open: "开阔的曲子",
};
