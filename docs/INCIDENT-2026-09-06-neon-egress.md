# Nianlife Neon 账单事故报告

**事故日期**：2026-09-06
**报告撰写**：Cowork（编排侧）
**报告版本**：v1，2026-09-06 09:0x UTC
**用途**：给 Teddy，并供第三方 AI 独立审核

---

## ⚠️ v1 已知错误清单（2026-09-06 09:2x UTC 追加，外部审核指出 + Cowork 自查）

**这份 v1 不能作为恢复 Neon 的批准文件。** 下列错误在 v2 修正前一律以本节为准：

| # | v1 的错误 | 正确的说法 | 谁发现的 |
|---|---|---|---|
| E1 | 7.1 称"不存在可依赖的平台级硬闸" | **错。** Neon 支持项目级 consumption quota，含 `data_transfer_bytes`，经 `PATCH /api/v2/projects/{id}` 设置，触发后**持续暂停 compute 直到下个计费周期**。证据一直在本项目自己的 `docs/STATE.md` 决策 10（"不设 consumption limit"）里 | 外部审核 |
| E2 | 8.2 恢复顺序为"先升级 Launch → 再部署修复" | **危险且错误。** 升级瞬间线上旧构建立即恢复连库。正确顺序：**Pause Vercel → 停所有自动任务 → 升级 Neon → 设 quota → 部署修复 → 验证 → 最后 Resume** | 外部审核 |
| E3 | 8.3 用 `seq_scan` / `seq_tup_read` 作主验收指标 | **错。** 这两个计数器量的是扫描次数与行数，**不是字节数**。窄列全表扫描流量可能很小，索引扫描也可能返回大量数据。主指标必须是 Neon 的 `data_transfer_bytes` | 外部审核（Cowork 排查时已自行识别此缺陷却仍采用，是更严重的失误） |
| E4 | 8.4 把"长期留在 Neon Free"写成默认终局 | Free 只适合短期止血。Teddy 已决定长期迁移到国产数据库与对象存储，v2 应把迁移列入路线 | 外部审核 |
| E5 | 7.5 称 DeepSeek 有"60 次/月硬上限" | **表述错误。** `--max-calls=60` + 进程内同步计数器只保证**单次脚本进程**最多 60 次。脚本重复启动、多月份、并发 worker 各自都会拿到新的 60 次配额。要成为月度硬闸需要数据库里的持久化预算账本 + 跨进程锁。预充值仍然限制了金钱损失上限（¥58），但代码层的保证被夸大了 | 外部审核 |
| E6 | 账单写成"1,371.39 GB ≈ $87.14" | 结构应拆开：**Launch 含 500 GB → 超额 871.39 GB × $0.10/GB = $87.14**（与 Support 数字分毫不差）。Support 报的 $0.0635/GB 是总量摊下来的混合单价，不是费率 | 外部审核（Cowork 已复算确认） |
| E7 | 恢复计划遗漏了自动唤醒源 | `v2/vercel.json` 里有 Vercel Cron：`0 3 * * *` 打 `/api/internal/organizer-worker`。**Vercel cron 按 UTC 解释，即北京时间每天 11:00**（Cowork 曾口头说成"凌晨三点"，错）。注意诱因 A 的 commit 是北京时间 10:54 落地，这条 cron 在 6 分钟后就会触发 | Cowork 自查（时区由外部审核更正） |
| E8 | 报告讨论 Vercel Spend Management 的设置步骤 | 该功能要求 **Pro** 团队；代码注释显示本项目在 **Hobby** 计划上，也就是说这套设置在此账号上根本开不了。（"不覆盖 Marketplace"这一判断本身仍然正确） | Cowork 自查 |
| E9 | 只修 `generateStaticParams` | 更可靠的规则应是：**`next build` 不得读取生产数据库**。今天是事件页，明天可能是 sitemap、OG 图、年度页或另一个 `generateMetadata()`。v2 必须全仓扫描所有构建期入口 | 外部审核 |
| E10 | 未记录非财务影响 | `raw_sources.text` 是家庭微信原文。被反复拉进构建机与函数内存，意味着构建 OOM 风险、敏感文本扩散到更多运行环境、崩溃日志暴露风险、连接与构建队列拥塞。v2 必须记录 | 外部审核 |

**补充事实（不改变结论，只提精度）**：`app/robots.ts` 对所有 UA 是 `disallow: /`。这只能
约束守规矩的搜索引擎，**不能**约束扫描器、旧链接、Vercel Cron、ISR 请求和直接访问事件 URL，
因此**不得**用来推迟 C-4、也不得降低恢复门槛。另外月页的档案展开 server action
（`app/memory/[year]/[month]/actions.ts`）已经是按月 scoped 的，不走 `loadFamilyArchive`。

**当前状态：Neon 保持关闭，不恢复 Launch。A/C 只允许本地零生产流量的代码修复。**

### Vercel Support 的正式答复（2026-09-06，已收到，改变了恢复的经济账）

