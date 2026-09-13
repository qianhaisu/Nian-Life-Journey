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

## 交付（十个提交，全部已 push）

| SHA | 内容 |
|---|---|
| `91786ad` | `CONTRACT_READY`：冻结 `lib/home-feed.ts`（1.0.0） |
| `cfe7f1c` | 待办保鲜：陈旧事项退场，一条都不写成完成；顺带修掉「来源重放给事项续期」和 render-on-demand 守卫被我开的洞 |
| `ebcc223` | 照片质量能力门 + 有界批次 + 有界核验脚本；把家庭原文从 Git 里清出去 |
| `931d0da` | **1.1.0**：证据链修正 + `editionAt` 遇坏时间值不再打掉整页 + 删掉自己写的一段死代码 |
| `714b090` | **1.2.0**：照片冷却量化 + 轮换次序不再依赖质量分 + 习惯日期上限作用位置与状态保真 + 离线质量缓存接线 |
| `fdc7f02` | `HOME_FEED_VERSION` 跟上 1.2.0 |
| `12dd1df` | **1.5.0**：撤回页面直调示例，上报口改为服务端校验事项与日期 |
| `c0191d5` | **1.4.0**：资格过滤移到连拍去重之前 + `habit_display_days` 表/迁移/store + 露出上报口 |
| `2798593` | **1.3.0**：轮换池与页面上限分开 + 期内选片固定（新候选/新评分下一期生效）+ 习惯上限改按实际展示日计数 |

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

## 2026-09-13 第三轮：轮换池与页面上限分开；习惯上限改按实际展示日计数（1.3.0）

缓存接线已通过代码审核，本轮只修剩下两条。

### 1 · 轮换池 ≠ 页面上限

上一版把「进轮换」和「返回给页面」用**同一个 6** 去截，于是档案里就算有 20 组合格候选，
同一张照片也每 6 期（1.5 天）就回来一次——**冷却被一个呈现参数按住了**。现在：

- **轮换池 = 全部合格候选，不设上限**；`cooldown.editions` 就是池子大小。
- **返回给页面最多 6 条**，当期选中的那条永远排第一、永远在清单里。
- 池子有多大，看 `cooldown.editions`（清单长度不再是那个数）。

实测（单测）：20 组候选 → 冷却 **20 期 / 5 天**（旧版是 6 期 / 1.5 天），整轮 20 期内 20 张各出现
恰好一次、第 21 期才回到第一张、相邻期次无重复。

### 2 · 同一期内选片固定，质量更新与新增候选都从下一期生效

两条都用**真实时间戳**兑现，不是靠约定：

| 变化 | 何时生效 | 凭什么 |
|---|---|---|
| 新候选通过审核 | **下一期** | 该对最近一次 approved 的 `reviewedAt` 必须 `< edition.startedAt`（`approvedBindingTimes()` 从档案已带的账本现算，不额外读库） |
| 视觉评分落地/重评 | **下一期** | `ai_vision` 的 `assessedAt` 必须 `< edition.startedAt`，否则本期按确定性降级分处理，并在 `degraded` 里写明原因 |
| **撤销展示资格** | **立刻** | 唯一的例外（§5.7）：候选每次从当前档案现算，撤掉的根本不在池子里 |

为什么不去改 `lib/media/story-binding.ts`：那是全站媒体判据，本轮规矩是复用不重构。这里要的不是
「能不能展示」（`memory.lead` 已经判过），只是「什么时候批的」，键的格式借它导出的 `storyPhotoKey`。

新增测试：超过 6 个候选、评分正好跨越第 6/7 名、期内新增候选、期内落地的评分、撤销仍立刻生效、
以及「实际冷却就是整轮」。

### 3 · 习惯上限改按**实际展示过的自然日**计数

上一轮改对了作用位置和状态保真，但**计数仍然用 `raisedOn`** ——那是这件事**被说起**的那天，
和它**在首页露过脸**的日子毫无关系。一条 9 月 8 日提起的习惯提醒可能一次都没露出过，也可能连着
露了五天；按 `raisedOn` 数，前者被算成「已用掉一个日期」，后者被算成「才用掉一个」——两种都错，
而且错得反方向。

现在 `capHabitByShownDays(entries, today, log)`：今天露过 → 放行（**同一天刷多少次都只占一个自然日**）；
今天没露过且已经露过 2 个不同的日子 → 拦下（**第三个自然日起不占默认位**）；**没露出过 → 一天都不算**。
拦下 ≠ 过期 ≠ 完成，退场记录照抄库里真实 `status`，`kind = habit_capped`。

**这一条有一个必须说清的限制**：「露出过哪些自然日」是历史，算不出来，只能记。本轮把它做成
`HabitDisplayLog` 端口，默认是空日志（`NO_HABIT_DISPLAY_LOG`）——所以**规则已实现并被测到，但在生产
里还不生效**，因为还没有一个可写的存储接在上面。接哪里（`upcoming_items` 加列 = 迁移，还是像质量
缓存那样落文件）需要定，我没有自己扩这个范围。空日志下它**不会误伤任何人**：没记过露出就一天都不算。

