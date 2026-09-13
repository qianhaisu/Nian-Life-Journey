# 习惯露出上报：最小接口（HOME-20260913-DATA）

> **2026-09-13 更新：上一版在这里给的「在 `app/page.tsx` 里直接 `await reportHabitShown(feed)`」
> 那个服务端页面直调示例已撤回。** 接在哪个时机上不由数据轨决定；这份文档只描述接口本身，
> 以及服务端替调用方兜住了什么。

## 接口

```ts
import { reportHabitDisplay } from "@/lib/home-feed";

const report = await reportHabitDisplay();                       // 服务端自己读一次 feed
const report = await reportHabitDisplay({ feed });               // 已经读好了就传进来，省一次读
const report = await reportHabitDisplay({ feed, claimedItemIds }); // 只声称这几条露出过
```

返回：

```ts
type HabitDisplayReport = {
  day: string;                                   // 服务端自己的上海自然日
  recorded: string[];                            // 真的写进去的事项 id
  rejected: { id: string; reason: string }[];     // 被拒的，带原因
  skipped?: string;                               // 整次没写的原因
};
```

它**从不抛**。

## 服务端校验了什么（所以调用方不需要、也不能替它决定）

| | 谁说了算 |
|---|---|
| **算哪一天** | **只有服务端的产品时钟**（`productToday()`，Asia/Shanghai 自然日）。接口签名里**没有** `day` 这一项——传也传不进去 |
| **哪几条可计数** | 服务端现算：必须此刻真的在默认位（`reminders.shown`）里，**且** `classifyFreshness` 判为习惯类。**不采信 `habitShownIds` 那个预存数组** |
| `claimedItemIds` | **只能收窄，不能放宽**。不在服务端算出的集合里的一律拒，并写明是哪一种：不在本次 feed 里／在默认位但不是习惯类／只折叠在展开里没真的露出 |
| 跨日界的旧 feed | `feed.clock.today !== productToday()` → **整次拒掉**。那份 feed 说的「露出」属于昨天，不往今天记 |
| 同一天重复调用 | 数据库唯一键 `(profile_id, item_id, shown_day)` + `on conflict do nothing`。多调只是白跑一次写入，不会算错 |

为什么把这些收到服务端：**配额只有两个自然日，写错一次就少一天。** 日期给错（调用方自己算了一次
`new Date()`，或拿了一份跨日界的旧 feed）会往错误的那天插一行，而唯一键正是那一天；事项给错（折叠项、
非习惯类、或一份陈旧的 `habitShownIds`）会让一条家人从没看见的提醒白占一个自然日。这两件事都不该
取决于调用点写得对不对。

## 如果上报点是一个 route handler（页面轨 2026-09-13 选的形状）

页面轨把记账挪到了浏览器里那块提醒真的进视口之后，再 POST 给
`app/api/internal/habit-shown`。**那正好是这个接口要兜的场景**：请求体里的 id 来自浏览器，
不可信。整个 handler 是三行——

```ts
const { itemIds } = await request.json();
const report = await reportHabitDisplay({ claimedItemIds: itemIds });
return Response.json(report);
```

浏览器**加不进任何一条**：`claimedItemIds` 只能收窄，服务端会把不够格的逐条拒掉并写明原因；
日期根本不经过请求体。**所以 handler 里不需要再自己算一遍 `allowed` 集合**——
两处各判一次，迟早会分叉，而分叉的那一天就是一条没人看见的提醒开始占配额。
需要看拒了什么，读返回值里的 `rejected`。

## 仍然要由调用方负责的一件事

**只在「这一次真的把默认提醒呈现给人看了」时调它。** 服务端能校验「这几条此刻够不够格被计数」，
但**没法知道这次请求的结果有没有真的被人看到**——预取、预热、健康检查、截图与核验脚本都能构造出
一份完全合格的 feed。那些地方调它，就是在没有人看到任何东西的情况下消耗配额。

所以：接入点必须对应一次真的被人看到的呈现。页面轨选的「进视口后再上报」比 SSR 里直调更接近
这个意思——SSR 跑完不代表有人看到。**本轮不替页面轨选这个点**，数据轨也没有新增任何路由或入口。

## 迁移：**已应用**（2026-09-13 更新）

表 `habit_display_days`，迁移 `drizzle/0016_habit_display_days.sql`（由 `drizzle-kit generate` 生成，
`meta/_journal.json` 与 `meta/0016_snapshot.json` 一并更新）。

**已由页面轨正式应用到 RDS。** 数据轨只读复核过：表存在、两个索引都在、
`drizzle.__drizzle_migrations` 计数 17，最新一条的 `when` 与本仓库 0016 的 journal 条目逐位相同。
**发布记录写「已应用」，不要再写「迁移未执行」。** 本轮没有重跑迁移，也没有重建该表。

留一句以防回滚到未应用状态：那时读回空日志 → 上限不生效但**不误伤任何人**
（没记过露出就一天都不算）；写入命中 42P01 → `skipped` 里说明，不抛。