三条都是官方口径，直接影响恢复决策，v2 必须以此为准：

1. **本周期已消耗的额度不会因为换计划而重置。** Marketplace 的套餐额度按整个计费周期
   （9/5–10/1）累计计算。现在升回 Launch，那 500 GB 的包含额度**已经被这 1,371.39 GB
   用光了**，计量不会归零 —— 也就是说**今天升回 Launch，从第一个 GB 起就是 $0.10/GB 的
   超额计费**，一直到 10 月 1 日周期重置为止。**本周期内没有任何免费余量。**
2. **Vercel 侧不存在任何针对 Marketplace 的硬闸。** Spend Management 只覆盖 Vercel 自有
   计量资源，明确排除 Marketplace / add-on / seats，而且 Hobby 计划根本没有这个功能。
   官方原话：任何用量控制、计算限制或数据库暂停"必须直接在 Neon 设置里配置"。
   **→ 结论：唯一可能的硬闸在 Neon 侧，而它是否可用尚未确认。这是恢复的关键路径。**
3. **小时级流量数据在 Neon 手里，不在 Vercel。** Vercel 只从 Marketplace 伙伴拿到聚合
   账单数据，拿不到原始逐小时遥测。**168 小时的抢救窗口完全押在 Neon 工单上。**
4. **goodwill credit 只能由 Neon 批。** Vercel 无权对 Marketplace 伙伴的用量发放减免；
   Neon 批了会通过 Marketplace 账单系统回冲到 Vercel 账单上。

**由此产生的两条硬结论**：
- 「今晚恢复 Launch」和「彻底修好之前不再付一分钱」在本周期内**不可兼得** —— 今天升回去，
  任何流量都直接产生费用。这个矛盾要由 Teddy 本人决定怎么取舍，不由任何 session 替他决定。
- 10 月 1 日周期重置后，Launch 的 500 GB 或 Free 的 5 GB 才会重新可用。**等到 10 月 1 日
  是唯一零金钱风险的路径**，代价是站点下线约 25 天。

---

## 阅读说明（给审核者）

本报告对每条结论标注了证据等级，请按等级施加不同的怀疑：

| 标记 | 含义 |
|---|---|
| **[实测]** | 我本人直接执行命令/查询得到的结果，可复现 |
| **[代码]** | 我本人读源码确认，附文件与行号，可复核 |
| **[转述]** | 来自另一个 session 的报告，我**没有**独立验证，已注明为何验证不了 |
| **[推算]** | 基于上述事实的算术推导，前提已写明，前提错则结论错 |

报告里最重要的一条是第 3.2 节：**本次事故存在一个至今未修复、且很可能比已修复那条更严重的诱因**。如果只按目前"已收尾"的认知恢复 Neon，很可能会再烧一次。

---

## 1. 摘要

2026-09-06 单日，Neon（经 Vercel Marketplace 计费）产生 **$87.86** 费用。其中：

- Compute：6.79 CU-hours × $0.106 = **$0.72**
- **Public Network Transfer（出站流量）：1,371.39 GB ≈ $87.14** ← 全部成本在这里
- 数据库本体只有 **121 MB**

也就是说：一个 121 MB 的数据库，在一天内向外传输了 **1.37 TB**，相当于把整个库完整读出去 **约 11,000 次**。

成本形态是"同一份数据被反复整表读取"，不是数据量大、不是计算量大。

**当前状态**：Teddy 已将 Neon 从 Launch 降级至 Free，Free 版每月 5 GB 出站额度在本计费周期早已用尽（超出 270 倍），数据库因此硬性拒绝连接，网站下线，费用停止增长。数据完好无损。

**最重要的结论**：已定位并修复的诱因（`getOrganizerStore` 误用）**不是全部**，很可能也不是最大的一个。第 3.2 节描述的第二个诱因至今仍在代码里，恢复 Neon 前必须先修。

---

## 2. 事实基线（全部可复核）

| 项目 | 数值 | 来源 |
|---|---|---|
| 计费周期 | 2026-09-05 → 2026-10-01 | Vercel 账单页截图 |
| 总花费 | $87.86 | Vercel 账单页截图 |
| 出站流量 | 1,371.39 GB | Vercel Support 明细 |
| Compute | 6.79 CU-hours / $0.72 | Vercel Support 明细 |
| 数据库总大小 | 121 MB | 事故期间查库 **[实测]** |
| `raw_sources` 行数 | 46,742 | 事故期间查库 **[实测]** |
| `life_events` 行数 | 651 | 事故期间查库 **[实测]** |
| 当日仓库 commit 数 | **182** | `git log --since=2026-09-06` **[实测]** |
| 其中触碰 v2 代码的 | 45 | 同上 **[实测]** |
| DeepSeek 余额 | ¥58.00（未动用） | 调 `api.deepseek.com/user/balance` **[实测]** |
| 当前数据库状态 | 拒绝连接：`Your project has exceeded the data transfer quota.` | 直接连接测试 **[实测]** |

