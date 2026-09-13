# HOME-20260913-DATA · 数据轨状态

任务 ID：HOME-20260913-DATA　独占本文件（不写 `docs/HOME-PAGE-STATUS.md`）
接手 HEAD `74e7686`（派单卡记的 `ac90ec6` 已被取代，未回退 checkout）。
非本轮的既有改动一律未动未提交：`HANDOFF-COMMANDER.md`、`ORCHESTRATOR-INBOX.md`、`nianlife-handoff-2026-09-06-neon.md`、`quark-heic-ingest-linux.mjs`。

## ⚠️ 给页面轨：接口升到 `home-feed/1.1.0`，有一处**必须**改标签

`HomeReminder` 新增 `evidenceKind: "event" | "month"`，并且 `evidenceHref` 的取值变了。

1.0.0 只认 `evidence.eventId`，于是它对**生产上全部 18 条待办都是 undefined**——`upcoming-store` 写进
`evidence` 的只有 `{ day }`，从来没有 eventId。一条追不回来源的待办违反原则八，所以 1.1.0 在拿不到
具体事件时退到**那个月**（`/memory/YYYY/MM`）。

**你现在 `page.tsx` 里 `link: { href: reminder.evidenceHref, label: "看那一天" }` 会把一个月份链接
标成「看那一天」——那是对读者说假话。** 请按 `evidenceKind` 分标签：`event` → 「看那一天」，
`month` → 「翻到 X 月」（和 `upcoming-tasks.tsx` 现有说法一致）。`undefined` 时仍然不画链接。
其余字段全部兼容，没有改含义。

## 交付

`CONTRACT_READY` → `91786ad`（1.0.0）；`cfe7f1c` 待办保鲜；`ebcc223` 质量能力门 + 家庭原文清理。
**1.1.0 的证据链修正尚未 push**：页面轨 19:0x 起持有 Git 锁，等它写「释放」后我再 push（见下「锁」）。

改的文件：`lib/home-feed.ts`（新）、`lib/upcoming-freshness.ts`（新）、`lib/home-photo-quality.ts`（新）、
`lib/db/upcoming-store.ts`（合并分支钉住提出日）、`test/{home-feed,upcoming-freshness,home-photo-quality}.test.mjs`（新）、
`test/render-on-demand.test.mjs`（守卫补洞）、`scripts/{home-photo-quality,home-feed-verify}.mjs`（新）。
**未碰** `app/**`、`components/**`、全局 CSS、字体、对方状态。未写库、未迁移、未改任何审核状态、未部署。

四项检查（当前树，含页面轨半成品一起编译）：typecheck ✅　lint ✅　build ✅　
测试 **1071 条 1061 通过 0 失败 10 跳过**（新增 46 条）。1.1.0 那条改动后 `home-feed` 测试 28/28 过；
全套与 build 等页面轨释放锁后重跑再报。

## 有界真实核验（证据：`C:\Users\teddy\NianlifeOps\home-2026-09-13\data\`，不进 Git）

`home-feed-verification.json`（逐期选择 + 逐条退场原因）、`live-upcoming.json`（线上首页 DOM 采得的
18 条真实待办，含真实提出日）、`production-pairs.json`（3 对获批 (故事,照片)）。

**生产库连不上**：线上私有站跑的是阿里云 RDS，本机没有 ECS 的 `.pem`，`netstat` 上只有 18080。
`v2/.env.local` 指向的 Neon 是**另一份更小的数据**：0 条 `media_binding`、0 条 `media_subject_check`、
最新事件 2026-09-03、**连 `upcoming_items` 表都没有**（0013/0014/0015 没在它上面跑过——页面轨独立
撞到同一件事）。在 Neon 上跑出的「0 个候选」是那个库的事实，不是首页逻辑的事实。所以核验改为
**把生产数据回放进本轨代码**。这是**限制，不是通过**。

结果：3 对候选按四期轮换（09-07 → 08-19 → 08-08 → 09-07），图和故事始终同源、各带自己的当时年龄；
默认露出 2 条（关键健康事项排第一 + 一条窗口仍盖住今天的待定计划）；**10 条陈旧事项退场，库内状态
全部未改**（含 8 月 16 日那条陈旧采购）；16 条折叠可达，18 条一条没丢。

## 产品八原则（本节点，八条全验，一条没跳）

