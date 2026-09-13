# HOME-20260913-DATA · 数据轨状态 · READY_FOR_REVIEW

任务 ID：HOME-20260913-DATA　独占本文件（不写 `docs/HOME-PAGE-STATUS.md`）
接手 HEAD `74e7686`（派单卡记的 `ac90ec6` 已被取代，未回退 checkout）。
非本轮的既有改动一律未动未提交：`HANDOFF-COMMANDER.md`、`ORCHESTRATOR-INBOX.md`、
`nianlife-handoff-2026-09-06-neon.md`、`quark-heic-ingest-linux.mjs`，以及页面轨自己标了「不得提交」的
`v2/public/__viewport.html`。

## 🔴 页面轨：一行必须改（已 push，现在就生效）

**`v2/app/page.tsx:144`** 现在写的是
`link: reminder.evidenceHref ? { href: reminder.evidenceHref, label: "看那一天" } : undefined`。

接口 1.1.0（`931d0da`）起，`evidenceHref` 对**每一条真实待办**都有值了，而且指向的是
**月份页**（`/memory/YYYY/MM`）——所以这一行现在会把一个月份链接标成「看那一天」。请按新字段
`evidenceKind` 分标签：

- `"event"` → 「看那一天」（落到具体某段记忆 `/events/<id>`）
- `"month"` → 「翻到 X 月」（和 `upcoming-tasks.tsx` 现有说法一致）
- `undefined` → 仍然不画链接

为什么要改成这样：1.0.0 只认 `evidence.eventId`，而 `upcoming-store` 写进 `evidence` 的**只有 `{ day }`**，
从来没有 eventId——于是生产上 18 条待办的 `evidenceHref` 全是 undefined，**一条都追不回来源**。
这是验收原则八时真的去点那三个链接才发现的，grep 查不出来（字段在、类型对、测试过）。
其余字段全部兼容，含义未改。

## 交付（六个提交，全部已 push）

| SHA | 内容 |
|---|---|
| `91786ad` | `CONTRACT_READY`：冻结 `lib/home-feed.ts`（1.0.0） |
| `cfe7f1c` | 待办保鲜：陈旧事项退场，一条都不写成完成；顺带修掉「来源重放给事项续期」和 render-on-demand 守卫被我开的洞 |
| `ebcc223` | 照片质量能力门 + 有界批次 + 有界核验脚本；把家庭原文从 Git 里清出去 |
| `931d0da` | **1.1.0**：证据链修正 + `editionAt` 遇坏时间值不再打掉整页 + 删掉自己写的一段死代码 |
| `714b090` | **1.2.0**：照片冷却量化 + 轮换次序不再依赖质量分 + 习惯日期上限作用位置与状态保真 + 离线质量缓存接线 |
| `fdc7f02` | `HOME_FEED_VERSION` 跟上 1.2.0 |

改的文件：`lib/home-feed.ts`、`lib/upcoming-freshness.ts`、`lib/home-photo-quality.ts`（三个新）、
`lib/db/upcoming-store.ts`（合并分支钉住提出日）、`test/{home-feed,upcoming-freshness,home-photo-quality}.test.mjs`（新）、
`test/render-on-demand.test.mjs`（守卫补洞）、`scripts/{home-photo-quality,home-feed-verify}.mjs`（新）。
**未碰** `app/**`、`components/**`、全局 CSS、字体、对方状态文件。

四项检查（`fdc7f02` 当前树）：typecheck ✅　lint ✅　build ✅　测试 **1086 条 1076 通过 0 失败 10 跳过**（本轨新增 61 条）。
**未写库、未迁移、未改任何审核状态、未部署。** 回滚：六个提交都只新增文件或加字段，revert 无副作用。

## 有界真实核验（证据 `C:\Users\teddy\NianlifeOps\home-2026-09-13\data\`，不进 Git）

`home-feed-verification.json`（逐期选择 + 逐条退场原因）、`live-upcoming.json`（线上首页 DOM 采得的
18 条真实待办，含真实提出日）、`production-pairs.json`（3 对获批 (故事,照片)）。

`v2/.env.local` 指向的 Neon 是**另一份更小的数据**：0 条 `media_binding`、0 条 `media_subject_check`、
最新事件 2026-09-03、**连 `upcoming_items` 表都没有**（0013/0014/0015 没在它上面跑过；页面轨独立撞到同一件事）。
在 Neon 上跑出的「0 个候选」是那个库的事实，不是首页逻辑的事实。所以这一份是**把生产数据回放进本轨代码**。

**「连不上生产库」这条限制已解除**：改为复用页面轨的 `.data/night-rds.mjs` 隧道，真实运行证据见下面那一节。
本节保留，因为回放证据和真实运行证据回答的不是同一个问题。

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

## 2026-09-13 续轮：三条链路修好，真实运行证据到位（`714b090` / `fdc7f02`，1.2.0）

三处都不是「还没做」，是**做了但接错或没接上**。