**关键背景**：媒体文件（照片/视频）存在 Cloudflare R2，**不在 Postgres 里**。Postgres 只存指针和元数据。所以 1.37 TB 与图片分发无关，纯粹是数据库到服务端函数之间的查询流量。

---

## 3. 起因

### 3.0 系统性前提：没有任何请求级缓存

**[代码]** 全仓库搜索确认：`lib/` 与 `app/` 下**没有任何** React `cache()`、`unstable_cache` 或等价的请求级去重。

这意味着：同一次页面渲染中，同一个仓储函数被调用两次，就真的打两次数据库、传两份数据。这是下面所有放大效应成立的前提。

复核命令：
```
grep -rn "unstable_cache\|import { cache }" lib/ app/ --include=*.ts --include=*.tsx
```

### 3.1 诱因 A —— 页面渲染路径误用批处理专用函数（**已修复**）

**[代码]** `lib/family-archive.ts` 的 `loadFamilyArchive()` 调用了 `getOrganizerStore(CANONICAL_PROFILE_ID)`。

`assembleOrganizerStore()`（`lib/db/postgres-repository.ts:292` 起）的读取内容包含：

```ts
db.select({ id, profileId, sourceType, contentTypes, contributorId, capturedAt,
            text: t.rawSources.text,          // ← 全库最大的列
            mediaIds, sourceLabel, visibility, deletedAt })
  .from(t.rawSources).where(eq(t.rawSources.profileId, profileId))
```

该函数自己的文档注释明确写着它只给 Organizer 批处理用、页面渲染不该调用。而 `loadFamilyArchive()` 在 **5 个页面组件的顶层被 await**（`app/page.tsx`、`about`、`memory`、`memory/[year]`、`memory/[year]/[month]`），每个页面 `revalidate = 300`。

**它实际只需要一个字段**：`organizerStore.events`，用于 `composeFamilyArchive()` 里一行 id 匹配（`family-archive.ts:116`）。

- **引入**：commit `2f65c78`，2026-09-06 10:54:41 +0800（B 轨修 B-17 痕迹层时顺带引入，动机正当）
- **修复**：commit `7d7fe15`，2026-09-06 15:47:46 +0800
- **修法**：新增 `Repository.getAllEventIdentities(profileId)`，只查 `life_events` 的 id/title/story/occurredAt 四列，不 join、不碰 `raw_sources`
- **代码正确性**：**[代码]** 我独立读了下游全部消费方（`lib/publication-moments.ts` 的 `buildTraceNotes`、`lib/memory-chapters.ts` 的 `isGarbageLifeEvent` / `memoryTitle`），确认 trace 事件确实只读这四个字段，替换无功能损失
- **是否在主干**：**[实测]** 我从 GitHub 独立重新 clone 复核，`main` 上确实已改用 `getAllEventIdentities()`

### 3.2 ⚠️ 诱因 B —— 事件详情页每次构建整表读 651 次（**至今未修复，仍在 main 上**）

这是本次报告最重要的一条，此前**没有任何人发现**，包括我在事故当时的排查。

**[代码]** `lib/db/postgres-repository.ts:547` 的 `getEventDetail(id)`：

```ts
const [mediaRows, sourceRows, contributorRows, growthRows, careRows] = await Promise.all([
  db.select().from(t.media),
  db.select().from(t.rawSources),      // ← select *，含 text 列，无 WHERE，无 LIMIT
  db.select().from(t.contributors),
  db.select().from(t.growthRecords),
  db.select().from(t.careRecords),
]);
// 然后在 JS 里 filter：item => e.sourceIds.includes(item.id)
```

它把整张 `raw_sources`（46,742 行，含最大的 `text` 列）全部拉进内存，只为了挑出这一个事件引用的少数几行。**它比 3.1 修掉的那条更糟** —— 3.1 至少还做了列投影，这里是彻底的 `select *`。

**放大路径**（`app/events/[id]/page.tsx`）：

```ts
// 第 14 行
export async function generateStaticParams() {
  return (await getAllEvents()).map((event) => ({ id: event.id }));   // 全部事件，最多 651 个
}
// 第 18 行 —— generateMetadata 调一次
const detail = await getEventDetail(id);
// 第 30 行 —— 页面组件再调一次（无 cache()，不去重）
const [detail, store] = await Promise.all([getEventDetail(id), getStore()]);
```

**[推算]** 单个事件页 = `getEventDetail` × 2 + `getStore` × 1。若 `raw_sources` 全量约 60–64 MB（该数值来自事故期间的测量与 A 轨 commit 说明，本次因数据库已封无法复测，标为估算）：

| 层级 | 计算 | 结果 |
|---|---|---|
| 单个事件页 | 2 × ~64 MB + ~5 MB | **≈ 133 MB** |
| 一次完整构建（651 个事件页） | 651 × 133 MB | **≈ 87 GB** |
| 若可发布事件只有 300 个 | 300 × 133 MB | ≈ 40 GB |

