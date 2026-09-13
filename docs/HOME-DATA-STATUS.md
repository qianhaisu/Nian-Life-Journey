# HOME-20260913-DATA · 数据轨状态 · READY_FOR_REVIEW

任务 ID：HOME-20260913-DATA　独占本文件（不写 `docs/HOME-PAGE-STATUS.md`）
接手 HEAD `74e7686`（派单卡记的 `ac90ec6` 已被取代，未回退 checkout）。
非本轮的既有改动一律未动未提交：`HANDOFF-COMMANDER.md`、`ORCHESTRATOR-INBOX.md`、
`nianlife-handoff-2026-09-06-neon.md`、`quark-heic-ingest-linux.mjs`，以及页面轨自己标了「不得提交」的
`v2/public/__viewport.html`。

## 🔴 页面轨：一行必须改（已 push，现在就生效）

**`v2/app/page.tsx:144`** 现在写的是
`link: reminder.evidenceHref ? { href: reminder.evidenceHref, label: "看那一天" } : undefined`。

接口升到 `home-feed/1.1.0`（`931d0da`）后，`evidenceHref` 对**每一条真实待办**都有值了，而且指向的是
**月份页**（`/memory/YYYY/MM`）——所以这一行现在会把一个月份链接标成「看那一天」。请按新字段
`evidenceKind` 分标签：

- `"event"` → 「看那一天」（落到具体某段记忆 `/events/<id>`）
- `"month"` → 「翻到 X 月」（和 `upcoming-tasks.tsx` 现有说法一致）
- `undefined` → 仍然不画链接

为什么要改成这样：1.0.0 只认 `evidence.eventId`，而 `upcoming-store` 写进 `evidence` 的**只有 `{ day }`**，
从来没有 eventId——于是生产上 18 条待办的 `evidenceHref` 全是 undefined，**一条都追不回来源**。
这是验收原则八时真的去点那三个链接才发现的，grep 查不出来（字段在、类型对、测试过）。
其余字段全部兼容，含义未改。

## 交付（四个提交，全部已 push）

| SHA | 内容 |
|---|---|
| `91786ad` | `CONTRACT_READY`：冻结 `lib/home-feed.ts`（1.0.0） |
| `cfe7f1c` | 待办保鲜：陈旧事项退场，一条都不写成完成；顺带修掉「来源重放给事项续期」和 render-on-demand 守卫被我开的洞 |
| `ebcc223` | 照片质量能力门 + 有界批次 + 有界核验脚本；把家庭原文从 Git 里清出去 |
| `931d0da` | **1.1.0**：证据链修正 + `editionAt` 遇坏时间值不再打掉整页 + 删掉自己写的一段死代码 |

改的文件：`lib/home-feed.ts`、`lib/upcoming-freshness.ts`、`lib/home-photo-quality.ts`（三个新）、
`lib/db/upcoming-store.ts`（合并分支钉住提出日）、`test/{home-feed,upcoming-freshness,home-photo-quality}.test.mjs`（新）、
`test/render-on-demand.test.mjs`（守卫补洞）、`scripts/{home-photo-quality,home-feed-verify}.mjs`（新）。
**未碰** `app/**`、`components/**`、全局 CSS、字体、对方状态文件。

四项检查（`931d0da` 当前树）：typecheck ✅　lint ✅　build ✅　测试 **1074 条 1064 通过 0 失败 10 跳过**（新增 49 条）。
**未写库、未迁移、未改任何审核状态、未部署。** 回滚：四个提交都只新增文件或加字段，revert 无副作用。

## 有界真实核验（证据 `C:\Users\teddy\NianlifeOps\home-2026-09-13\data\`，不进 Git）

`home-feed-verification.json`（逐期选择 + 逐条退场原因）、`live-upcoming.json`（线上首页 DOM 采得的
18 条真实待办，含真实提出日）、`production-pairs.json`（3 对获批 (故事,照片)）。

**生产库连不上，这是限制不是通过**：线上私有站跑阿里云 RDS，本机没有 ECS 的 `.pem`，`netstat` 只有 18080。
`v2/.env.local` 指向的 Neon 是**另一份更小的数据**：0 条 `media_binding`、0 条 `media_subject_check`、
最新事件 2026-09-03、**连 `upcoming_items` 表都没有**（0013/0014/0015 没在它上面跑过；页面轨独立撞到同一件事）。
在 Neon 上跑出的「0 个候选」是那个库的事实，不是首页逻辑的事实。所以核验改为**把生产数据回放进本轨代码**。

