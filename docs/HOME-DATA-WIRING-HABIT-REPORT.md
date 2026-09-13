# 给页面轨：习惯提醒露出上报，最小接线（HOME-20260913-DATA）

一句话：**页面真的把默认提醒画出来之后，调一次 `reportHabitShown(feed)`。** 就这一行。

## 接线

```tsx
import { readHomeFeed, reportHabitShown } from "@/lib/home-feed";

export default async function HomePage() {
  await renderOnDemand();
  const feed = await readHomeFeed();

  // 习惯提醒「最多两个不同自然日露出」（§6.3）数的是**实际露出过的日子**，而那是历史，
  // 只能记。这一行就是那次记录。放在这里 = 这次请求确实要把 feed 渲染出去了。
  // 它不抛、不阻塞渲染；记不上一行日志不该让家人看不到首页。
  await reportHabitShown(feed);

  return <div className="home-v2">{/* …照旧… */}</div>;
}
```

就这样。不需要传日期（用的是 `feed.clock.today`，Asia/Shanghai 自然日），不需要挑事项
（数据轨已经在 `feed.reminders.habitShownIds` 里算好了：**只有真的进了默认位、且本身是习惯类的**
那几条）。

## 三条必须守的

1. **只在真的要渲染的那次请求里调。** 不要放在预取、预热、`generateStaticParams`、健康检查、
   或任何「先读一下看看」的地方。那些地方没有人看到任何东西，记上去就是白占配额——
   **一次预热就能把一条习惯提醒的两个自然日用掉，家人一次都没看见它就再也看不到它了。**
2. **一次请求只调一次。** 幂等由数据库唯一键 `(profile_id, item_id, shown_day)` 保证，
   所以多调不会算错，只是白跑一次写入。
3. **不要自己去筛 `shown` 里哪些是习惯类。** 那条规则在数据轨（`classifyFreshness`）。
   页面重新判一次，两边迟早分叉，而分叉的后果是把不该计数的条目记进配额。用 `habitShownIds`。

## 为什么不该调的地方长什么样

| 场景 | 该不该调 | 为什么 |
|---|---|---|
| 家人打开首页，页面渲染出来 | ✅ | 这就是一次露出 |
| 同一个家人当天刷新 20 次 | ✅ 调就行 | 唯一键按**自然日**去重，20 次只留一行 |
| 预取 / 预热 / warmup | ❌ | 没有人看到 |
| 核验脚本、截图脚本、`home-feed-rds-verify.mjs` | ❌ | 它们在测量，不在呈现（这些脚本都没有调它） |
| `reminders.more` 里折叠着的事项 | ❌ 自动不会 | 它们不在 `habitShownIds` 里 |
| `reminders.status !== "ready"` | ❌ 自动不会 | `reportHabitShown` 直接返回，不碰库 |

## 返回值（想记日志的话）

`{ attempted: number; skipped?: string }`。`attempted` 是这次尝试写几条；`skipped` 有值说明
没写以及为什么（没有连接、表还不存在、日期不合法）。**它从不抛。**

## 迁移

表是 `habit_display_days`，迁移 `drizzle/0016_habit_display_days.sql`。
**随统一发布执行，本轮没有在生产库上跑。** 在它跑之前：

- 读回来是空日志 → 上限**不生效**，但**不误伤任何人**（没记过露出就一天都不算）；
- 写入命中 42P01 → 静默跳过并在 `skipped` 里说明。

所以这一行现在接上去就是安全的，迁移跑完它自动开始生效。