**即：只要跑一次完整构建，仅事件页一项就可能产生几十 GB 的出站流量。**

前提与不确定性（请审核者重点质疑这里）：
1. `raw_sources` 全量大小是估算值，不是本次实测
2. `generateStaticParams` 返回的是**可发布**事件数（`getAllEvents()` 过滤过），实际 ≤ 651，当前无法查库确认
3. Next.js / Vercel 在构建间可能复用部分缓存，未必每次构建都重渲全部 651 页 —— 这一点我**无法验证**（数据库已封，无法实跑构建）

即便把这些不确定性全部往最保守方向打折，量级仍然是"每次构建数十 GB"，与 1.37 TB 的总量完全同一个数量级。

### 3.3 放大器

1. **构建风暴**：当日 **182 个 commit [实测]**，其中绝大多数是各轨道的"心跳汇报"纯文档提交。Vercel 接的是 GitHub push 事件，**每 push 一次排一次构建**。
2. **数据量在同一时间窗突然长大**：A-4 回填把 `life_events` 从接近 0 涨到 651。诱因 B 的成本与事件数成正比 —— 也就是说，B 这个 bug 早就存在，但直到昨天数据长起来、今天构建又暴增，才在账单上炸出来。
3. **ISR revalidate = 300**：5 个公开页 + 若干年/月页每 5 分钟可被重新生成一次。
4. **部署管道故障拖长了暴露窗口**（见 4. 经过）：真正的修复在 07:47 UTC 就提交了，但因为一条错误的 Vercel Ignored Build Step 命令，约 6 次部署全部 Error，线上持续跑着有 bug 的旧构建约 1.5 小时。

### 3.4 归因的诚实边界

**我无法给出 1.37 TB 在诱因 A / B / 其他之间的精确切分**，原因：
- `pg_stat_statements` 扩展未启用 **[实测]**，没有按查询归集的统计
- Neon / Vercel 的流量明细只到"总量"，不到"哪条 SQL"
- 数据库现已封停，无法补测

我能确定的是：**两条诱因都真实存在、机制都成立、量级都足够解释账单**。因此结论是"两条都必须修"，而不是"已经修了一条所以结案"。

### 3.5 其余尚未处理的同类隐患

**[代码]** `assembleStore()`（`postgres-repository.ts:396`，即 `getStore()`）在 P1-5 之后仍保留 **12 处无 WHERE 的 `select *` 全表读**：

```
contributors / media / mediaAssets / mediaLocations / lifeEvents / dailyTraces /
growthRecords / careRecords / careEpisodes / monthlyFocusGoals /
sourceMemoryLinks / contentQualityReviews
```

P1-5 当时只做了一件事：把 `raw_sources` 改成列投影（排除 `text`），并跳过管道专用表。注释里说负载从 ~120 MB 降到 ~5 MB —— 这个说法在"排除了最大的列"这一点上成立，但**其余 12 张表仍然是每次页面渲染整表拉取**（`media_assets` 9,077 行、`media` 数千行）。这是下一级的、比较缓和但持续存在的成本。

**好消息 [代码]**：所有 API 路由（`app/api/**/route.ts`）已清理干净，无全表读 —— C 轨此前的 `bd63bb7` 修复有效。

---

## 4. 经过（时间线，UTC）

| 时间 | 事件 |
|---|---|
| 09-06 02:54 | `2f65c78` 提交，诱因 A 进入代码（B 轨修 B-17，动机正当） |
| 全天 | 182 个 commit（多为心跳汇报），每次 push 触发一次构建 |
| ~06:0x | Teddy 发现账单 $72.92，向 Cowork 报警 |
| 06:0x–07:3x | Cowork 排查：先后排除 idle 连接、多分支等假设；Vercel Support 回复确认成本 100% 来自出站流量；Cowork 用 `pg_stat_activity` 现场抓到并发全表扫描，定位到诱因 A |
| 07:36 | `ae845cb` — P0 派单写入 A 轨入箱 |
| 07:41 | `3df0ac6` — 把教训写成 `CLAUDE.md` 里的硬规则 |
| 07:47 | `7d7fe15` — **A 轨完成真正的修复**并 push |
| 08:00 | `cb1d634` — 另一 session 独立加了止血提交（revalidate 300→3600），落后真修复 13 分钟，属重复劳动 |
| 08:05 | `6c59750` — 发现**部署管道本身坏了**：此前给 Teddy 的 Ignored Build Step 命令 `git diff --quiet "${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}" HEAD -- .` 在浅克隆里报 `fatal: bad object`，Vercel 判为部署 Error 而非"跳过构建"，约 6 次部署全部失败，线上卡在 2 小时前的旧构建 —— **修复迟迟没能上线，钱继续烧** |
| 08:05 | Cowork 误判：仅凭缓存头 STALE→HIT 就宣布"修复已部署已验证"，并写入 `docs/STATE.md`（`4a3d2f2`） |
| 08:12 | Cowork 自查推翻上述结论并更正（`4483075`） |
| ~08:2x | Teddy 在 Vercel 后台保存修正后的命令；新构建成功 **[转述]** |
| 08:28–08:29 | `5684d91` 撤回 stopgap（revalidate 回 300）、`f44fcaa` 事故收尾报告 **[转述]** |
| ~08:4x | 账单达 $87.86；Teddy 设 $90 硬线，随后**将 Neon 降级至 Free** |
| ~08:5x | Cowork 实测确认数据库已硬性拒绝连接，费用停止增长 **[实测]** |
| 08:33 | `89de6d7` — Cowork 向三条轨道下达停工令，防止它们对着死库反复报错 |