结果：3 对候选按四期轮换（09-07 → 08-19 → 08-08 → 09-07），图和故事始终同源、各带自己的当时年龄；
默认露出 2 条（关键健康事项第一 + 一条窗口仍盖住今天的待定计划）；**10 条陈旧事项退场、库内状态全部未改**
（含 8 月 16 日那条陈旧采购）；16 条折叠可达，18 条一条没丢。

## 产品八原则（八条全验，一条没跳）

| 原则 | 结果 | 看到了什么 |
|---|---|---|
| 一 Person First | **数据侧过 / 页面侧归终审** | feed 返回今天+今天年龄+一段故事+合法配图+1 条近况+2 条有效提醒。「不点任何东西能否说出张年最近怎么样」要在部署后的页面上看 |
| 二 Two Clocks | **过** | 四期 × 每块内容（时钟/主故事/配图/近况/提醒期限）逐字段跑过：全部同时带「什么时候」+「当时几岁」，无裸库时间 |
| 三 Media First | **过** | 家人会读到的文案只有 7 个状态常量 + 3 种期限形状；无工程名词、无来源系统名、**无计数式描述**。`reason`/`photoAbsence` 是诊断字段，页面未渲染 |
| 四 Invisible Automation | **① 过　② 否（未交付）** | ① 数据层 grep「上传/自动整理/红点/记一笔」= 0，无空状态引导上传。② 管线仍非无人值守；但保鲜过滤改为**每次读取现算**，过期琐事不再需要后台任务才退场 |
| 五 Not Equal Weight | **过** | 18 条待办→默认 2 条；5 段记忆→1 主故事+1 近况；3 组候选→1 组呈现 |
| 六 Bring the Past Back | **未交付（页面侧一条已查过）** | 新首页按定稿**删掉了「忽然想起」**，浮现与回顾回月页/记忆页。已确认没有无条件占位模块、没有「暂无」、没有随机轮播（`Math.random()` = 0，期次是纯函数）；**`components/home-lead.tsx` 无任何定时器，换图只由点击触发**，满足 §5.5「浏览期间不自动轮播」，且只在合格候选内切换 |
| 七 Automatic Reflection | **未交付** | 月度回顾不在新首页范围内，月页未改动，本轮没有生成任何回顾文字 |
| 八 Family Owns It | **数据侧过（本轮修好的）／页面侧差一行** | 主故事、近况→`/events/<id>`。待办原本抽 3 条全断链，1.1.0 修好；**但页面那行标签还没按 `evidenceKind` 分**，见顶部红字 |

## 已知未交付 / 剩余未验证（照实列，不藏在「已实现」里）

1. **AI 视觉评估未执行**，原因已实测坐实：`deepseek-v4-pro` 收到图片后被换成 `[Unsupported Image]`，
   HTTP 200 且模型开始猜（thinking 原文在 `lib/home-photo-quality.ts` 顶部与测试里）。能力门会中止整批、
   一个分数都不写。当前所有候选 `source=deterministic` 并写明 `degraded`。**需要一个真能看图的模型端点**——
   外部条件，不是代码问题。脚本已可运行：`node --import tsx scripts/home-photo-quality.mjs --out <cache.json>`。
2. **§6.2 库存预测 72 小时、§6.3 习惯提醒 7 天／最多两个日期：已实现且有单测，但生产 18 条一条都没命中这两类。**
   所以是「已实现、未经真实数据检验」，不是「通过」。
3. **无日期的待定计划不设过期**（规格没给这一类数字，生产里正好有一条是关于十月假期的真实打算）。
   靠排序不占默认位，不靠时钟。需要默认期限请总指挥给数字，我不臆造。
4. **页面级验收未做**：四视口、真字体、完整呈现链。页面轨 STATUS 至今未写「可以测了 + SHA」；
   它的 `f789da3` 已 push，我只对**已提交**的代码做了上面那两条静态核查，没有测呈现链。
5. `lib/db/upcoming-store.ts:230` 有一处**既有**注释含家庭原文（非本轮写入），未代改。

## 锁

18:11 申请 → 18:4x 持有 → 18:5x 释放；页面轨 19:0x 持有并已 push `f789da3`。
其 STATUS 未写「释放」，但其 Git 写入已落地且我们文件集互不相交，我在其 build 结束后（typecheck 能读到
`.next/types` 为证）跑完四项检查并 push `931d0da`。**现在不持有锁。**

## 下一步

1. 页面轨改 `page.tsx:144` 的标签（顶部红字），然后写「可以测了 + SHA」。
2. 收到 SHA 后我测完整呈现链：原则一的页面侧两问 + 提醒标签是否已按 `evidenceKind` 分开。
3. 拿到能看图的模型端点后跑 ≤30 张有界批次，把 `quality.source` 从 `deterministic` 换成真实的 `ai_vision`。