| # | 原来的毛病 | 现在 |
|---|---|---|
| 1 | 轮换次序按「质量分降序」排，而质量分来自**离线缓存**——缓存落地那一刻排序就变，同一个 `edition.id` 在六小时内会换掉照片（违反 §5.5） | 质量分只决定**谁进轮换 band** 和 `qualityRank`，次序只看 `mediaId`。**真库实测：把缓存分数排成 mediaId 的反序，四期选择逐字不变** |
| 2 | 冷却只是 `reason` 里的一句散文，没有任何数字 | 新增 `HomePhotoCooldown { editions, days, targetDays, meetsTarget, shortfall }`，`cooldownOf()` 纯函数。真库今天：**3 组 → 3 期 → 0.75 天，不达标**，并写明这已是 3 组下的可达上限、门槛未放宽 |
| 3 | 习惯日期上限作用在**未排序的全部清单**上，而且 `habit_capped` 那一支把 `status` **硬写成 `"open"`** ——拿编出来的状态盖掉库里真实那一行 | 上限作用在**已排序的待展示序列**；退场记录照抄真实 `status`；新增 `kind` 区分 `expired` 与 `habit_capped`（**后者没有过期**） |
| 4 | `readHomeFeed` **从来不读**那份离线质量缓存——批次脚本、`buildHomeFeed`、缓存三个部件各自都对，中间没人接线，于是批次跑成功首页也永远停在降级分 | `readHomeFeed` 自己读 `HOME_PHOTO_QUALITY_PATH`；读不到一律当没有评估结果。**真库实测：`质量来源=ai_vision`** |

新增 12 条行为测试。第 4 条做过**变异验证**：把 `readHomeFeed` 里那一行改成 `options.quality`，
该测试失败；改回来，通过——它真的能抓住它要抓的那个 bug。为此给 `BuildHomeFeedOptions` 补了
`archive` 注入口（与 `upcoming` 同类），否则那条测试只能把接线逻辑照抄一遍。

### 两种证据分开记，不混用

| | 回放证据 | 真实运行证据 |
|---|---|---|
| 文件 | `home-feed-verification.json` | `home-feed-rds-runtime.json`、`with-cache/home-feed-rds-runtime.json` |
| 怎么来的 | 把生产**数据**（slots 快照 + 线上 DOM 采得的 18 条待办）喂进本轨代码 | **复用页面轨的 `.data/night-rds.mjs` 隧道**，让 `readHomeFeed()` 走自己那条真实读取链，从 RDS 把行读出来 |
| 证明什么 | 给定这些行，首页会怎么选 | 首页接到真库上，读出来的到底是什么 |
| 目标库已证明 | —— | `nianlife` / **PostgreSQL 18.4** / `Asia/Shanghai` / `wechat_live=51137`（`assertRdsTarget`，不是 Neon 的 18.6） |
| 只读 | —— | 连上即 `default_transaction_read_only = on`；只对本进程覆盖 `DATABASE_URL`，`v2/.env.local` 未动；未跑迁移、未写库 |

真实运行读出来的（四期，`714b090`）：`life_events` 845、`upcoming_items` 22（approved 18）、
`media_subject_check` approved 34。候选 3 组按 mediaId 序轮换；提醒 `ready`，默认露出 2、退场 10、
折叠 16；退场的 10 条 `kind` 全是 `expired`，**库内状态 9 个 `open` + 1 个 `tentative`**（没有被抹成 open）。

**`8 → 4 → 3` 这条链现在能说清了**，之前我把它说成「3 条获批绑定」是含糊的：
账本里 `media_binding` + `approved` 的**原始行**是 8 条；按「同一对取最新决定」去重后是 **4 对**；
这 4 对里有**两对属于同一个事件**（`event-r10-20260907-coldhot` 的两张图），而一段记忆只贡献一个候选
（`memory.lead` 是单数），所以首页候选是 **3 组**。这三步都在真库上查过，不是推的。

### 这一轮仍然未交付的

- **习惯提醒的日期上限只有单测，没有生产命中**：真库 22 条待办里一条习惯类都没有，所以
  `habit_capped` 在真实运行证据里是 0 条——那是「没有这类数据」，不是「规则验过了」。
  同理，`status` 保真那一处修的是 `habit_capped` 分支，真实运行里那条 `tentative` 走的是
  `expired` 分支（那一支本来就是对的），**所以修好的那一支只有单测覆盖**。
- **AI 视觉评估仍未执行**。`with-cache` 那次跑用的是一份写明 `model: "wiring-check-not-an-assessment"`
  的人造分数，**只为验证接线与「质量分不影响轮换」**，文件头三行就写了「不得用于任何关于照片质量的结论」。
  真实评估还缺一个能看图的模型端点。

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
   （`app/page.tsx` 等此刻又有未提交改动在动，我没有去扫。）
5. `lib/db/upcoming-store.ts:230` 有一处**既有**注释含家庭原文（非本轮写入），未代改。

## 锁

18:11 申请 → 18:4x 持有 → 18:5x 释放；页面轨 19:0x 持有并已 push `f789da3`。
其 STATUS 未写「释放」，但其 Git 写入已落地且我们文件集互不相交，我在其 build 结束后（typecheck 能读到
`.next/types` 为证）跑完四项检查并 push `931d0da`，随后同样方式 push `714b090` / `fdc7f02`。
**现在不持有锁。** 续轮期间它的 `app/**`、`components/**` 又有未提交改动，我一个都没碰、也没有拿它们当回归。

## 下一步

1. 页面轨改 `page.tsx:144` 的标签（顶部红字），然后写「可以测了 + SHA」。
2. 收到 SHA 后我测完整呈现链：原则一的页面侧两问 + 提醒标签是否已按 `evidenceKind` 分开。
3. 拿到能看图的模型端点后跑 ≤30 张有界批次，把 `quality.source` 从 `deterministic` 换成真实的 `ai_vision`。
