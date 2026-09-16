// 照片的**主题标注**缓存（2026-09-16，Teddy：「主题把年去掉，换成玩水，睡觉，笑等主题。
// 选片也选和主题有关的。」「确认选的是最有价值的图片。」）。
//
// ─────────────────────────────────────────────────────────────────────────────
// 为什么是缓存文件，不是渲染时查库
// ─────────────────────────────────────────────────────────────────────────────
//
// 标注本身由一个离线有界批次跑（视觉模型逐张看图），结果写进 content_quality_reviews
// （target_kind='media_topic'），再导出成这个 JSON 随仓库发布。首页只读这个文件。
// 理由是 CLAUDE.md 里那条：**页面渲染路径不新增数据库读取**（loadFamilyArchive 误接
// getOrganizerStore 那次，一天多花了 $87 出站流量）。lib/home-photo-quality.ts 是同一个做法。
//
// ─────────────────────────────────────────────────────────────────────────────
// 读不到缓存会发生什么：主题回忆消失，天与季节照常
// ─────────────────────────────────────────────────────────────────────────────
//
// 缓存缺失时 `topicLookup` 对每一张都返回 undefined。后果是明确的、也是想要的：
//   · 「玩水 / 睡觉 / 笑」这类主题**一段都不出**——不知道画面里是什么，就不能说这是一段玩水的回忆；
//   · 「某一天 / 某个季节」照常出，因为它们的依据是日期事实，不是画面判断；
//   · 选片退回按时间均匀取，而不是假装有价值分。
// 也就是说：没有依据的时候，少说话，而不是猜。
//
// **`why` 不在这份缓存里。** 批次里模型会写一句「在泳池里笑」这样的画面描述，那是关于一个孩子的
// 照片内容；选片用不到它，所以它留在账本里可审计，不随代码分发（隐私红线：儿童照片按敏感数据处理）。

/** 批次用的主题词表。`其他` 是兜底，不拿来做一段回忆。 */
export type PhotoTopic = "玩水" | "睡觉" | "笑" | "吃饭" | "户外" | "玩玩具" | "抱着" | "其他";

/** 一张照片的标注。四项缺一不可——导出时就已经按这条筛过了。 */
export type PhotoTopicLabel = {
  topic: PhotoTopic;
  /** 画面里有没有水。**和 topic 互相独立**：在泳池里笑，topic 是「笑」，water 仍然是 true。 */
  water: boolean;
  /** 这张值不值得放进一段回忆给家人看，0–1。 */
  value: number;
  /** 对 topic 判断的把握，0–1。**不管 water**（water 是另一个问题）。 */
  confidence: number;
};

export type PhotoTopicCache = {
  model: string;
  promptVersion: string;
  assessedAt: string;
  scope: string;
  topics: Record<string, PhotoTopicLabel>;
};

/** mediaId → 标注；查不到返回 undefined（**不返回一个 0 分**，那是两句不同的话）。 */
export type PhotoTopicLookup = (mediaId: string) => PhotoTopicLabel | undefined;

/** 读不到缓存时用的空 lookup。 */
export const NO_TOPICS: PhotoTopicLookup = () => undefined;

const TOPICS: ReadonlySet<string> = new Set<PhotoTopic>([
  "玩水", "睡觉", "笑", "吃饭", "户外", "玩玩具", "抱着", "其他",
]);

/**
 * 严格校验一条标注。**缺字段、类型不对、分数越界，一律当没有这条**，不用默认值补齐。
 *
 * 补默认值是最容易滑进去的伪造：一条只有 topic 的记录被补成 `value: 0` 之后，长得和一次
 * 真实评估一模一样，只是分低——没有任何字段说那一项其实没人评过。
 */
function validLabel(raw: unknown): PhotoTopicLabel | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const { topic, water, value, confidence } = record;
  if (typeof topic !== "string" || !TOPICS.has(topic)) return undefined;
  if (typeof water !== "boolean") return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return undefined;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return undefined;
  return { topic: topic as PhotoTopic, water, value, confidence };
}

/** 缓存 → lookup。缓存本身不合格（缺 model / promptVersion / topics）时返回空 lookup。 */
export function topicLookupFrom(cache: PhotoTopicCache | undefined): PhotoTopicLookup {
  if (!cache || !cache.topics || typeof cache.topics !== "object") return NO_TOPICS;
  if (!cache.model || !cache.promptVersion) return NO_TOPICS;
  const table = cache.topics;
  return (mediaId: string) => validLabel(table[mediaId]);
}

// ─────────────────────────────────────────────────────────────────────────────
// 读缓存的代码**不在这个文件里**，这是故意的
// ─────────────────────────────────────────────────────────────────────────────
//
// 见 lib/home-memory-topics-load.ts。这个文件必须保持**纯 TypeScript、零 node 依赖**，
// 因为它被 lib/home-memory.ts 引用，而后者又被 components/home-memory.tsx（"use client"）引用。
// 一旦这里出现 `node:fs/promises`，整条链就把它拖进客户端打包，构建直接失败：
//
//   Import trace: node:fs/promises -> ./lib/home-memory-topics.ts
//                 -> ./lib/home-memory.ts -> ./components/home-memory.tsx
//
// 那份 358KB 的 JSON 同理——它只能在服务端读，不能进客户端产物。
// 要加读文件、读环境变量、读数据库的代码，加到 -load 那个文件里，不要加回这里。