| 原则 | 结果 | 看到了什么 |
|---|---|---|
| 一 Person First | **数据侧过 / 页面侧未验** | feed 返回今天+今天年龄+一段故事+合法配图+1 条近况+2 条有效提醒。新首页未部署，「不点任何东西能否说出张年最近怎么样」要在页面上看，归页面轨与终审 |
| 二 Two Clocks | **过** | 四期 × 每块内容（时钟/主故事/配图/近况）逐字段跑过：全部同时带「什么时候」+「当时几岁」，`deadlineLabel` 无裸库时间。顺带修掉 `editionAt` 遇坏时间值抛 RangeError 打掉整页 |
| 三 Media First | **过** | 面向家人的文案只有 7 个状态常量 + 3 种期限形状，无工程名词、无来源系统名、**无计数式描述**；`reason`/`photoAbsence` 是诊断字段，页面未渲染 |
| 四 Invisible Automation | **① 过　② 否（未交付）** | ① 数据层 grep「上传/自动整理/红点/记一笔」= 0，无空状态引导上传。② 管线仍非无人值守；但保鲜过滤改为**每次读取现算**，过期琐事不再需要后台任务才退场 |
| 五 Not Equal Weight | **过** | 18 条待办→默认 2 条；5 段记忆→1 主故事+1 近况；3 组候选→1 组呈现。大部分内容默认不出现 |
| 六 Bring the Past Back | **未交付** | 新首页按定稿**删掉了「忽然想起」**（回顾与浮现回月页/记忆页）。已确认没有无条件占位模块、没有随机轮播（`Math.random()` = 0，期次是纯函数）、没有「暂无」。**页面侧待查一条**：`home-lead.tsx` 的换图是否「浏览期间不自动轮播」（§5.5），等页面轨 SHA 后测 |
| 七 Automatic Reflection | **未交付** | 月度回顾不在新首页范围内，月页未改动。本轮没有生成任何回顾文字 |
| 八 Family Owns It | **过（本轮修好的）** | 抽查：主故事→`/events/<id>`、近况→`/events/<id>`。**待办原本 3 条抽 3 条全断链**——18 条真实待办没有一条带 eventId，1.0.0 的 `evidenceHref` 全是 undefined。1.1.0 退到月份链接并用 `evidenceKind` 标明种类后恢复可追溯 |

## 已知未交付 / 剩余未验证

1. **AI 视觉评估未执行**，原因已实测坐实：`deepseek-v4-pro` 收到图片后被换成 `[Unsupported Image]`，
   HTTP 200 且模型开始猜。能力门会中止整批、一个分数都不写。当前所有候选 `source=deterministic`
   并写明 `degraded`。**需要一个真的能看图的模型端点**，这是外部条件，不是代码问题。
2. **§6.2 的「库存预测 72 小时」与 §6.3 的「习惯提醒 7 天／最多两个日期」已实现且有单测，但生产
   18 条里一条都没命中**这两类——所以它们是「已实现、未经真实数据检验」，不是「通过」。
3. **无日期的待定计划不设过期**（规格没给这一类数字，生产里正好有一条是关于十月假期的真实打算）。
   靠排序不占默认位，不靠时钟。需要一个默认期限请总指挥给数字，我不臆造。
4. **页面级验收全部未做**：四视口、真字体、换图交互、完整呈现链，等页面轨写「可以测了 + SHA」后我再测。
5. `lib/db/upcoming-store.ts:230` 有一处**既有**注释含家庭原文（非本轮写入），未代改。

## 锁

- 18:11 申请 → 18:4x 持有 → 18:5x **已释放**。19:0x 起页面轨持有 Git + 全量检查时段。
- 我现在**不动 Git、不跑全量 build**。等页面轨写「释放」→ 我 push 1.1.0 → 再等它「可以测了 + SHA」测呈现链。
- 回滚：三个提交都只新增文件或加字段，`git revert ebcc223 cfe7f1c 91786ad` 无副作用。

## 下一步

1. 页面轨释放锁后 push 1.1.0（证据链修正 + `editionAt` 健壮性），重跑全套与 build。
2. 收到「可以测了 + SHA」后测完整呈现链：原则一/六的页面侧两问 + 换图不自动轮播 + 提醒标签是否按 `evidenceKind` 分开。
3. 写 `READY_FOR_REVIEW` 终稿。
