// 近期待办 — the prompt and the one model call behind it.
//
// Nothing here decides anything about the archive: it turns one (conversation, day) of messages
// into candidate items, and lib/upcoming-merge.ts decides what the evidence actually supports.
// The rules in the prompt are Teddy's, restated for a reader who only sees one day at a time.
//
// Two things in this file were learned the hard way on 2026-09-12 and are load-bearing:
//   - messages are labelled m1, m2, … not by their real raw_source id. Asked to echo back ids like
//     `wechat-message:canonical:5c78c17c…` (74 hex characters) the model got them wrong often
//     enough that 13 of the first 30 days produced items citing messages that did not exist.
//   - an adult's own appointment is not the child's todo. Without that said explicitly, the
//     mother's own hospital booking came back as a commitment about 张年.

export const UPCOMING_PROMPT_VERSION = "upcoming-extract-v1";

export const UPCOMING_SYSTEM_PROMPT = `你在读一个家庭的微信记录，只找一件事：**这家人接下来要做什么**，而且是**和张年（小年、年年、宝宝、宝贝、崽）有关的**。

你不是在写故事，不是在总结这一天，也不是在评价。你只回答：这一天的消息里，出现了哪些**有行动含义**的事项，以及有没有哪条消息**改变了**之前已经在跑的事项。

## 什么算事项

**确定待办（commitment）**：有人明确要求、承诺或安排了一件具体的事。
例：老师说「明天带一双干净鞋子」；妈妈说「我周三带他去打疫苗」；「后天家长会，一位家长参加」。

**待定计划（plan）**：在认真讨论、但还没定下来的安排。
例：「国庆想带他去大湾区」「要不要给他约个体检」。

**都不算**：
- 泛泛的建议、随口的愿望、原则性的话（「以后要多带他出去玩」「该补钙了」）
- 已经在做的日常（每天喝奶、睡觉）
- 别人家孩子的事，或与张年无关的家务
- 只是在描述已经发生的事（「今天带他去打了疫苗」——这是记录，不是待办；但如果它是**之前某个待办**的完成证据，用 statusUpdates 报）
- **大人自己的事。** 这一条最容易错：妈妈自己看病、爸爸自己出差、大人自己的体检和会议，**都不是张年的待办**，
  即使就在同一段对话里、即使会影响谁来带他。只有当这件事**本身就是为他做的**（带他去打疫苗、给他约体检、
  替他向托班请假），才算。**拿不准这件事是不是为他做的，就不要报。**

## 时间怎么写

- 能从这一天的日期算出确切日期的（明天、后天、周三、下周一、9 月 20 号），算出来写成 \`YYYY-MM-DD\`，并把依据写进 \`whenBasis\`。
- 是一段时间的（国庆假期、下周），写 \`fromDay\` 和 \`toDay\`。
- **算不出来的就写 \`unconfirmed\`，并把原话放进 \`whenOriginalText\`。绝对不要猜一个日期。**
- 今天的日期会在下面给你。相对日期一律相对它算。

## 状态更新怎么报

如果这一天的消息**明确针对前面已经存在的某个事项**（会在下面列给你），用 \`statusUpdates\` 报，不要重新建一个事项：

- \`rescheduled\`：改期。必须同时给改之前和改之后的时间。
- \`cancelled\`：取消、不去了、不办了。
- \`done\`：**明确证明这件事做完了**。
  - 「已经带过去了」「今天带他打完了」「体检做完了」算。
  - **日期过去了、没人再提、那天有照片——都不算。**
  - 复查做完 ≠ 病好了。只报「复查做完了」。
- \`restated\`：同一件事又被提了一遍（老师连着三天提醒带鞋子）。报这个，不要新建。

**拿不准就不要报状态更新。** 宁可让一个事项继续开着，也不要错误地划掉它。

## 合并

同一件事才合并。**不同日期的复查、不同的出游，主题相同也不是同一件事。**
只有当消息本身说明它们是同一件事（同一次预约、同一个日期、同一个「那个」）才算。

## 输出

没有事项就返回空数组。**空不是失败**，绝大多数普通的一天本来就没有待办。`;

export const UPCOMING_TOOL_NAME = "report_upcoming";