修正后的 Ignored Build Step 命令（现已生效 **[转述]**）：
```bash
git cat-file -e "$VERCEL_GIT_PREVIOUS_SHA" 2>/dev/null && git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- .
```

---

## 5. 结果

| 项目 | 状态 |
|---|---|
| 费用 | 停止增长，最终 $87.86 |
| 数据 | **完好**。Neon 的额度机制只封操作、不删数据（官方文档明确："None of these limits delete your data"），实测报错是配额拒绝而非数据清除 |
| 网站 | 下线。缓存过期后陆续变为报错 |
| 诱因 A | 已修复，已在 `main`，**[转述]** 已部署上线 |
| 诱因 B | **未修复，仍在 `main`** |
| 3.5 节隐患 | 未处理 |
| DeepSeek | 未受影响，余额 ¥58.00 一分未动 **[实测]** |
| 三条轨道 | 已停工待命 |

**未能独立验证的一项**：C 轨报告新构建已成为生产别名（用 `vercel inspect nianlife.cn` 查证，证据类型正确）。我这侧的 device_bash 环境没有 Vercel 登录态（`vercel whoami` 返回 Logged out），无法复核，如实标注为 [转述]。

---

## 6. 我（Cowork/编排）的失误清单

不含糊，逐条列出：

1. **验收失职（最主要）**：`2f65c78` 把一个批处理专用的全表读接进 5 个页面渲染路径，我作为负责验收的角色没有检查这个 commit 新增了什么数据库读取。这个口子是从我这里漏过去的。
2. **排查手段本身在放大事故**：我用 `curl` 反复打过期页面强制触发 ISR 重渲染来"验证"。在一个已知存在全表扫描 bug 的站点上，每打一次就烧一次。**[实测]** 我自己测到的数字：那段时间 `raw_sources` 的 `seq_scan` 从 54,077 涨到 54,129，即约 **52 次全表扫描**由我这轮验证直接或间接触发。我事后把它轻描淡写为"一点流量"，这个措辞不成立。
3. **在证据不足时宣布结论**：仅凭缓存头 STALE→HIT + age 归零就断定"修复已部署"，并写进权威状态文档。该信号根本无法区分新旧查询。虽然 7 分钟后自查推翻，但错误结论已经进入共享文档。
4. **对免费额度的判断错误**：降级后我告诉 Teddy"大概率会很快撞到 5 GB 上限"，实际本周期早已超出 270 倍，是**瞬间**触顶。是 Teddy 指出的。
5. **心跳提交规则是我定的**：182 个 commit / 每 push 一次构建这个放大器，规则出自编排侧，我没有预判它与构建计费的耦合。

---

## 7. 举一反三：如何防止再烧

### 7.1 关键平台事实（先纠正一个很可能的误解）

**[实测查证 Vercel 官方文档]** Vercel 的 Spend Management **不覆盖 Marketplace 集成**：

> "The spend amount ... **does not** include seats, integrations (such as Marketplace), or separate add-ons."

Neon 正是通过 Vercel Marketplace 计费的。**所以：**
- 在 Vercel 设置消费上限，**不会**拦住 Neon 的账单
- 本次事故即使当时设了 Spend Management，也一样会发生
- 而且它的检查周期是"每几分钟一次"，官方明确说暂停不是即时的

**Neon Launch 计划本身没有硬性消费上限**，只有 80%/100% 的通知。

**结论：不存在一个可以依赖的平台级硬闸。唯一真正的防线是代码。** 任何"设个上限就好了"的方案都是错的。

（唯一真正的硬闸是 Neon **Free** 计划的 5 GB 配额 —— 它确实会硬停，这次就是它停下来的。见 8.4 的长期建议。）

### 7.2 代码层（唯一真正的防线）—— 必须修的清单