### 本轮真实运行证据

`round3/home-feed-rds-runtime.json`（同一条隧道、同样只读、目标库指纹已证明）。今天生产只有 **3 组**
候选，所以池子就等于清单，冷却 3 期 / 0.75 天，与上一轮逐字相同——**新增的「超过 6 个候选」那条路
在生产上没有数据可走，只有单测覆盖**。三条候选的 `reviewedAt` 都早于今天各期开始时间，所以新的
「期内新增下一期生效」这道闸没有误拦任何一条（四期候选数都是 3）。

## 2026-09-13 收口轮：过滤顺序、露出日持久化（1.4.0）

### 1 · 本期资格过滤移到连拍去重之前

顺序反了会出假阴性：一组连拍里有一张旧的（本期可用）和一张本期刚获批的，连拍去重按 mediaId 取组
代表，**如果取中的是那张新的，随后资格过滤又把它拿掉，这一组在本期就一张都不剩**——那张本来合格
的旧照片已经作为「同组重复」被丢掉了。家人看到「这组没有照片」，真相是「合格的那张被一张本期还
不能用的照片挤掉了」。这正是 `photoLedMoment` 那次教训的同一形状，我上一版又踩了一遍。

现在：先按资格分 eligible / pending，**再**在 eligible 里做连拍去重。新测试
「期内新批准的同组照片不挤掉本期那张旧照片」做过**变异验证**——把顺序换回去，该测试失败。
它同时断言两件事分得清：新的那张 reason 是「资格」而非「连拍重复」；**下一期**它有资格后，
才轮到连拍去重管它。

### 2 · 露出日改用独立 RDS 表持久化

| | |
|---|---|
| 表 | `habit_display_days`（`lib/db/schema.ts`） |
| 迁移 | `drizzle/0016_habit_display_days.sql`，**由 `drizzle-kit generate` 生成**，`meta/_journal.json` 与 `meta/0016_snapshot.json` 一并更新 |
| 唯一键 | `(profile_id, item_id, shown_day)`，`shown_day` 是**上海自然日**；插入 `on conflict do nothing` |
| 只增不删 | 一条露出记录是发生过的事 |
| 读 | `readHabitDisplayDays(itemIds)` —— 只问本次要判的那几个 id，`where profile_id = ? and item_id in (…)`，无整表扫描 |
| 写 | `recordHabitShown(itemIds, day)`；对外只暴露 `reportHabitDisplay()`（见下一节，服务端校验） |

**我先手写了一份 0016.sql，然后发现它不在 `meta/_journal.json` 里——`drizzle-kit migrate` 会直接
跳过它，发布会「成功」而表根本不存在。** 已改为用 `drizzle-kit generate` 生成，journal 与 snapshot
都对上；缺 snapshot 还会让下一次 `db:generate` 把这张表再 diff 出来一遍。

**只记真正呈现的。** `feed.reminders.habitShownIds` 只包含**进了默认位、且本身是习惯类**的那几条；
`more` 里折叠着的一条都不在，非习惯类也不在。`reportHabitShown` 由页面在真的渲染那一次调用；预取、
预热、核验脚本、截图脚本都没有调它（本轨那两个 RDS 脚本也没有）。判「哪一类算习惯」的规则留在数据轨，
不让页面重判一次——重判迟早分叉，而分叉的后果是把不该计数的条目记进配额。

日期用 `feed.clock.today`（Asia/Shanghai 自然日），**不在写入处取 `new Date()`**：那会在 UTC 日界
附近记错一天，而唯一键就是那一天。有一条测试钉住这点。

### 3 · 真库验证（事务内，最后 ROLLBACK，生产库未留任何行）

`.data/habit-display-rds-verify.mjs`，目标库指纹 `nianlife` / PostgreSQL 18.4 / Asia/Shanghai。
**12 项全过**（用 canonical profile `profile-zhangnian`）：

- 迁移 0016 的**生成版 SQL** 在真库上执行成功；唯一键与索引建立成功
- **同一天刷新 10 次只插入 1 行**（去重靠唯一键，不靠调用方自律）
- 第二个自然日各自成行
- **第三个自然日（9-13）退出默认位**；已经露过的那一天再刷新仍然放行
- **重新构造 store、走真实读取路径重查，两个自然日都还在**（记录在库里，不在进程内存里）
- 另一条连接看不到本事务未提交的建表（证明是两个独立会话，也证明 ROLLBACK 干净）
- 同一事项同一天换一个家庭各自成行（**去重按家庭分，不跨家庭**）
- 从没上报过的事项库里一行都没有

**迁移本轮没有在生产库上跑，随统一发布执行。** 在它跑之前：读回空日志 → 上限不生效但
**不误伤任何人**（没记过露出就一天都不算）；写入命中 42P01 → 静默跳过并在 `skipped` 里说明。
所以页面那一行现在接上去就是安全的，迁移跑完自动开始生效。