export const UPCOMING_TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items", "statusUpdates"],
  properties: {
    items: {
      type: "array",
      description: "这一天新出现的事项。没有就是空数组。",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "kind", "when", "anchorMessageId", "sourceMessageIds", "whoAsked"],
        properties: {
          title: { type: "string", description: "要做的事，短，像「带干净鞋子」，不是一句话，也不是原消息。**标题里不要写时间**（不要「明天…」「周六…」）——日期在 when 里，标题只写做什么。" },
          note: { type: "string", description: "一行必要上下文，没有就省略。不要抄聊天原文。" },
          category: { type: "string", description: "托育 / 就医 / 出游 / 采买 / 家庭安排 / 其他" },
          kind: { type: "string", enum: ["commitment", "plan"], description: "确定待办 or 待定计划" },
          when: {
            type: "object",
            additionalProperties: false,
            required: ["kind"],
            properties: {
              kind: { type: "string", enum: ["day", "window", "unconfirmed"] },
              day: { type: "string", description: "YYYY-MM-DD" },
              fromDay: { type: "string", description: "YYYY-MM-DD" },
              toDay: { type: "string", description: "YYYY-MM-DD" },
            },
          },
          whenBasis: { type: "string", description: "怎么算出来的，例如「消息发于 2026-09-03，说『明天』」" },
          whenOriginalText: { type: "string", description: "算不出日期时，原话照抄" },
          whoAsked: { type: "string", description: "谁提出的，用给你的说话人标签；不确定写「未命中」" },
          anchorMessageId: { type: "string", description: "最能代表这件事的那一条消息编号，例如 m12" },
          sourceMessageIds: { type: "array", items: { type: "string" }, description: "支持这件事的消息编号，例如 [\"m12\",\"m13\"]" },
          quote: { type: "string", description: "最关键的一句原话，短" },
        },
      },
    },
    statusUpdates: {
      type: "array",
      description: "对前面已存在事项的改变。没有就是空数组。",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["openItemId", "change", "sourceMessageIds"],
        properties: {
          openItemId: { type: "string", description: "下面「还开着的事项」里给你的编号" },
          change: { type: "string", enum: ["rescheduled", "cancelled", "done", "restated"] },
          newWhen: {
            type: "object",
            additionalProperties: false,
            properties: {
              kind: { type: "string", enum: ["day", "window", "unconfirmed"] },
              day: { type: "string" }, fromDay: { type: "string" }, toDay: { type: "string" },
            },
          },
          note: { type: "string", description: "一行说明，例如「改到 9 月 20 日」「老师说已带到」" },
          quote: { type: "string", description: "证明这个改变的那句原话，短" },
          sourceMessageIds: { type: "array", items: { type: "string" }, description: "证明这个改变的消息编号" },
        },
      },
    },
  },
} as const;

export type UpcomingUnit = {
  day: string;
  messages: Array<{ id: string; t: string; who: string; text: string; media: number }>;
};

export type CarriedItem = {
  _ref: string;
  title: string;
  kind: string;
  when: { kind: string; day?: string; fromDay?: string; toDay?: string };
  firstSeenDay: string;
};

/** One day of one conversation, plus whatever is still open, as the model sees it. */
export function buildUnitPrompt(unit: UpcomingUnit, carried: CarriedItem[]): string {
  const lines: string[] = [];
  lines.push(`## 今天是 ${unit.day}（Asia/Shanghai）。所有相对日期相对这一天算。`, "");
  lines.push("## 这一天，这个会话里的消息", "");
  unit.messages.forEach((message, index) => {
    const body = message.text || (message.media ? "（发了图片/视频，无文字）" : "（空）");
    lines.push(`[m${index + 1}] ${message.t} ${message.who}：${body}`);
  });
  lines.push("");
  if (carried.length) {
    lines.push("## 还开着的事项（如果今天的消息改变了其中某一个，用 statusUpdates 报，不要新建）", "");
    for (const item of carried) {
      const when = item.when.kind === "day" ? item.when.day
        : item.when.kind === "window" ? `${item.when.fromDay}→${item.when.toDay}`
          : "时间待确认";
      lines.push(`[${item._ref}] ${item.title}（${item.kind === "commitment" ? "确定待办" : "待定计划"}，${when}，来自 ${item.firstSeenDay}）`);
    }
  } else {
    lines.push("## 还开着的事项：无");
  }
  return lines.join("\n");
}

export type UpcomingExtraction = {
  items?: Array<Record<string, unknown>>;
  statusUpdates?: Array<Record<string, unknown>>;
};

/** One bounded call. Fails closed on configuration, aborts at 90 s, and exits on 402 rather than
 *  retrying against an account that cannot pay. Retries are the caller's business. */
export async function extractFromUnit(prompt: string, env: NodeJS.ProcessEnv = process.env): Promise<UpcomingExtraction> {
  const model = env.AI_MODEL;
  const apiKey = env.DEEPSEEK_API_KEY;
  if ((env.AI_PROVIDER ?? "").toLowerCase() !== "deepseek" || !apiKey || !model) {
    throw new Error("upcoming extractor: AI_PROVIDER must be deepseek with DEEPSEEK_API_KEY and AI_MODEL set");
  }
  const baseUrl = (env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/anthropic").replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      signal: controller.signal,
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model, max_tokens: 4000, temperature: 0, thinking: { type: "disabled" },
        system: UPCOMING_SYSTEM_PROMPT,
        tools: [{ name: UPCOMING_TOOL_NAME, description: "报告这一天里与张年有关的待办事项与状态更新", input_schema: UPCOMING_TOOL_SCHEMA }],
        tool_choice: { type: "tool", name: UPCOMING_TOOL_NAME },
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (response.status === 402) throw new Error("deepseek_402_insufficient_balance");
    if (!response.ok) throw new Error(`http_${response.status}`);
    const payload = await response.json() as { content?: Array<{ type: string; name?: string; input?: UpcomingExtraction }> };
    const block = payload.content?.find((part) => part.type === "tool_use" && part.name === UPCOMING_TOOL_NAME);
    if (!block?.input) throw new Error("no_tool_use");
    return block.input;
  } finally { clearTimeout(timer); }
}