| # | 位置 | 问题 | 修法 |
|---|---|---|---|
| **C-1** | `postgres-repository.ts:547` `getEventDetail()` | 5 处 `select *` 全表读，含 `raw_sources.text` | 改成按 id 精确查：`inArray(t.rawSources.id, e.sourceIds)`，其余四张表同理；只选实际用到的列 |
| **C-2** | `app/events/[id]/page.tsx:18,30` | 同一请求内 `getEventDetail` 被调两次，无去重 | 用 React `cache()` 包一层，或让 `generateMetadata` 复用页面结果 |
| **C-3** | `app/events/[id]/page.tsx:14` | `generateStaticParams` 返回全部事件，构建期整站预渲染 | 改为返回 `[]` 或最近 N 个，其余走按需 ISR（月页注释里已经承认这个做法可接受） |
| **C-4** | `postgres-repository.ts:396` `assembleStore()` | 仍有 12 处无 WHERE 的 `select *` | 逐张改列投影 / 按需 scope；至少先处理 `media`、`mediaAssets`、`mediaLocations`、`contentQualityReviews` 四张大表 |
| **C-5** | 仓储层（新增） | 没有任何机制让"一次查询拉了几十 MB"这件事被看见 | 加一个查询规模护栏：单次查询返回行数 / 估算字节超阈值时打警告日志（生产）或直接抛错（开发）。这是把"隐性成本"变成"显性失败"的关键 |

C-1 / C-2 / C-3 是**恢复 Neon 之前必须完成**的。C-4 / C-5 可以在恢复后一周内做。

### 7.3 部署层

| # | 措施 |
|---|---|
| **D-1** | 心跳汇报**只本地 commit、不 push**（此规则已存在，但当日仍产生 182 个 commit，需要真正执行到位） |
| **D-2** | Ignored Build Step 已修正为带 `git cat-file -e` 短路的版本，跳过纯文档 push 的构建 |
| **D-3** | 任何改动"是否构建"逻辑的命令，必须测三条分支：能解析且无 diff / 能解析且有 diff / **SHA 解析不了**。本次就是漏了第三条导致全站部署失败 |
| **D-4** | 构建本身是成本事件。心里要有一条等式：**一次 push ≈ 一次全站构建 ≈ 一次数据库全量读取的倍数** |

### 7.4 流程层（编排规则）

已写入 `CLAUDE.md` 的硬规则（commit `3df0ac6`）：任何要接进页面渲染路径的数据读取，必须先回答两个问题 —— ①它碰哪些表哪些列（尤其 `raw_sources.text`）②这条路径多久触发一次（构建 × 页面数 × ISR）。答不上来就不许接。

本次事故后应补充的三条：

- **P-1**：排查成本类事故时，**禁止用制造真实流量的方式做验证**。改为读代码 + 读部署日志 + 读数据库统计计数器。
- **P-2**：判断"是否已部署"只接受直接证据（`vercel inspect` / 部署日志 / 构建产物指纹），**不接受**缓存头、响应时间这类间接信号。
- **P-3**：任何新增的 `generateStaticParams`，必须同时说明"它会让构建期渲染多少个页面、每个页面的数据读取成本是多少"。

### 7.5 DeepSeek —— 结构上是安全的，原因如下

**[实测]** 余额 ¥58.00，本次事故期间**一分未动**。

DeepSeek 与 Neon 有本质区别：

| 维度 | Neon（Launch） | DeepSeek |
|---|---|---|
| 计费模式 | **后付费**，用了才结算，无硬上限 | **预充值**，余额耗尽即拒绝服务 |
| 失控上限 | 理论上无上限（本次一天 $87） | **最多 ¥58**，物理上不可能更多 |
| 需要的防护 | 必须靠代码和监控 | 结构自带硬闸 |

**[代码]** 代码层还有额外护栏：
- `scripts/organizer-month-write.mjs:84` —— `--max-calls` 默认 **60**，且 `reserveCall()` 是同步的检查-自增硬上限（`:266`）
- worker 调用它时未覆盖该默认值 **[代码]**（`nianlife-worker.mjs:390` 只传 `--month` / `--commit` / `--out`），因此继承 60 次/月的上限
- 已组织过的窗口有指纹短路，直接跳过，不重复付费
- 429/5xx 有退避重试（`deepseek-editor.ts:95`），失败请求通常不计费

**DeepSeek 的唯一实际风险**是"跑了不该跑的月份，覆盖了已验收的内容"（`persistMonthlySnapshot` 是 upsert），这是**数据风险不是钱的风险**。

**建议**：DeepSeek 保持预充值、不开自动续费、不绑信用卡。这条已经是当前状态，不需要改。

### 7.6 值得推广的一条判断原则

这次事故的本质不是"有个 bug"，而是：

> **在 Serverless + ISR + SSG 架构下，一次看似无害的"多读一点数据"，会被 `构建次数 × 页面数 × 重新验证频率` 放大三次方。**

所以判断一段数据读取是否危险，不能只看"这个查询要多久"，必须看 **"这个查询 × 它所在路径一天会被触发多少次"**。3.2 节那个 bug 单看一次调用只是"慢"，乘上 651 个页面 × 每次构建，就变成一次几十 GB。

---

## 8. 执行计划