### 4 · 给页面轨的接线说明

[`docs/HOME-DATA-WIRING-HABIT-REPORT.md`](HOME-DATA-WIRING-HABIT-REPORT.md)。一行：
`await reportHabitShown(feed)`，放在确定要渲染的那次请求里。不传日期、不挑事项、不自己筛习惯类。

### 本轮真实运行证据

`round4/home-feed-rds-runtime.json`：生产 feed 与上一轮**逐字相同**（3 组候选、冷却 3 期 /
0.75 天、默认露出 2、退场 10、折叠 16）——过滤顺序的修正在今天的生产数据上**没有可观察差异**
（生产没有同组连拍的获批对，也没有期内新批准的候选），所以那条修正**只有单测＋变异验证覆盖**。

## 2026-09-13 上报口收口：撤回页面直调示例，改为服务端校验（1.5.0）

**保留不动**：`habit_display_days` 表、迁移 0016（含 journal/snapshot）、唯一键去重、
`readHabitDisplayDays` / `recordHabitShown` 的读写逻辑——`git status` 对这几个文件为空，逐字未改。

**撤回**：上一版接线文档给的「在 `app/page.tsx` 里直接 `await reportHabitShown(feed)`」那个服务端
页面直调示例，以及那个直接采信入参的 `reportHabitShown(feed)` 函数。它把两件事都交给了调用方：

- 日期（调用方自己算一次 `new Date()`，或拿一份跨了日界的旧 feed，就会往错误的自然日插一行，
  而唯一键正是那一天）；
- 事项（折叠项、非习惯类、或一份陈旧/被改过的 `habitShownIds`，会让一条家人从没看见的提醒
  白占一个自然日）。

**配额只有两个自然日，写错一次就少一天**，所以这两件事不该取决于调用点写得对不对。

**新接口** `reportHabitDisplay({ claimedItemIds?, feed? })`，服务端校验：

| | 谁说了算 |
|---|---|
| 算哪一天 | **只有服务端产品时钟**（`productToday()`）。签名里**没有** `day`，传不进去 |
| 哪几条可计数 | 服务端**现算**：此刻真的在 `reminders.shown` 里，且 `classifyFreshness` 判为习惯类。**不采信 `habitShownIds` 预存数组** |
| `claimedItemIds` | **只能收窄**。不够格的逐条拒，并区分三种原因：不在本次 feed 里／在默认位但非习惯类／只折叠着没真的露出 |
| 跨日界的旧 feed | `feed.clock.today !== productToday()` → 整次拒掉 |

返回 `{ day, recorded, rejected, skipped }`——**错误接线看得见，不是静默的**。从不抛。

### 这件事现在为什么更要紧

页面轨同时在做 `app/api/internal/habit-shown` route handler + 浏览器进视口后上报。
**那条路由的请求体来自浏览器，不可信**，所以「服务端自己校验」从一条设计偏好变成了必需。
他们的判断和我一致（SSR 跑完 ≠ 有人看到），方向没有冲突。

**一条要给页面轨的话**（已写进接线文档）：他们 handler 里现在有一句
`const allowed = new Set(feed.reminders.habitShownIds)` 自己再判一次——**不需要了**，
`reportHabitDisplay({ claimedItemIds })` 已经做了，而且做得更严（现算而非读预存数组）。
两处各判一次迟早分叉，分叉那天就是一条没人看见的提醒开始占配额。整个 handler 可以是三行。
他们那几个文件仍在未提交状态，我一个都没碰。

### 仍然由调用方负责的一件事（服务端兜不住）

**「这次呈现有没有真的被人看到」。** 服务端能判「这几条此刻够不够格」，但预取、预热、健康检查、
截图与核验脚本都能构造出一份完全合格的 feed。所以接入点必须对应一次真的被看到的呈现——
本轮**不替页面轨选这个点**，数据轨也没有新增任何路由或入口。

### 检查

typecheck ✅　lint ✅　build ✅　测试 **1104 条 1094 通过 0 失败 10 跳过**（上报口新增 6 条：
日期传不进去、跨日界拒、不采信 `habitShownIds`、claimed 只能收窄且分三种拒因、非 ready 不写、
默认位无习惯类不写）。未改生产库、未跑迁移、未部署。

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
第三轮：在它没有 Git 写入在进行、且其半成品能编译通过（typecheck/lint/test/build 全过）之后，
我取用 Git 时段推送本轨四个文件（`2798593`），**推完即释放，现在不持有**。全程只动 `lib/home-feed.ts`、`lib/upcoming-freshness.ts`
与两个测试文件。

## 下一步

1. 页面轨改 `page.tsx:144` 的标签（顶部红字），然后写「可以测了 + SHA」。
2. 收到 SHA 后我测完整呈现链：原则一的页面侧两问 + 提醒标签是否已按 `evidenceKind` 分开。
3. 拿到能看图的模型端点后跑 ≤30 张有界批次，把 `quality.source` 从 `deterministic` 换成真实的 `ai_vision`。