### 8.0 前置：Free 版当前无法承载恢复

需要先说清一个约束：Free 版的 5 GB 出站额度在本计费周期（至 10-01）已经耗尽，**在 10 月 1 日之前，留在 Free 版数据库就是不可用的**。所以"今晚恢复"只能通过升回 Launch 实现。这也意味着**恢复的同时就失去了 Free 版那道硬闸**，所以下面 8.1 的代码修复不是可选项。

### 8.1 阶段一：升级 Neon **之前**（数据库仍关闭时完成，全部零成本）

数据库关着不妨碍改代码、跑 typecheck。顺序不要颠倒。

| 步骤 | 操作 | 负责 | 验收 |
|---|---|---|---|
| 1.1 | 确认三条轨道处于停工状态，不会在恢复瞬间自动开跑 | Cowork | 三个 inbox 顶部停工令仍在；无新 commit |
| 1.2 | **修 C-1**：`getEventDetail()` 五处全表读改为按 id 精确查询 | A 轨 | `npm run typecheck` 通过；代码复核确认无 `select *` from `rawSources` |
| 1.3 | **修 C-2**：`app/events/[id]/page.tsx` 用 React `cache()` 消除重复调用 | A 轨 | 同一请求内 `getEventDetail` 只执行一次 |
| 1.4 | **修 C-3**：`generateStaticParams` 不再预渲染全部事件页 | A 轨 | 构建期事件页数量从 651 降到 0（或指定的少量） |
| 1.5 | **加 C-5**：仓储层查询规模护栏 + 日志 | A 轨 | 超阈值查询会在日志中留下明确记录 |
| 1.6 | Cowork 独立复核 1.2–1.5 的代码（不接受自述） | Cowork | 逐行读 diff，确认无遗漏、无功能回退 |
| 1.7 | **暂不 push**，全部改动本地 commit 攒着 | A 轨 | — |

**中止条件**：1.6 复核不通过则不进入阶段二，不恢复 Neon。

### 8.2 阶段二：升级 Neon Launch（Teddy 操作）

| 步骤 | 操作 |
|---|---|
| 2.1 | Vercel → Storage / Integrations → Neon → 升回 Launch |
| 2.2 | 升级后**先不要 push 任何东西**，让站点保持在当前构建 |
| 2.3 | Cowork 立即做基线测量：连库读 `pg_stat_user_tables` 的 `seq_scan` / `seq_tup_read`，记下起始值和时间戳 |
| 2.4 | 在 Neon（或 Vercel Marketplace 的 Neon 用量页）把消费通知阈值设到最低可设值。**注意：这只是通知，不是硬闸**（见 7.1） |

### 8.3 阶段三：受控放行（升级后第一个小时，Cowork 全程盯）

这一步的目的是：在真实流量下验证修复，而不是靠推理相信它。

| 步骤 | 操作 | 观察指标 |
|---|---|---|
| 3.1 | push 阶段一攒下的修复，触发**一次**构建 | 构建是否成功；构建期间 `raw_sources` 的 `seq_scan` 增量 |
| 3.2 | 构建完成后立刻测量 | **单次构建的全表扫描次数**。修复前理论值是数百次（651 页 × 2），修复后应为个位数 |
| 3.3 | 打开首页 / 一个月页 / **一个事件页**各一次 | 每个页面带来的 `seq_tup_read` 增量 |
| 3.4 | 静置 30 分钟，只做被动测量，不制造流量 | 每小时的"全表扫描等效次数" = `seq_tup_read 增量 ÷ 46,742` |

**量化验收标准**：

- 单次构建导致的 `raw_sources` 全表扫描 **≤ 10 次**（修复前推算为 1,300 次量级）
- 单个事件页访问导致的 `raw_sources` 全表扫描 **= 0 次**（C-1 修好后应该完全不碰全表）
- 静置 30 分钟内，`raw_sources` 全表扫描 **≤ 15 次**

**中止条件（任一触发就立刻停）**：
- 静置期间每小时全表扫描 **> 30 次**
- 或 Neon 用量页显示出站流量在第一个小时内 **> 2 GB**

**中止动作**（按此顺序，Teddy 执行）：
1. Vercel → 项目 → Settings → General → **Pause Project**（立即返回 503，函数不再执行，数据库不再被查）
2. 若仍不放心，再次降级 Neon 到 Free

### 8.4 阶段四：稳态与长期（恢复后一周内）

| 步骤 | 操作 |
|---|---|
| 4.1 | 修 C-4（`assembleStore()` 剩余 12 处全表读） |
| 4.2 | 落实 D-1：心跳只本地 commit 不 push，把每日 commit 数从 182 压回个位数 |
| 4.3 | Cowork 每日一次被动巡检：读 `pg_stat_user_tables` 计数器，与前一日对比，异常即报 —— 这个检查本身几乎零成本，不制造流量 |
| 4.4 | **10 月 1 日计费周期重置后重新评估：是否长期留在 Free 版** |

关于 4.4，这是最值得认真考虑的一条长期方案：

| Neon Free 限额 | 当前实际用量 | 是否够用 |
|---|---|---|
| 存储 0.5 GB | 121 MB | 够（但随导入增长，需盯着） |
| Compute 100 CU-hours/月 | 本周期 6.79 | 够，余量很大 |
| 出站流量 5 GB/月 | 修复前一天 1,371 GB；修复后未知 | **这就是要验证的那个数** |

如果 8.3 验证下来"修复后每天出站流量在几十 MB 量级"，那么这个三个读者的家庭站**完全可以长期跑在 Free 版上** —— 而 Free 版有真正的硬闸，从结构上杜绝了再出现一张意外账单的可能。这比"继续付费 + 依赖我的警惕性"要可靠得多。

建议路径：**今晚升 Launch 把站救回来并验证修复 → 10 月 1 日额度重置后，若实测流量确实很低，降回 Free 长期运行。**

---

## 9. 给审核 AI 的重点质疑清单

如果你是被请来审这份报告的，建议优先质疑以下几点：

1. **3.2 节的量级推算**（~87 GB/构建）依赖三个未复测的前提：`raw_sources` 全量约 60–64 MB、可发布事件数接近 651、每次构建都重渲全部静态页。请检查这些前提是否被合理标注、结论是否对前提变化过度敏感。
2. **3.4 节承认无法精确归因**。请检查报告是否在其他地方偷偷把"诱因 A 是根因"当成已证事实（作者认为没有，但这是最容易犯的错）。
3. **7.1 节关于 Vercel Spend Management 不覆盖 Marketplace 的结论**，直接决定了"设消费上限"这条常见建议在此处无效。请独立核实 Vercel 官方文档原文。
4. **第 5 节标注为 [转述] 的那一项**（新构建是否真的成为生产别名）是本报告唯一依赖他人证词的关键结论。请检查它是否被恰当地限定了。
5. **8.3 的量化验收标准与中止条件**是否足够具体、可执行、可证伪。如果某条标准无法用一条命令测出来，它就是无效标准。
6. 第 6 节作者的自我失误清单是否完整，有没有遗漏的责任被写成了客观因素。

---

## 附录 A：复核用命令

```bash
# 时间线
git log --since="2026-09-06 00:00" --oneline | wc -l          # 182
git log -1 --format="%h %ci %s" 2f65c78                        # 诱因 A 引入时间
git log -1 --format="%h %ci %s" 7d7fe15                        # 修复时间

# 诱因 A 是否真的修好（应看到 getAllEventIdentities，不应看到 getOrganizerStore 调用）
grep -n "getAllEventIdentities\|getOrganizerStore" v2/lib/family-archive.ts

# 诱因 B 是否还在（应看到 5 处 select * ）
sed -n '547,568p' v2/lib/db/postgres-repository.ts

# 事件页放大路径
sed -n '14,20p' "v2/app/events/[id]/page.tsx"
sed -n '28,32p' "v2/app/events/[id]/page.tsx"

# 是否存在请求级缓存（应为空 = 无去重）
grep -rn "unstable_cache\|import { cache }" v2/lib/ v2/app/ --include=*.ts --include=*.tsx

# assembleStore 剩余全表读
sed -n '396,425p' v2/lib/db/postgres-repository.ts

# DeepSeek 上限
grep -n "MAX_CALLS\|reserveCall" v2/scripts/organizer-month-write.mjs
sed -n '388,396p' v2/scripts/nianlife-worker.mjs

# 恢复后的监控查询（零成本）
# select relname, seq_scan, seq_tup_read from pg_stat_user_tables
#   where relname in ('raw_sources','media_assets','life_events');
```

## 附录 B：关键 commit 索引

| Commit | 时间(+0800) | 内容 |
|---|---|---|
| `2f65c78` | 09-06 10:54 | 诱因 A 引入（B-17 修复顺带） |
| `ae845cb` | 09-06 15:36 | P0 派单 |
| `3df0ac6` | 09-06 15:41 | 教训写入 CLAUDE.md |
| `7d7fe15` | 09-06 15:47 | **诱因 A 的修复** |
| `cb1d634` | 09-06 16:00 | 重复的止血提交（后已撤回） |
| `6c59750` | 09-06 16:05 | 发现 Ignored Build Step 致命 bug |
| `4a3d2f2` | 09-06 16:05 | Cowork 的错误结论（7 分钟后自行推翻） |
| `4483075` | 09-06 16:12 | Cowork 更正 |
| `5684d91` | 09-06 16:28 | 撤回 stopgap |
| `f44fcaa` | 09-06 16:29 | C 轨事故收尾报告 |
| `89de6d7` | 09-06 16:33 | 三轨停工令 |

---

*报告结束。所有 [实测] 结论均可用附录 A 的命令复现；[转述] 结论已注明验证不了的原因。*
