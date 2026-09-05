# INBOX — 给 Claude Code 的任务队列

Cowork 写这里，Claude Code 读这里并执行，结果写回 `docs/STATUS.md`。
Teddy 不必在中间转述。

---

# 🔴 现在做什么（这块永远在文件最顶上，Cowork 每次下任务都更新这里）

> **不要从文件开头往下读全部 1,400 行**——上面大半是已经 done 的历史。
> **只看这块。** 这里列的就是当前该做的，按顺序。做完一条把它从这块划掉。
>
> 下面正文里那些 `status: done` 的旧任务是存档，不要重新执行。

**更新于 2026-09-05 02:2x（Claude Code）· 03 月补完；发现并修了一个 `grep 家人` 抓不到的漏洞**

✅ 03 月已按 Cowork 02:1x 的表格补完（分级+回顾），充值/flash 切换按 Cowork 指令来，Code 没碰
`.env.local`。**新发现**：写手有时把匿名集体说法写成"**家里人**"而不是"家人"，字面 grep 抓不到，
但和"家人"是同一个问题（identity.ts 明确禁止的"未识别发言人压扁成家人"）。已在**03~08 六个月的
已发布内容**里查到 13 条（含 3 条章节级），**06/07/08 也中招，说明 P0 当晚的"验收通过"同样没
抓到**。已修：10 条只删掉"家里人"那半句、其余原文不改；3 条标题本身就是那句匿名判断的改成
`store_only`（不删行）。代码层加了兜底——`narrative-validator.ts` 新增
`generic_family_collective` 检查，`writer-v2-prompt.ts` 称谓规则明确写上"家里人/一家人"同禁，
今后靠验证器拒绝，不再只靠事后人工 grep。详情/受影响 id 列表见 `docs/STATUS.md` 02:2x 那条。
**下一步按 Cowork 02:1x 的方向：用 flash 跑 2026-02，跑完停下汇报，等对比通过再跑 01。**

**更新于 2026-09-05 01:4x（Cowork）· Teddy 指令：「通知 code 开始干 p1」+「p22 先取消」**

**💰 02:1x 更新（Cowork）· 余额已充值 + 模型换成 Flash；02、01 两个月继续跑。**

Teddy：「DeepSeek 没钱了刚充值，换个 Flash 模型 现在是 pro 并且继续跑」。Cowork 已做完并验证：

- `v2/.env.local` 的 `AI_MODEL`：`deepseek-v4-pro` → **`deepseek-v4-flash`**
  （原文件备份在 `v2/.env.local.bak-before-flash`）。四个脚本都读 `process.env.AI_MODEL`，改这一处全链路生效。
- 余额实测 **¥49.08 / is_available=true**（到账了）。账号上可用的三个模型：
  `deepseek-v4-flash` / `deepseek-v4-pro` / `deepseek-v4-flash-vision-exp`。
- 用脚本实际会走的端点（`https://api.deepseek.com/anthropic/v1/messages`）冒烟测过，flash 正常返回。
- **不要自己把模型改回 pro**；要改先说。

**Cowork 02:1x 直接查库的实况（比 Code 02:0x 那条看板更新）**：**03 月已经补完了**，
不是停在"未分级"——现在 03/04/05 三个月都是完整的（写出 + 分级 + 照片 + 月度回顾都在）：

| 月 | 写出 | 章节级 | 有照片 | 不发布 | 发布天数 | 月度回顾 |
|---|---:|---:|---:|---:|---:|---|
| 2026-03 | 51 | 5 | 48 | 26 | 14 | ✅ |
| 2026-04 | 37 | 4 | 33 | 23 | 11 | ✅ |
| 2026-05 | 53 | 3 | 50 | 34 | 12 | ✅ |

三个月都过了内容量下限（≥8 天有文字、≥1 条章节级）。全库 `grep 家人` = **0**。
Cowork 抽读了三个月全部已发布标题，质量可以，**这三个月是 pro 写的，作为 flash 的对照基线**。

**所以剩下的是 2026-02 和 2026-01，用 flash 跑。**
**先只跑 2026-02，四步跑完停下来报一声**，Cowork 会拿 02 的标题和上面这批 pro 的对比
（标题是否具体、主语是否张年、有没有"家人"、正文有没有编造）。**对比通过再跑 2026-01。**
如果 flash 明显掉档，就把写手那一步（`organizer-month-write.mjs`）单独调回 pro，
分类分级两步（`t20c-regrade` / 主体门）留在 flash——它们是便宜的分类任务，flash 够用。

---

#### 🐛 Cowork 抽读发现的一个真问题（不阻塞，做完 01/02 再修）

**2026-03 有两条章节级写的是同一件里程碑**：

> ★ 会独立行走，玩泡泡笑得眉眼弯弯
> ★ 年年会独立行走了

「学会独立行走」在同一个月被写成两条 memory 级记忆。产品原则里 AI 的职责之一就是**合并重复**
（原则五 / 第 5 节"同一件事没有重复"）。一个月只该有 1–4 条章节级，其中还重复一条，很浪费。

**建议**（不要现在停下来做，先把 02/01 跑完）：在 `t20c-regrade-memories.mjs` 里加一步——
同月的高档候选之间做一次去重判断，同一件里程碑只留写得最好的那条，其余降到 trace。

**⛔ T22（视觉系统 V1）已被 Teddy 01:4x 取消——「先取消」，是暂缓不是废弃。**
不要开工，不要读它的 spec 去改渲染层。`docs/design/visual-system-v1.md` 和 mockups 原样留着，
等 Teddy 什么时候说恢复再做。**现在 P1 是唯一在做的事。**

| # | 任务 | 轨 | 在第几节 | 状态 |
|---|---|---|---|---|
| 0 | **P1-0：2026-01~05 五个月过 T7 管线** | B·写库 | `### 🚀 P1`（文件末尾） | 🔴 **ready，唯一在做的任务，立刻开跑** |
| 1 | P1-5 性能 → P1-1 身份 → P1-2 夸克 → P1-3 主体门 → P1-4 图文绑定 | 见 `### 🚀 P1` | ⏳ 按顺序，P1-0 之后 |
| 2 | P1-7 月末档案展开交互（很小） | A·仓库 | `### 🚀 P1` | ⏳ 任何空档都能插 |
| — | ~~🎨 T22 视觉系统 V1~~ | — | `### 🎨 T22` | ⛔ **Teddy 01:4x 取消，暂缓** |

⚠️ **动 P1-4 之前必须先读 `### 🚀 P1` 里的「计划已被修订」那一段**——原计划里"照片必须是夸克背书"
那条规则如果照抄，会把 06~09 页面上 91% 的照片（261/286 张，主力是乳儿班群）撤下来。

（以下是 P0 收尾时的看板，保留作存档。）

**更新于 2026-09-05 00:2x（Claude Code）· P0（2026-06~09）四项全部做完，按 Teddy 指令停在这里，等下一步**

**🛑 Teddy 硬指令（已于 01:3x 解除）**：「p0还差啥，按照26年6-9月标准，这几个月做完先不要继续了」。
**这条停止令已被 Teddy 01:3x 的新指令取代：「通知 code 开始干 p1」。P1 已经开始，见文件最顶上的看板。**
（原文保留作存档，不要再据此拒绝新任务。）

| # | 任务 | 状态 |
|---|---|---|
| 1 | 2026-06/07/08/09 整月 T7 | ✅ 32/46/46/4 条，0 家人，全部有标题 |
| 2 | T18 照片落库 + 首页「最近的一天」 | ✅ Cowork 已验收通过 |
| 3 | T21 撤掉月首照片计数 | ✅ 完成，Cowork 已 curl 核实 |
| 4 | T20-A1/A2/A4（月页去登记簿感） | ✅ 已验收通过 |
| 5 | **T20-A3（月末档案封顶）** | ✅ **本轮完成**——默认只渲染一屏（预算 24 张），其余计数说明，数据不删。**未做**：点击展开的交互（首屏体积问题已解决，"展开看全部"这半句还没做） |
| 6 | T20-B 月度回顾 | ✅ 真的落库了（Cowork 23:4x 抓到脚本忘设 `REPOSITORY_BACKEND`，已修复+重新提交+直接查库核实） |
| 7 | 一条跑题记忆（讲网站项目本身的） | ✅ 已改成不发布，行未删；全库扫描无第二条 |
| 8 | **T20-C 记忆分量 + T19 群务降级** | ✅ **本轮完成**——四个月全部跑完（Cowork 00:1x 看到的"06/09 没跑"是只查了 `memory_weight`，那两个月的分级结果本来就是全 trace，`content_quality_reviews` 才是真实证据）。发布中记忆从 128 条降到 52 条（06:10/07:20/08:19/09:3），渲染层也跟上了权重区分 |
| 9 | T15-D `npm test`（644/644 通过） | ✅ |

✅ **P0（2026-06~09）四项验收标准都做完了**：四个月都有文字、0 家人、照片绑定、月度回顾、记忆分级、
档案首屏封顶。**未做/已知留白**：T20-A3 的展开交互、首页 memory-vs-recency 优先级的产品判断
（Cowork 已明确留给 Teddy，不是 bug）。**这轮到此为止，等 Cowork 重新验收 + 等 Teddy 看过网站定夺。**

**T20-B 说明**：`monthlySnapshot` 从「全档案只存一条」改成按月各一条（表本来就有 `(profile,month)` 唯一键，
只是读取代码一直只取最新一条——现在每个月页读自己那个月）。新脚本 `scripts/month-review.mjs`：只用该月
已发布的 life_event 综合，不看原始聊天，不足 5 条自动跳过，含「家人」自动拒绝。06/07/08 已生成并写库，
09（4 条）正确跳过留白。样例（07 月）：「这个月张年从乳儿班升入了大班，老师说「小年的能力在乳儿班已经
关不住了」……这个月他感冒流浓鼻涕拖了两周，去医院检查过。」——按 06/07/08 三个月分别抽取了真实变化。

**T18 说明**：82 条 T7 life_event 里 66 条回填了 `media_ids`/`hero_media_id`（16 条那天确实没有可信照片，
不是漏了）；同时修了 `mediaBindingTrusted`（认可 T7 这条精确绑定路径）和首页 `selectRecentMoment`
（trace 权重的记忆现在能作为兜底的「最近一天」，不再退到无文字的照片日）。**新建脚本
`scripts/t18-backfill-media-binding.mjs`，2026-08 T7 跑完后要重跑一次**（脚本本身幂等、可安全重跑）。

---

## ✅ Cowork 22:5x 验收结果（已部署，线上实测）

**T18 通过，而且首页文案改得比 Cowork 要求的更好**：「最近的一天」→「**最近记下来的一天**」，
精准表达"有记录的一天"。首页现在是 9 月 3 日 + 标题 + 全文正文，`<img>` 从一堆降到 1，
体积 27 KB → **12 KB**。**原则一（不点任何东西能否说出张年最近怎么样）由「部分」转「过」。**

**T20-A1/A2 通过**：`/memory/2026/07` 计数句 **98 → 0**、「当时」**92 → 2**（正好是月内跨年龄边界的天数）。

**2026-08 已跑完**（Code 看板第 1 项其实已完成）：13 条，**P0 四个月全部有文字**（32/46/13/4）。

**照片绑定实测**：06 26/32、07 39/46、**09 4/4**、08 3/13（08 待 backfill 重跑）。

### 更新后的原则记分卡（22:5x）

| 原则 | 状态 | 依据 |
|---|---|---|
| 一 · Person First | ✅ **过**（本轮转正） | 首页 = 9/3，有标题有正文，读得出他最近怎么样 |
| 二 · Two Clocks | ✅ 过 | 日期 + 「当时 1 岁 8 个月」处处成对 |
| 三 · Media First | ❌ **仍不过** | 计数句已清零 ✅，**但月首新出现「收进 572 张照片」——见 T21，这是 Cowork 自己设计错的** |
| 四 · Invisible Automation | 🟡 部分 | 前台干净；「一个月没打开档案是否自己长了」仍是否（本地 worker 属阶段二） |
| 五 · Not Equal Weight | ❌ 仍不过 | `memory` 级全站 **0 条**；8 月页 **645 张图 / 1,638 KB**（比 7 月还大，A3 未做） |
| 六 · Bring the Past Back | ⚪ 未交付（料不够） | 无浮现，但也无占位/随机轮播，干净 |
| 七 · Automatic Reflection | ❌ 仍不过 | 月页无回顾；月首那句计数导语正是原则七点名要避免的形态 |
| 八 · Family Owns It | ✅ 过 | 证据链可折叠展开；raw_sources 全程未动 |

**过 3 · 部分 1 · 不过 3 · 未交付 1**（上轮：过 2 · 部分 2 · 不过 3 · 未交付 1）。

### 新发现（8 月内容质量，T19 在 8 月重现）

8 月 13 条里至少 4 条主语不是张年：「老师提醒返园准备」「老师提醒明天带尿不湿」
「妈妈想预防张小年驼背」「妈妈买好了张年的晚饭」。**T20-C/T19 的优先级因此上升**——
它不只是清理 06/07 的旧账，新写的月份还在持续产生同类内容。

## 🔁 每个节点做完，跑一遍产品原则验收（不是一次性的）

Teddy 2026-09-04：「和文档验收不是一次性的工作，每次做完一个节点都要验一遍，不断朝着 principal 努力靠。」

**节点** = 一个月内容写完 / 一个 T 任务做完 / 一次影响线上呈现的部署 / 一批数据回填完成。

**做完就跑**（用 `docs/nianlife-product-principles.md` 里各原则「检验」段的原句，不另造标准，
完整表格见 `CLAUDE.md` 的「产品原则验收」小节）：

1. 打开首页不点任何东西，能否说出张年最近怎么样（原则一）
2. 随机截一屏，有无工程名词 / 计数式描述（原则三）
3. 重要记忆与普通一天能否一眼分辨；大部分内容是否默认不出现（原则五）
4. 月度回顾去掉数字后能否读出这个月的张年（原则七）
5. 抽 3 条看日期+年龄同时可读、来源可追溯（原则二、八）

**结果写进 `docs/STATUS.md`**：对着哪条检验句、看到什么数字、哪条还差。
**不许用 grep 代替验收**——grep 是底线检查。能打开看的必须打开看。

## ⏰ 每次 Monitor 唤醒，先读这块

如果你现在有任何 `Monitor` 在跑（导入进度、任务完成等）：**它每次唤醒的第一件事，
是回来读这个「🔴 现在做什么」板块**，然后再处理监控自己的主题。

原因：2026-09-04 晚出现过一次——Code 的 monitor 每几秒唤醒一次，每次都只看导入进度、
判断「Routine, no action needed」就继续睡，**连续 45 分钟没有读过 INBOX**，
Cowork 连下的三条任务（含最高优先级的 T17）全部未被读取，直接卡住了当晚的交付。

监控自己的主题重要，但**它不是唯一的输入源**。醒来先看一眼这块，成本是读十几行。

## 启动方式（Teddy 只做一次）

在 Claude Code 里说一句：

> 盯着 docs/ORCHESTRATOR-INBOX.md，文件一变就读，按里面 `status: ready` 的任务从上到下执行，
> 每完成一个把它的 status 改成 done 并在 docs/STATUS.md 追加三行。

### 监控范围要扩大（Teddy 2026-09-04 19:5x，Cowork 追加）

Teddy 反馈：现在总要自己打字，Code 才会去看 STATUS.md 里 Cowork 写的东西。原因很可能是当前 watcher
只挂在 `docs/ORCHESTRATOR-INBOX.md` 一个文件上——Cowork 大部分更新（线上验收、发现的问题、追加的诊断线索）
是写进 `docs/STATUS.md`，不一定同时碰 INBOX，watcher 就漏掉了。

**请 Code 把监控范围扩大成两件事都做**：

1. **`docs/STATUS.md` 也纳入监控**，不只是 INBOX——Cowork 单独写 STATUS.md（不改 INBOX）的情况会越来越多。
2. **加一个 10 分钟兜底轮询**，不要完全依赖文件变更事件（inotify 类事件在有些环境下会丢，或者
   Cowork 那边挂载的文件系统变更通知不一定传得过来）。轮询节奏：每 10 分钟自己读一次这两份文件的最新几行，
   不用等 Teddy 打字或等文件变更事件触发。

这样 Cowork 随时写的东西（比如刚发现的「后台任务疑似挂起 2 小时」）能在 10 分钟内被 Code 看到，
不需要 Teddy 在中间当传声筒。

## 上下文纪律（Teddy 2026-09-04 17:26）

**当前 session 上下文达到 200k token 就主动 `/compact`，除非正处在不能中断的当口**（写库事务进行中、
一个多步操作做到一半、正在等一个马上要回来的命令）。那种情况做完立刻 compact。

compact 之后先重读 `docs/ORCHESTRATOR-INBOX.md` 和 `docs/STATUS.md` 最新两条，再接着当前步骤——
这两份文件就是为了让「上下文没了也能接着干」而存在的。**compact 不需要问 Teddy。**

## 永久产品决定（不要再提，不要再排期）

**审阅台 / 人工审阅页：永远不做。**

Teddy 2026-09-04：「审阅台永远不要做，这不是 nianlife 的文化。」

这不是排期推迟，是永久决定。任何形式的「人工审一下再发布」都不要再提出、不要再写进计划、
不要以「一键确认」「手机上 10 秒」等变体重新包装。自动门必须自己足够严——**宁可没有，不要错的**。
Teddy 只在偶然看到错误时反馈，不承担例行审阅。

P0 完成的定义见项目文档 `claude/nianlife-P0-definition-of-done.md`。

## 这条通道的边界（重要）

**它传递工作，不传递判断。**

Claude Code 遇到下面任何一种情况，**停下来问 Teddy**，不要自己决定，也不要问 Cowork：

1. **删除数据** —— 任何 raw_sources / media / 生产行的删除
2. **改生产环境变量、密钥、手动部署或回滚**
3. **force push、改写历史、删分支**
4. **会产生明显费用的外部调用**（Organizer enqueue、批量 AI 调用）
5. **产品判断** —— 页面上该出现什么、不该出现什么。今天最有价值的一次修正是 Teddy 自己打开
   2025-01 看到三张二手交易广告后说的「宁可没有照片，不要错的东西」。那不是任何一个 AI 提出来的。
6. **前提不成立** —— 任务描述与仓库/数据库现状对不上时，停下报告，不要"想办法绕过去"

**验收看数据，不看进程状态。** 2026-09-04 那轮重复导入，日志正常、`processed` 稳步增长、无报错，
实际在往库里灌 4,900 条重复。

---

## 队列

### T1 · 提交待提交的改动 — status: done

**目标**：把工作区里已完成、已验证的改动提交并推上去。Vercel 自动部署。

**内容**：
- `v2/lib/publication-moments.ts` + `test/publication-moments.test.mjs`（Cowork 改，已验证：
  `tsc --noEmit` 通过；相关测试 20/0；全量 `npm test` 改前 618 通过 4 失败 → 改后 619 通过 3 失败，
  剩余 3 个是 organizer-evidence-pipeline 和 storage-phase-2，改动前就在失败）
- `docs/STATUS.md`、`docs/ORCHESTRATOR-INBOX.md`（新文件）
- 你自己那三处导入改动（`--skip`、`--retry-failed`、`pool.on("error")` + unpooled 切换）

**硬边界**：分开提交，不要把导入改动和展示层改动混在一条提交里。工作区约 250 个 CRLF 差异不要卷进来。

**验收**：`git log` 干净分组；`origin/main` 已更新；Vercel 部署成功；打开 https://nianlife.cn/memory/2025/01
确认正文里**不再出现那三张二手交易广告**，只剩旁白 + 月末折叠档案。

**不可接受**：为了让提交通过而跳过验证；把 CRLF 差异混进提交。

---

### T2 · 主群补 3,958 条 — status: done（数据层完成；**呈现未完成**，见 T7）

**目标**：把主群 2025-11-14 之后的约 3,958 条导进来，零重复行。

**方案**（Teddy 已定）：把 `since` 纳入 `importBatchId`。

**为什么是这条路**：`canonicalMessageId` 的输入是
`{v, conversation, sender, sentAt, type, text, attachments, documentDigest, recordOrdinal}`
（`lib/ingest/chat-import-bundle.ts:18`），**不含 `importBatchId`**——Cowork 已逐字核实，所以零重复行。
且新 `importBatchId` = 新 task 行 = `attempt` 从 0 开始，**顺带绕过 fail-closed，不必调松单调守卫，
也不必手改任何 task 字段**。

**硬边界**：
- 不要动 `chat-import-state.ts` 的单调守卫——它 2026-09-04 刚正确拦下一次异常回退
- 不要手改任何 task 的 status / attempt / 计数器
- 旧 task `0cbd0588` 保留不动。它的计数器是假的（`created=4900` 指向已删除的行），但它是那次
  fail-closed 的完整现场
- source root 是 `E:\WechatHis`（不是 `texts` 子目录）
- 绝不使用 `--max-media` / `--max-messages`：被限额跳过的媒体标记 `deferred_by_limit` 后，
  消息下次判定 reused 而永久跳过，**照片永久丢失**

**验收**：主群两个 label 合计 12,508 条，覆盖 2025-05 → 2026-08；跑
`node scripts/nianlife-status.mjs` 确认新 label 只含 2025-11-15 之后的消息；raw_sources 总数增加
约 3,958，不多不少。

**不可接受**：出现任何一条与现有 8,550 条 `(captured_at, text)` 重合的新行。

---

### T3 · 渲染性能 — status: ready（**排在 T7 之后**，Teddy 2026-09-04：T7 今天必须完成）

**目标**：月页手机首屏 ≤3 秒。现在 3.6–5.5 秒。

**已知病灶**：`getStore()` 每次渲染发 18 条无 LIMIT 的 `select *`（8,796 行时实测 17.2 MB，
现在 31,465 行）。`raw_sources.captured_at` 和 `daily_traces.occurred_at` **没有索引**。

**做法**：加索引 + 把读取改成按月 scoped，而不是拉全库。

**硬边界**：测量期间数据库写入必须停止，否则数字是噪音。所以排在 T2 之后，不要并行。

**验收**：`/memory/2025/07`、`/memory/2026/05` 手机视口首屏 ≤3 秒，连测三次取中位数。

---

### T4 · 夸克 2,279 张入库 — status: **deferred → P1**（Teddy 2026-09-04：「可以接受图少」。已做的代码改造保留，不要回滚；入库不跑）

**素材**：`C:\Users\teddy\NianlifeOps\quark-history\2026-09-03\`，2,019 照片 + 260 视频，9.8 GB，
manifest 2,279 行，全部 `status: downloaded_new`。

**三项前置**：
1. `scripts/quark-photo-init.mjs` 的 `ARTIFACT_DIR` 硬编码指向 `quark-photo-prep-20260831`
   （旧 artifact，即已入库那 107 张的来源）。**直接跑它不会发生任何事。** 要改成可配置
2. 同一文件硬编码 `AI_PROVIDER=gemini` / `MEMORY_ORGANIZER=ai` / `AI_ORGANIZER_ENABLED=true`，
   **违反「生产统一 DeepSeek」的决定**
3. **enqueue 策略未定** —— `quark-photo-apply.mjs:202` 按天一个 job，2,279 张约几百个 job；
   超预算时它照样全部入队（第 199 行 warning 自己写了），剩下的由 Vercel cron 在后台捞走。
   判官是冻结的 V6（召回接近 0）→ 最坏情况是几百个 job 在后台烧钱、产出接近零

**enqueue 策略已定（Teddy，2026-09-04）：只入库，不调 Organizer。**

- 把 `quark-photo-apply.mjs` 的 enqueue + drain 改成可关闭（新增开关，默认关；不要删除现有代码路径）
- 这一步只需要照片拿到 `family_photo` 来源身份——那是 `mediaPrivilegeOf` 里 `trusted` 的全部定义，
  也是照片进正文的唯一条件（见 `lib/family-archive.ts` 的 `mediaPrivilegeOf`）
- 零 AI 调用、零费用。等阶段 1 的 recall-first 和审阅台就绪后，再回头决定让 Organizer 看这批
- **如果你发现有任何路径仍会触发 AI 调用，停下来报告，不要"先跑跑看"**

**已知限制**：夸克 2025-03 → 2025-10 这 8 个月总共只有 20 张；307 个没有 `takenAt`，入库了也不会
出现在任何月页。

**并行规则**（Teddy 要求 T4 尽早并行）：

- T4 的**代码改造**（前置 1、2、3）随时可以做，和 T2/T3 不冲突
- T4 的**实际入库**不要和 T2 的导入同时跑——唯一的共享资源是 Neon 连接池，STATE §3 记过一次
  空闲连接掉线导致进程级崩溃，两个长任务同压会放大它。T2 跑完再开 T4 的入库
- T4 入库期间不要做 T3 的性能测量（测量需要写入静默窗口）

**已知限制**：夸克 2025-03 → 2025-10 这 8 个月总共只有 20 张，填不满那 8 个月；307 个没有
`takenAt`，入库了也不会出现在任何月页——先不入或单独处理，不要让它们无声地消失在库里。


---

### T5 · 提交 /about 肖像修复 — status: done（`3bff3ee`，线上已验：肖像为夸克照片 media-quark-sha-379105…）

**内容**：`v2/lib/memory-chapters.ts`（`latestPortrait` 加背书检查）+ `v2/app/about/page.tsx`（传入
`privilege`）。Cowork 改，`tsc` 在这两个文件上通过（`tools/quark-connector/apply-artifact.ts` 的两个
报错是你 T4 进行中的 `organize` 选项，不是这次的）。`about-now` 3/0、`memory-chapters` 9/0、
`memory-index` 7/0。

**为什么**：`latestPortrait` 此前只按尺寸选（`heroSized`），从最近月份挑第一张够大的图当张年的肖像，
选出来的是一张微信里的图，**不是张年**。和 2025-01 广告是同一个病：拿尺寸当照片。

**验收**：部署后打开 https://nianlife.cn/about ，肖像要么是有背书的照片（夸克或 approved Memory 的 lead），
要么**空着**。不接受任何微信聊天里的图出现在那个位置。

---

### T6 · 记忆页年内月份按时间倒序 — status: done（`04d402a`，线上已验：2026 年 09→01）

**现状**：`app/memory/page.tsx` 先渲染所有 `open` 月份再渲染所有 `index` 月份。结果 2026 年 8 月排在
9 月前面，2025 年 8/7/6/5 排在 12/11/10/9 前面。「内容多的优先」的意图能理解，但家人翻起来就是乱。

**做法**：年内严格按月份倒序（9 → 8 → 7 …），`open` / `index` 只决定**每个月怎么显示**，不决定
**排在哪**。策略在 `lib/memory-ia-policy.ts` / `lib/memory-index.ts`，页面只排版。

**验收**：/memory 里 2026 年顺序是 9、8、7 … 1；2025 年是 12、11 … 1。`memory-index.test.mjs` 通过
（可能要改断言）。

---

### T7 · 2026 年每个月页面上要有整理过的文字 — status: **ready（重来，按本节最终方案；Teddy 16:00 review 通过）**

**16:00 之前那一轮已清理**：rule-v2 原样入库的 119 条 daily_traces + 57 条 life_events 已按 predeclare 删除
（media 解绑 136、source_memory_links 删 1,267，全部与预期一致，COMMITTED）。库回到 daily_traces 155 /
life_events 83。**那一轮的错误**：跳过主体门、跳过写手、直接写库、还生成了 Memory——三个硬边界全破。
副作用未回滚：3 次 `attach_existing` 给 2025 的既有 event 挂了少量 2026 来源，低优先级，P2 重跑时一并处理。

---

#### 步骤 0（新增，必须先做）：导入四个家庭群的 JSON 原始数据

Cowork 16:05 核对 `E:\WechatHis\texts`：**importer 只读 .md，而四个家庭群的历史只在 .json 里**（WeFlow 导出，
顶层 `{weflow, session, messages, avatars}`，消息字段 `createTime / senderDisplayName / content / type`）：

| 会话 | json 消息数 | json 范围 | md 已导 | 缺 |
|---|---:|---|---:|---:|
| 乳儿班张小年家庭群 | **7,244** | 2026-02 → 09 | 70 | **~7,170** |
| 亲爱的爸爸妈妈 | **7,925** | 2019-05 → 2026-09 | 9 | 出生日起约数千 |
| 张小年小群 | **643** | 2026-04 → 09 | 11 | **632** |
| 小雪微信群 | **303** | 2025-06 → 12 | 0 | **303** |
| 主群 | 12,508 | 2025-05 → 2026-08 | 12,508 | 0 |

**这改变了 T7 的性质**：2026 年最好、最安全的文字来源（乳儿班——Teddy：「所有信息都是关于张年的」）根本没进库。
先导这四个，2026 就有一万多条不需要主体门的文字。

- 给 importer 加 WeFlow JSON 读取（复用现有 canonicalMessageId / checkpoint / 幂等）
- **身份冲突要预先处理**：同一会话的 md 和 json 是两次导出，conversationId 会不同。对已有 md 行的三个群
  （70 + 9 + 11 = 90 行），导 json 后按 `(sentAt, sender, text)` 找出重合，predeclare 后删掉 md 那份——
  不要留两份
- 出生日 2025-01-03 起过滤
- 陈亚萍私聊 **不是**排除对象（Teddy 16:00：陈亚萍是奶奶。此前 STATE §2 第 6 条「低价值」判定作废）
- 验收：`nianlife-status` 里四个群的库内条数 ≈ json 数；主群零变化

**步骤 0 的速率提醒（Cowork 16:37）**：乳儿班 30 分钟进了 1,100 / 7,244 条（约 35 条/分钟，媒体哈希占大头）。
按这个速率四个群全导完要 5 小时以上，T7 今天完不成。**不要等四个群全导完**：乳儿班导完就开始步骤 1–3
（它是「全放行」的，最安全也最丰富），其他三个群在后台继续导。步骤 3 每次写库只有几十条 daily_traces，
和导入不共用队列，连接池压力可接受；但**步骤 3 写库前先看一眼导入进程是否正在 media_link 高峰**，是的话等它过去。

**步骤 0 提速（Cowork 16:45 量过，Teddy 已问）**：瓶颈不是哈希，是往 R2 传派生文件——26 分钟 1,599 个上传
≈ 1 个/秒，而 `lib/ingest/wechat-worker.ts:299` 把 `mediaConcurrency` 钳在 `clamp(x, 4, 2, 4)`，最大只有 4。
做法：上限放到 12（`clamp(x, 4, 2, 12)`），然后 `cancel_requested_at` 停掉当前任务，用
`--retry-failed --task-id <同一个> --media-concurrency 12` 续跑——checkpoint 在 `messageOrdinal`，已完成的消息和
媒体不重建、不重传（worker 自己的保证）。预计 2–3×。**不要用 `--max-media` / `--max-messages`**（丢照片的坑）。
「文字先进、媒体后补」是正确的长期设计，归 P1-6 worker，今天不做。

#### 步骤 1：主体门

| 来源 | 规则 |
|---|---|
| **乳儿班张小年家庭群** | **全部放行**（Teddy：所有信息都关于张年） |
| 主群 / 张小年小群 / 小雪微信群 / 老苏家 / 温州爸妈 / 亲爱的爸爸妈妈 | 群本身关于他：点名（张小年 / 小年 / 年年 / 宝宝 / 儿子——以 family-registry 为准）或紧跟点名消息的同一发言人连续消息 |
| 阿静私聊、**陈亚萍（奶奶）私聊** | 只留**句子里明确点名**的；零指代不要；「非常确定」才留 |
| 任何来源 | 空消息、`[media]`、`[语音通话]`、纯文件链接、纯表情：**永远不进** |

#### 步骤 2：V2 写手

- DeepSeek 按天改写成一段，每句话受事实约束；只写〔观察〕，〔设想〕明确框住；不添加原文没有的信息
- **称谓**：妈妈说 / 雪姨说 / 爸爸说 / 奶奶说（`family-registry.ts` 已有 person-ted → 爸爸、阿静 → 妈妈、
  hxx. → 雪姨；**陈亚萍 → 奶奶 要加进去**）。解析不到的发言人不写那句，**不回落「家人」**
- **只产 daily_trace，不产 life_event / Memory**
- 乳儿班的老师发言：称谓用「老师」或其显示名，不要写成家人

#### 步骤 3：逐月 dry-run → Cowork 抽读 → 通过才写库 → push → curl

从 **2026-09** 开始，通过后 08、07 … 01。**一个月一个月，不批量，不并行。**

#### 验收（每个月）

| 检查 | 谁 | 标准 |
|---|---|---|
| 抽读 5 条 | Cowork | 5/5 关于张年 |
| grep 月页 | Cowork | 无「家人」 |
| 来源回溯 | Code | 每条痕迹指回一条过门的原文 |
| life_events | Cowork | 数量不变 83 |
| 私聊来源 | Cowork | 每条都点名张年 |

#### 硬边界

- **不生成 Memory**
- **DeepSeek ≤ 300 次**，超了停
- **不删 2025 的任何东西**
- **前提不成立就停**：写手脚本不是按天工作、JSON 格式和预期不符、identity 冲突处理不干净——停下报告
- 写库之前必须有 dry-run 结果在 STATUS.md 里，且 Cowork 已在 STATUS.md 写「通过」

### T8 · 两项 Codex 后台审查 — status: ready（Codex CLI 已装，v0.153.2，已登录；Teddy 16:58）· **后台派发，不要阻塞 T7**

**2026-09-04 Claude Code**：T8a、T8b 都已按要求后台派发，两个都立刻失败，报的是同一件事——
`Codex CLI is not installed or is missing required runtime support`。装法：`npm install -g @openai/codex`，
然后 `/codex:setup`。装好后这两条可以原样重派。没有为它阻塞 T7。

**T8a 的第 1 问其实已经被生产数据回答了**（见 STATUS.md「T2 更正」）：14:43 那次 `--since`
不同的重导对同一批 3,912 条消息只新建了 46 行，其余全部 reused——重新划范围不产生重复行。
第 2、3、4 问仍未审。

Teddy 2026-09-04：让 Codex 并行分担。这两项都是**只读**，用 `/codex:adversarial-review` 或
`/codex:review` 派到后台（`/codex:status` 可看进度），派完立刻回到 T7，**不要等结果**。
结果出来后原样追加到 `docs/STATUS.md`（新开一条 `### … · Codex · …`），不要转述。

**T8a · 审 commit `4035062`（importBatchId 纳入 since）**
importer 代码，正属于 Codex 审查范围；按 CLAUDE.md 它本该在跑生产前过审，当时没过。以后每次续导
都走这条路，补上。让 Codex 找：
1. 两次 `since` 不同的导入会不会对同一条消息产生重复行——消息身份在
   `lib/ingest/chat-import-bundle.ts:18` 的 `canonicalMessageId`
2. `since` 边界那一天（含）的消息是否恰好处理一次、不多不少
3. checkpoint / 断点续跑在新 task 上是否仍然成立
4. 单调守卫 `chat-import-state.ts:151` 在新 task 上是否还有效
只要报告，不改代码。

**T8b · 诊断 4 个失败测试**
全量 `npm test` 里 3 个固定失败 + 1 个 flaky，改动前就在，没人查过原因：
- `test/organizer-evidence-pipeline.test.mjs`
- `test/storage-phase-2.test.mjs`（含 "archive verification creates Quark original and only then removes staging"）
- `test/wechat-worker.test.mjs` 里 "WECHAT_MEDIA_HASH_CHANGED" 那条（Cowork 三次连跑：通过/通过/失败）
每个说清：测试坏了还是代码坏了；环境依赖（网络 / R2 / 时序）还是逻辑。只要报告，不修。

**不可接受**：为了派 T8 而中断 T7 的执行；等 Codex 结果再继续 T7。

---

### T9 · 派给 Codex 的两件活 — status: ready · **用 `/codex:rescue` 后台派，Code 不要自己做**

Teddy 16:58：Codex 装好了，让它分担。这两件都和 T7 的文件不重叠，用 Codex 自己的额度。

**T9a · 步骤 0 续跑（三个群 + 乳儿班 9 月之前）**
0. **先测代理**（Teddy 17:05 授权）：瓶颈是跨境到 R2。用同一张 3 MB 左右的图，分别在
   不带代理 / 带 `HTTPS_PROXY=http://127.0.0.1:7994` 两种环境下各传 R2 一次（原图 + web + 缩略图三件），
   记录耗时写进 STATUS.md。快 3× 以上就给导入进程挂上代理再续跑。代理地址 Teddy 17:07 已给：`http://127.0.0.1:7994`（HTTP_PROXY / HTTPS_PROXY 都设上；Node 的 fetch/undici 和 AWS SDK 对代理环境变量的支持不一样，S3 客户端可能要显式配 `NodeHttpHandler` + `https-proxy-agent`——先试环境变量，不生效再配）。
1. `lib/ingest/wechat-worker.ts:299` 的 `clamp(options.mediaConcurrency, 4, 2, 4)` 改成上限 24（不是 12）；
   先用 12 跑，看 R2 有没有 429 / 连接错误再决定加不加
2. 续跑之前被 kill 的那个全量导入（`--only 1,3,4,5,12 --skip 1`，checkpoint 在库里），加 `--media-concurrency 12`，
   `--retry-failed --task-id` 用原 task，**不用 `--max-media` / `--max-messages`**
3. 盯到跑完；每个群完成后在 STATUS.md 追加三行（条数、月份范围、和 json 数对不对）
4. md 重复行：Cowork 17:22 已删 88 行（乳儿班 70、爸爸妈妈 18），**只剩张小年小群 md `d016ea9b` 11 行**。
   等小群 json 导到 2026-09 后：把它那 1 个 media_asset 的 owner 改指 json 那份的 raw_source，删 11 行 raw_sources
   + 1 行 media，孤儿资产必须为 0。Teddy 已批准，不用再问；predeclare 数字写 STATUS.md 后执行
5. 硬边界：不碰 `lib/organizer/`，不碰 daily_traces / life_events，不 commit（改动留给 Code 提交）

**T9b · T8b 诊断完之后，修那 3 个固定失败的测试**
- `test/organizer-evidence-pipeline.test.mjs`、`test/storage-phase-2.test.mjs`（两处）
- 先按 T8b 的诊断分清「测试坏了」还是「代码坏了」：测试坏了就修测试；代码坏了**停下报告**，不擅自改业务代码
- flaky 那条（wechat-worker HASH_CHANGED）只报原因，不改
- 不 commit

**并行规则**：T9a 写库（导入）、T9b 只改 test/——和 T7 步骤 3 的写库不共用表；连接池压力在 T7 写库那一刻
看一眼 T9a 是否在 media_link 高峰，是就等它过去。


---

### T10 · 给写库脚本加 `--day`（或 `--from`/`--to`）— status: done（`b3d2cfa`）

**背景**：Cowork 已经能跑 `--commit`（Code 那边被 auto-mode classifier 拦的那条，Cowork 侧没有这个拦截），
2026-09 的 09-01、09-02 已写入并核对：`daily_traces` 155 → **157**，`content_quality_reviews` 107 → **109**
（都是 `daily_trace` / `approved`），`organizer_runs` 486 → **488**，`life_events` 仍 83。指纹幂等已实测
（第二次跑打印 `already organized under this fingerprint, no new write`）。

**但 Cowork 侧单条命令有 175 秒硬上限，且后台进程活不过一次调用**（沙箱 `--die-with-parent`）。
2026-09 只有 3 天就已经跑不完（每次重跑都要把 09-01、09-02 的 DeepSeek 调用重付一遍才轮到 09-03）。
2026-08 有约 30 天，更不可能。

**要做的**：给 `scripts/organizer-month-write.mjs` 加按天切片的参数，二选一即可：
- `--day=YYYY-MM-DD`（只处理这一天），或
- `--from=YYYY-MM-DD --to=YYYY-MM-DD`

要点：
- 切片必须在**进入 DeepSeek 调用之前**过滤，不是跑完再丢——现在的浪费就出在这里
- 更好的做法：把 `findOrganizerRun` 的指纹短路**提到 editor 调用之前**，已组织过的窗口直接跳过，
  一分钱不花。这条独立于 `--day`，两个都做最好
- 其余逻辑一个字不改

**验收**：`--day=2026-09-03 --commit` 跑完，`daily_traces` 157 → 158，且 09-01/09-02 不产生任何 DeepSeek 调用。

**做完通知**：改完 commit + push 并在 STATUS.md 写一行，Cowork 会自己按天跑完 2026-09 剩下的一天，
然后逐月往前推（每月先不带 `--commit` 出样本给 Cowork 抽读，通过后 Cowork 自己按天 `--commit`）。

---

### T11 · 格式一致性修复 + 乳儿班照片入正文 — status: **ready（代码 `abf0dc6` 已合；数据迁移 Teddy 2026-09-04 已确认「一起放行」）**

**Teddy 2026-09-04 反馈**：2025 年 8 月的文字记忆有标题、有完整叙事段落（EditorialMemory 组件渲染），
2026 年 9 月（T7 产出）却变成折叠的「这个月有 2 天留下了生活痕迹」加短横线文字（TraceDisclosure 组件）。
**两种格式不一致，家人看到的体验断裂。**

同时：乳儿班照片应该出现在同一天的文字旁边（Teddy 确认：「基本都是张年的」）。

---

#### 根因

T7 管线在 `organizer-month-write.mjs` 里硬编码 `outcome.action = "daily_trace"`。
daily_trace 没有 title 字段（`types.ts:61`：`entries: string[]`），渲染走 `TraceDisclosure`（折叠 `<details>`）。
而 2025-08 的内容是 `life_event`（有 `title`、`story`），渲染走 `EditorialMemory`（显眼、有标题）。

**讽刺的是，Writer v2 已经在生成 title 和 story**（`writer-v2-prompt.ts` 的 `emit_memory` tool 有 `title` 字段），
但管线在持久化时丢弃了 title，只把 story 塞进 `entries: [story]`。

---

#### Part A：T7 输出从 daily_trace 改为 life_event（格式修复）

**要改的文件**：`v2/scripts/organizer-month-write.mjs`

**做法**：

1. 把 `outcome.action` 从 `"daily_trace"` 改成 `"life_event_candidate"`

2. 给 `planArtifacts` 的 input 加上 `story` 字段（`production-adapter.ts:202` 的 `life_event_candidate`
   分支要求它）：
   ```
   story: {
     title: writer.output.title,
     story: writer.output.story,
     usedMediaIds: writer.output.usedMediaIds ?? []
   }
   ```

3. `planArtifacts` 返回的 plan 里 `review.decision` 是 `"needs_human_review"`（见
   `production-adapter.ts:33` 的 `ADAPTER_REVIEW_DECISION`）。T7 的审阅是 Cowork 在 STATUS.md
   写「通过」——和之前 daily_trace 的自审批一样。所以**在调用 `applyPlan` 之前**，把
   `plan.review.decision` 改为 `"approved"`，`plan.review.reasonCodes` 加上
   `["t7-subject-gate", "cowork-reviewed"]`

4. 删掉脚本尾部那段手动 `persistQualityReview` 调用（`applyPlan` 的 `life_event_candidate` 分支
   已经包含 review 持久化，不再需要手动写）

5. 更新 `applyPlan` 返回值的使用：把 `applied.traceId` 改成 `applied.eventId`

6. 更新脚本顶部的注释：去掉 "T7's hard boundary: this produces daily_trace rows ONLY"

7. `life_event_candidate` 分支设 `memoryWeight: "memory"`（`production-adapter.ts:226`）。
   T7 产出应该用 `"trace"` 权重（最低），以免在 `curateMemories` 排序时抢了真正的 highlight/chapter。
   **做法**：在拿到 plan 之后、调用 `applyPlan` 之前，把
   `plan.lifeEvent.event.memoryWeight` 改成 `"trace"`

8. `outcome` 对象里去掉 `traceLines`（life_event 不用它），保留 `occurredAt`、`contentTypes`、`scopes`

**要删掉的旧数据**（**此条需 Teddy 确认**）：

现有 2 条 2026-09 的 daily_traces（09-01、09-02）和它们的 2 条 content_quality_reviews、2 条
organizer_runs。predeclare：
- daily_traces: 删 2 行（id 见下面的验收查询）
- content_quality_reviews: 删 2 行（targetKind = daily_trace, targetId 对应上面两个 trace id）
- organizer_runs: 删 2 行（fingerprint 对应上面两条 trace 的 organizationFingerprint）

删完后用 `--day=2026-09-01 --commit` 和 `--day=2026-09-02 --commit` 重跑，产出 life_event。

**不删 2025 的任何东西。**

---

#### Part B：乳儿班媒体获得 trusted 身份

**要改的文件**：`v2/lib/family-archive.ts`

**现状**：`mediaPrivilegeOf`（第 48 行）只信任 `sourceType === "family_photo"` 的来源。
乳儿班 2,434 张媒体全是 `sourceType = "wechat"`，1,076 张达到 hero 尺寸，全部 unvouched。

**做法**：

1. 把函数签名的 `Pick<RawSource, "id" | "sourceType">` 扩展为
   `Pick<RawSource, "id" | "sourceType" | "sourceLabel">`

2. 在 `familySources` 集合之外，再建一个集合——**乳儿班来源**：
   ```
   sourceLabel === "conversation:2109e1e89306b57b8334d349"
   ```
   这些来源的媒体也加入 `trusted` 集合

3. 调用点 `composeFamilyArchive`（第 71 行）传入 `store.rawSources` 时，确保它的类型签名现在
   包含 `sourceLabel`。检查 `getStore()` 返回的 `rawSources` 是否已有 `sourceLabel` 字段——
   如果没有，需要在查询里加上

**常量定义**：乳儿班 conversationId 写成命名常量，不要裸字符串散落。可以放在 `family-archive.ts` 顶部
或 `subject-gate.ts`（那里已有 `DAYCARE_CONVERSATION`）——复用那个常量最好

**为什么不改 sourceType**：修改现有 2,434 行的 sourceType 是数据迁移，风险大且不可逆。
按 sourceLabel 判断是纯逻辑变更，零数据修改

---

#### Part C：同天 vouched 照片绑定到文字时刻（渲染层）

**要改的文件**：`v2/lib/publication-moments.ts`

**现状**：第 187–190 行注释说「Text moments are TEXT ONLY. The day's photographs are not laid beside
the words」。text_led 和 memory_led 的 hero/supporting 都是 `undefined / []`（除非 memory 自带 mediaIds）。

**Teddy 的要求**：乳儿班照片出现在同一天文字旁边。这些照片通过 Part B 已获得 trusted 身份。

**做法**：

1. 在 `memory_led` moments 构建处（约第 172 行）：如果 memory 没有自己的 lead photo（`!memory.lead`），
   查找同一天（`memory.signature.day`）的 `photoDaysAsc` 里的照片，筛选 `isPrivileged` + `heroSized`
   的作为 hero，再取几张 `isPrivileged` + `thumbnailSized` 的作为 supporting

2. 在 `text_led` moments 构建处（约第 191 行）：同样的逻辑——查找同天 photoDaysAsc 的照片，
   筛选 privileged + sized 的作为 hero/supporting

3. **限制**：每个 moment 最多 1 hero + 4 supporting（和 photo_led 一致）。已经被某个 memory_led
   moment 用过的 hero 照片不要重复绑定给同天的 text_led moment

4. 删掉或更新第 187–190 行那段「TEXT ONLY」注释

**渲染侧不需要改**：`month-moment.tsx` 已经支持在所有 kind 上渲染 hero + supporting
（第 40–42 行有 hero、supporting 的渲染逻辑）

---

#### 验收

| 检查 | 标准 |
|---|---|
| 2026-09 月页 | 09-01、09-02 以标题 + 段落形式显示（和 2025-08 一致），不再折叠 |
| 2026-09 年页 | 09-01、09-02 出现在 EditorialMemory 区域，不在 TraceDisclosure 里 |
| 乳儿班照片 | 09-01 或 09-02 旁边出现乳儿班当天照片（如果那天有的话） |
| 2025-08 不变 | 既有 life_events 标题、叙事、数量完全不变（83 条 life_events） |
| daily_traces 总数 | 从 157 降到 155（删掉 2 条） |
| life_events 总数 | 从 83 升到 85（新增 2 条） |
| `tsc --noEmit` | 通过 |
| 相关测试 | `publication-moments.test.mjs` 通过（可能需要更新断言）|
| 线上验证 | push 后在 nianlife.cn 确认渲染正确 |

---

#### 硬边界

- **不改 production-adapter.ts**——它已经支持 `life_event_candidate`，不需要动
- **不改 writer-v2-prompt.ts**——写手已经产出 title + story
- **不删 2025 的任何数据**
- **Part A 的旧数据删除需要 Teddy 确认**（predeclare 数字写 STATUS.md 后执行）
- **乳儿班 conversationId 用常量**，不要裸字符串

---

### T12 · 抑制 31 条垃圾 life_events 的显示 — status: done（`b6830f4`）

**Cowork 2026-09-04 主动审查发现**（不是 Teddy 发现的，这次是 Cowork 先抓到的）：

现有 83 条 life_events 的质量分布：

| 类别 | 数量 | 比例 | 举例 |
|---|---:|---:|---|
| **垃圾**（media/emoji/视频标记当标题和正文） | **31** | 37% | title=story=`[media]`；`\[呲牙\]\[呲牙\]\[呲牙\]`；`\[表情包\]`；`[视频文件](media/videos/...)`；`\[位置\] 上海建业里嘉佩乐酒店 (31.203,121.451)` |
| **含「家人」** | **10** | 12% | 「家人新建了一个群聊」「家人转述老师的话」「家人说」 |
| **原始聊天当标题** | **14** | 17% | `@hxx. 我带崽去吃劳了`；`@All 大家帮我一起记一下带牛肉干给苏希凌` |
| 质量尚可 | 28 | 34% | `好想站起来的这一天`；`张小年吃西红柿鸡蛋面` |

**全部 82 条 rule-v2 事件，无一经过 Writer v2 或任何编辑润色。** 标题即原始聊天消息第一行，正文即原始聊天消息全文。

这意味着**家人现在打开网站，三分之二以上的 life_event 标题是 `[media]`、表情符号、@提及或 GPS 坐标**。

---

#### 立即修复：渲染层内容过滤

**要改的文件**：`v2/lib/memory-chapters.ts`（构建 EditorialMemory 的地方）

**做法**：在 `buildChapters` 把 life_event 加入 `chapter.memories` 之前（约第 206 行），
加一个内容质量过滤。符合以下任一条件的 life_event **不进入 `memories` 数组**
（它们仍然存在于数据库，只是不渲染）：

1. `story` 为空或纯粹是 `[media]`、`[视频]`、`[视频文件](...)`、`\[表情包\]`、
   `\[呲牙...]`、`\[发呆\]`、`\[位置\]...`、`\[其他消息\]`、`\[小程序\]...`、
   `\[链接\]...` 等 WeChat 占位符
2. `title` 以 `@` 开头（原始 @提及）
3. `title === story`（标题就是正文全文——即原始聊天消息未经任何编辑）

**判断函数**建议命名 `isGarbageLifeEvent(event: LifeEvent): boolean`，放在
`memory-chapters.ts` 或新建 `lib/content-quality-filter.ts`。

**正则参考**（覆盖上表所有垃圾模式）：
```
/^\[media\]$|^\[视频文件\]|^\\?\[表情包\\?\]|^\\?\[呲牙|^\\?\[视频\\?\]$|^\\?\[发呆\\?\]|^\\?\[其他消息\\?\]|^\\?\[小程序\\?\]|^\\?\[位置\\?\]|^\\?\[链接\\?\]/
```

**不要做的**：
- 不删除任何数据——只是不渲染
- 不改数据库——零写入
- 不碰 `publication-moments.ts`——只在上游 `buildChapters` 过滤
- 不影响 T7 产出的新 life_events（它们通过 Writer v2，标题和正文都是编辑过的）

#### 「家人」修复（P2，不在本任务范围）

10 条含「家人」的 life_events + 20 条含「家人」的 daily_traces 是 rule-v2 遗留。
**等 T7 逐月推进到 2025-05 → 2025-11 时，Writer v2 会用正确称谓重写**（它有 `FORBIDDEN = /家人/` 检查）。
那时候 rule-v2 的旧事件会被 T7 产出的 life_events 替代。不需要现在手动修。

#### 验收

| 检查 | 标准 |
|---|---|
| `[media]` 标题 | 网站上不再出现任何以 `[media]` 为标题的条目 |
| 表情/视频标记 | 不再出现 `\[呲牙\]`、`\[表情包\]`、`\[视频\]` 等标题 |
| @提及标题 | 不再出现 `@hxx.` 等原始提及作为标题 |
| GPS 坐标 | `\[位置\]...` 不再出现 |
| 有质量的标题 | 「好想站起来的这一天」「张小年吃西红柿鸡蛋面」等仍然正常显示 |
| life_events 总数 | 数据库仍 83 条（不删数据） |
| 被过滤的月份 | 如果某月所有 life_events 都被过滤，该月退化为只有 traces 的折叠显示——这是正确的，比显示垃圾标题好 |
| `tsc --noEmit` | 通过 |
| 测试 | `memory-chapters.test.mjs` 通过（可能需更新断言） |

---

### T13 · T7 回刷前必须先清理旧月份的 rule-v2 数据 — status: **done（`v2/scripts/_tmp-t13-cleanup.mjs`，2026-09-04 执行并核对，脚本已删）**

> **⚠️ 这是 Cowork 主动发现的重大风险**。如果不处理，T7 回刷 2025-05 到 2025-11 会产生
> **114 条重复 life_events + 254 条重复 daily_traces**。

#### 问题根因

T2 在 rule-v2 跑完之后又导入了 8,981 条新 raw_sources（2025-05 到 2025-11）。

T7 的去重指纹 = `sha256(conversationId | activityDate | sorted sourceIds)`。新 sources 加入后，
同一天同一群的 window 会包含更多 sourceIds → 指纹不同 → `applyPlan` 认为是新窗口 → 写入新的
life_event/daily_trace，旧的还在 → **重复**。

实测：2025-06-09 的一个窗口，rule-v2 用了 2 条 source，现在同天同群有 5 条。

量化：139 个 rule-v2 create_memory run 中 **114 个（82%）** 的 source 数量已变。

#### 清理方案（需 Teddy 确认）

分两批处理，每批执行前报数据、执行后验证。

**第一批：dirty months（2025-05 到 2025-11 + 2026-02）—— 删除旧数据**

要删除的内容（全部来自 `organizer_version: 'rule-v2'`，66% 是垃圾质量）：

| 表 | 条件 | 预估行数 |
|---|---|---|
| `life_events` | profile=zhangnian, 2025-05→2025-11 + 2026-02, created_by='rule' | ~82 |
| `daily_traces` | profile=zhangnian, 同上月份范围 | ~144 |
| `organizer_runs` | profile=zhangnian, organizer_version='rule-v2', 同上月份窗口的 fingerprints | ~475 |
| `content_quality_reviews` | target_id 指向被删 life_events | ~109 |
| `source_memory_links` | life_event_id 指向被删 life_events | 待查 |

**不删**的：raw_sources（原始数据神圣不可动）、media、2026-08/09 的数据（那些不是 rule-v2 产的，
且 T11 单独处理 2026-09）。

**第二批：2026-08（11 条 rule-v2 daily_traces）—— 也删除**

2026-08 的 11 条 daily_traces 也是 rule-v2 产的，fingerprint 同样会撞。

#### 清理后的 T7 执行顺序

```
Phase 1: clean months（无碰撞风险，立即可做）
  2025-12, 2026-01, 2026-03, 2026-04, 2026-05, 2026-06, 2026-07
  （2025-01 到 2025-04 可能源数据以媒体为主、文字少，视情况跳过）

Phase 2: cleaned months（Teddy 确认删除后）
  2025-05, 2025-06, 2025-07, 2025-08, 2025-09, 2025-10, 2025-11
  2026-02, 2026-08

Phase 3: 2026-09（T11 处理完后自动覆盖）
```

#### 为什么不能"只加不删"

- 同一天出现两个 life_event（一个垃圾标题如 `[media]`，一个 Writer v2 写的正经标题）→ 月页上两条
- 同一天出现两个 daily_trace → `foldTraces` 里 entries 重复
- T12 的渲染层过滤只挡垃圾标题，不挡"看起来正常但和新条目说的是同一件事"的旧条目
- 没有通用的"内容级去重"，指纹是唯一防线，指纹已变

#### 验收

| 检查项 | 期望 |
|---|---|
| 清理前 | life_events 83, daily_traces 157 |
| 清理后 | life_events 1（2025-08 的 ai 那条保留）, daily_traces 13（2026-08=11 or 0, 2026-09=2） |
| organizer_runs rule-v2 | 0（全部清理，否则 T7 跑到旧 fingerprint 会 skip） |
| T7 Phase 1 后 | clean months 出现 life_events，无 duplicate |
| T7 Phase 2 后 | dirty months 出现 writer-v2 质量的 life_events，替代旧垃圾 |

#### 硬边界

- **需 Teddy 明确说"可以删"** —— 这是删除生产数据（虽然 66% 是垃圾）
- 删除前导出完整备份到 `docs/backups/rule-v2-cleanup-YYYYMMDD.json`
- 只删 `created_by = 'rule'` 的 life_events —— 2025-08 那条 `created_by = 'ai'` 的保留
- raw_sources 不动


---

### ⚠️ T7/T11/T13 依赖链（Cowork 2026-09-04 追加）

**执行顺序**（Claude Code 必须遵守）：

```
T11 (pipeline fix) ← 最高优先级，先做
  ↓
T12 (garbage filter) ← 独立于 T11，可并行
  ↓
T7 Phase 1: clean months（无旧数据的月份，T11 完成后即可）
  2025-01, 02, 03, 04, 12
  2026-01, 03, 04, 05, 06, 07
  ↓
T13 cleanup（需 Teddy 确认删除旧 rule-v2 数据）
  ↓
T7 Phase 2: cleaned months（T13 完成后）
  2025-05, 06, 07, 08, 09, 10, 11
  2026-02, 08
```

**关键：T11 改变了 T7 的输出格式**。T7 原 spec 步骤 2 说「只产 daily_trace」，
T11 把管线改为产 `life_event_candidate`（有标题、有故事、走 EditorialMemory 渲染）。
T11 完成后 T7 自然产出正确格式，无需改 T7 spec 其他部分。

**T7 Phase 1 的月份不需要 Teddy 确认**——它们没有旧数据，不涉及删除。
**T7 Phase 2 的月份必须等 T13**——否则每个月都会产出重复条目。


---

### T13 · predeclare 数字（Cowork 2026-09-04 10:30 UTC 实测，Teddy 已确认执行）

**执行前必须先核对当前值和下表 "删除前" 一致**；对不上就停下报告，不要"想办法绕过去"。

| 表 | 删除条件 | 删除前 | 删除行数 | 删除后 |
|---|---|---:|---:|---:|
| `life_events` | `profile_id='profile-zhangnian' AND created_by='rule' AND (occurred_at ∈ [2025-05-01, 2025-12-01) ∪ [2026-02-01, 2026-03-01))` | 83 | **82** | **1** |
| `daily_traces` | `profile_id='profile-zhangnian' AND occurred_at ∈ [2025-05-01,2025-12-01) ∪ [2026-02-01,2026-03-01) ∪ [2026-08-01,2026-09-01)` | 157 | **155** | **2** |
| `organizer_runs` | `profile_id='profile-zhangnian' AND organizer_version='rule-v2'` | 478+ | **478** | 剩非 rule-v2 的 10 条 |
| `content_quality_reviews` | `target_id IN (被删的 life_events)` | 109 | **36** | 73 |
| `source_memory_links` | `life_event_id IN (被删的 life_events)` | — | **2,876** | — |
| `raw_sources` | **不删** | 41,553 | **0** | 41,553 |
| `media` / `media_assets` | **不删**，只解绑 | 6,528 | **0**（251 张解绑） | 6,528 |

**唯一保留的 life_event**（必须还在）：

```
id:      (created_by = 'ai')
月份:    2025-08
标题:    假哭时睁眼偷看有没有人哄
```

这条是 Writer v2 写的，是全库唯一一条有质量的 life_event。**删完后 `SELECT count(*) FROM life_events WHERE profile_id='profile-zhangnian'` 必须返回 1，且那一条的 title 必须是上面这个。**

**保留的 2 条 daily_traces**：2026-09-01 和 2026-09-02（T11 的数据迁移单独处理这两条，T13 不碰）。

#### 执行步骤

1. **先备份**：把要删的五张表的行导出到 `docs/backups/rule-v2-cleanup-20260904.json`（不要提交进 git，
   或者加进 .gitignore——里面有孩子的内容）
2. **单事务**：五个 DELETE 放一个事务里，顺序 = links → reviews → life_events → daily_traces → organizer_runs
   （先删引用方，再删被引用方）
3. **事务里先 SELECT count 核对**，数字对不上就 ROLLBACK
4. **COMMIT 后立刻验证**：life_events = 1、daily_traces = 2、raw_sources = 41,553 不变
5. 在 STATUS.md 追加：删除前后各表数字 + 保留的那条 life_event 的 title

#### 硬边界

- **raw_sources 一行都不能少** —— 原始数据是整个项目的地基，删了不可恢复
- **只删 `created_by='rule'`** —— 那条 ai 的必须活下来
- 2026-09 的 2 条 daily_traces 归 T11，T13 不碰
- 备份文件不要进 git（里面是孩子的内容）
- 数字对不上就 ROLLBACK 并报告，不要调整条件去凑数


---

### T14 · 两件 Code 自己验的事（Cowork 只观察，不动手）— status: ready

#### A. 全量测试跑一次，报数字

Cowork 在自己的 Linux mount 上跑不了测试（`node_modules` 是 Windows 上装的，esbuild 只有
`@esbuild/win32-x64`，缺 `linux-x64`）。**测试必须 Code 在 Teddy 的 Windows 机器上跑。**

- `cd v2 && npm test`，报 pass / fail 数字
- 基线：T11/T12 之前是 **619 通过 / 3 失败**（organizer-evidence-pipeline 和 storage-phase-2，改动前就在失败）
- 如果 fail > 3，说明 `abf0dc6`(T11) 或 `b6830f4`(T12) 引入了回归，定位并修
- `tsc --noEmit` 也跑一次

#### B. 导入停了，查为什么

**观察**（Cowork 只读，11:02 UTC）：

- 10:28 UTC 和 11:02 UTC 两次读数**完全一样**：rs 41,553 / ma 6,528 / 乳儿班 6,118
- 34 分钟零增长 → 导入进程已停
- 乳儿班 6,118 / 预期 7,244 = **84%，没导完**

**chat_import_tasks 现状**（可疑）：

| task id | status | attempt | checkpoint messageOrdinal | updated (UTC) |
|---|---|---:|---:|---|
| `db017c7` | **running** | 3 | 5900 | 10:49 |
| `e6cd4d1` | **running** | 1 | 100 | 09:05 |
| `e5fbd25` | completed_with_warnings | 1 | **7244** | 08:51 |

三条都是同一个 snapshotDigest `69ddbb1a…`（乳儿班）。

**两个要查的问题**：

1. **两条 `running` 同时挂着** —— 09:05 那条（e6cd4d1）两小时没动，lease 应该早过期了。
   是 lease 没回收，还是进程死了没标记？
2. **e5fbd25 已经 `completed_with_warnings` 且 checkpoint 到 7244**（全量），
   但库里只有 6,118 行。差 1,126 行去哪了？
   - 如果是被出生日过滤 / 空消息跳过 → 正常，说明**乳儿班其实已经导完**，
     db017c7 是多余的重复任务，应该停掉
   - 如果是写库失败被吞掉 → 是 bug，1,126 条消息丢了

**先回答问题 2**，它决定要不要继续跑。`warnings` / `warning_counts` 字段里应该有线索。

**硬边界**：
- 不要为了"让它继续"就手改 task 的 status / attempt / checkpoint
- 结论写进 STATUS.md，附上差值 1,126 的去向


---

### T11 + T13 合并执行（Teddy 2026-09-04 11:1x UTC「一起放行」）

Teddy 已确认 **T13 的 82+155 行** 和 **T11 的 2 行 2026-09 daily_traces** 一起删。

**所以实际是一次清空**：删完 `daily_traces` 表里 profile-zhangnian 一行不剩，`life_events` 只剩 1 条。

#### 合并后的 predeclare

| 表 | 删除前 | 删除行数 | 删除后 |
|---|---:|---:|---:|
| `life_events` | 83 | **82**（`created_by='rule'` 全部） | **1** |
| `daily_traces` | 157 | **157**（全部，含 2026-09 那 2 条） | **0** |
| `organizer_runs` | 488 | **478**（`organizer_version='rule-v2'`）+ **2**（T7 那两条 `organizer-v2-t7-subject-gate` 的 daily_trace run，不删的话 T7 重跑 2026-09 会指纹短路跳过） | 8 |
| `content_quality_reviews` | 109 | **36** | 73 |
| `source_memory_links` | — | **2,876** | — |
| `raw_sources` | 41,553 | **0** | 41,553 |
| `media` / `media_assets` | 6,528 | **0**（251 张解绑） | 6,528 |

**唯一保留的 life_event**（删完必须还在，`SELECT count(*)` 必须 = 1）：

```
2025-08-29 · created_by='ai' · 假哭时睁眼偷看有没有人哄
```

#### ⚠️ 容易漏的一步

删 `daily_traces` 的同时**必须删掉对应的 `organizer_runs`**，包括 T7 自己写的那 2 条
（`organizer_version='organizer-v2-t7-subject-gate'`，fingerprint `42c50656…` 和 `ee3a07cf…`）。

否则 T7 重跑 2026-09 时 `applyPlan` 查到旧 run → 判定「already organized under this fingerprint」
→ **直接跳过，什么都不写**，而 daily_trace 已经删了 → 2026-09 变成空白月。

同理，rule-v2 的 478 条 run 也必须删干净，否则 T7 Phase 2 的月份会大面积短路跳过。

#### 删完之后的验收（Cowork 会自己 curl 核对）

| 检查 | 期望 |
|---|---|
| `life_events` count | 1 |
| `daily_traces` count | 0 |
| `raw_sources` count | 41,553（一行不少） |
| `organizer_runs` where version='rule-v2' | 0 |
| `organizer_runs` where version like 'organizer-v2-t7%' | 0 |
| 首页 | 显示「假哭时睁眼偷看有没有人哄」 |
| /memory/2025/08 | 无「家人」 |
| /memory/2025/05,06,07 | 无「家人」，页面退化为只有照片——**这是对的**，比留着违规文字好 |
| /memory/2026/09 | 暂时空白，等 T7 重跑 |

**页面会短暂变空，这是预期的**。T7 Phase 1（11 个 clean months）+ Phase 2（9 个 cleaned months）
会把内容重新写回来，且这次是 Writer v2 的质量、正确称谓、有标题。


---

### 🔴 T13 predeclare 更正（Cowork 11:15 UTC 重测——**以这一份为准，上面两份作废**）

**为什么更正**：上面的数字是 10:30 测的。之后 Code 完成了 T11 数据迁移（删掉 2 条 2026-09
daily_traces，重跑出 1 条 life_event），库已经变了。**按旧数字对账会全部对不上。**

#### 当前实况（11:15 UTC 实测）

| 表 | 当前值 |
|---|---:|
| `life_events` | **84**（`rule` 82 + `ai` 2） |
| `daily_traces` | **155** |
| `raw_sources` | **41,553** |
| `organizer_runs` | **487**（`rule-v2` 478 + 其他 9） |

#### 更正后的 T13 predeclare

| 表 | 删除条件 | 删除前 | 删除行数 | 删除后 |
|---|---|---:|---:|---:|
| `life_events` | `profile_id='profile-zhangnian' AND created_by='rule'` | 84 | **82** | **2** |
| `daily_traces` | `profile_id='profile-zhangnian'`（全部） | 155 | **155** | **0** |
| `organizer_runs` | `profile_id='profile-zhangnian' AND organizer_version='rule-v2'` | 487 | **478** | **9** |
| `content_quality_reviews` | `target_id IN (被删的 life_events)` | 109 | **36** | 73 |
| `source_memory_links` | `life_event_id IN (被删的 life_events)` | — | **2,876** | — |
| `raw_sources` | **不删** | 41,553 | **0** | 41,553 |

#### ⚠️ 上一份里有一条错的指令，**不要执行**

上面写着「同时删掉 T7 那 2 条 `organizer-v2-t7-subject-gate` 的 run」——**现在这是错的**。

实况：`organizer-v2-t7%` 只剩 **1 条**，fingerprint `42c50656…`，action 已是
`life_event_candidate`，target 指向 **2026-09-01 的好内容**：

```
2026-09-01 · 英语课上跟读单词被老师夸
「英语课上，小年跟读了英语单词，英语老师夸奖了他。老师还说「小年上课可以的」，
  提醒一下就开始动起来。」
```

**删了它就把刚做好的 T11 成果弄没了。** T13 只删 `organizer_version='rule-v2'`，
其余 9 条 run（`evidence-v6+writer-v2` 5、`organizer-v2-adapter-v1` 3、`organizer-v2-t7-subject-gate` 1）
**全部保留**。

#### 删完后必须剩下的 2 条 life_events

```
2025-08-29 · ai · 假哭时睁眼偷看有没有人哄
2026-09-01 · ai · 英语课上跟读单词被老师夸
```

`SELECT count(*) FROM life_events WHERE profile_id='profile-zhangnian'` 必须 = **2**，
且这两条 title 必须一字不差。对不上就 ROLLBACK。

#### 顺带一个观察（不阻塞 T13）

2026-09 只写出了 09-01 一条，**09-02「粥粥」那条没出来**（原 daily_trace 里有：
「老师说，粥粥来的时候，小年说了好多次『粥粥，粥粥』，发音很清楚」）。
是主体门挡掉了、还是 Writer v2 判定不够成篇？T7 重跑 2026-09 时留意，不用现在查。


---

### T15 · 当前待办清单（Cowork 2026-09-04 20:1x 整合）— status: ready

> **写在这里而不是 STATUS.md**，因为 watcher 只盯这个文件。以后 Cowork 要 Code 做的事一律进 INBOX，
> STATUS.md 只做事后记录。这条是 Cowork 自己的失误订正——上一轮把「后台任务挂起」这个关键发现只写进了
> STATUS.md，等于写进了 Code 看不见的地方。

按优先级从上到下。每做完一条，在下面打勾并在 STATUS.md 追加三行。

#### A · 09-02 / 09-03 补跑（最高优先级，家人能立刻看到）

09-01 已经是正确格式（EditorialMemory，有标题，无「家人」，绑了乳儿班照片，Cowork 已线上验收通过）。
但 **09-02（208 条原始消息）和 09-03（138 条）还没写出来**，月页上这两天只有「N 张照片在月末的档案里」，
没有文字。

- `--day=2026-09-02` 和 `--day=2026-09-03`，dry-run 看一眼再 `--commit`
- 09-01 的 T7 run 已经存在（fingerprint `42c50656…`，action `life_event_candidate`），不要动它
- 做完 curl `/memory/2026/09` 确认三天都有标题

#### B · T14-B 乳儿班导入诊断（Cowork 观察到的事实，供 Code 判断）

- 乳儿班（`conversation:2109e1e89306b57b8334d349`）**从 11:02 到 12:1x 一直是 6,118，超过一小时零增长**
- 期间 `raw_sources` 总数从 41,553 → 41,623（+70），但**全部来自另一个会话
  `conversation:bb5d5ba6da5986d35b923465`**，乳儿班一条没进
- Code 侧后台任务面板显示：之前挂了 2h39m 的任务已清空，现在在跑
  「Resume WeChat import with correctly space-separated flag」，中间有一次
  「Resume WeChat import with corrected forward-slash path」标记为 **Failed**

**要回答的问题**：6,118 是不是乳儿班的真实终点？7,244 是 JSON 里的原始消息条数，但出生日过滤、
空消息/纯表情/纯媒体占位符过滤之后，真实入库数本来就会小于 7,244。**如果 1,126 条差值全是正常过滤损耗，
就在 STATUS.md 写清楚「乳儿班已完成，6,118 是终点，差值构成如下」，然后关掉这条**；如果是真丢数据，
说明为什么以及怎么补。不要让它无限期挂在「84%」这个看起来没做完的数字上。

#### C · T7 Phase 1 继续（11 个 clean months）

- 2026-07：07-01→07-10 的 dry-run 样本 **Cowork 已抽读通过**（称谓正确、主体正确、无「家人」、
  私聊 5 条全部点名才过门）。请补 07-11→07-31 的 dry-run，整月齐了就 `--commit`
- 其余 10 个：2025-01、02、03、04、12，2026-01、03、04、05、06
- 这些月份没有旧数据碰撞风险，不需要 Teddy 确认

#### D · T14-A 测试结果

STATUS.md 里只有 T11/T12 那轮的旧数字（`618/4 → 619/3 → 618/4`）。请在 Windows 本地跑一次完整
`npm test`，把当前基线写进 STATUS.md。超过 3 个失败就是 T11/T12/T13 引入的回归。

#### E · 一条孤儿 organizer_run（低优先级，顺手清）

```
organizer-v2-adapter-v1 | daily_trace | trace-v2-0f8fab8edd0869e801c3c12603aa9593
```

它的 target trace 在 T13 清库时已被删除，但这条 run 记录留下了（T13 的删除条件只覆盖 `rule-v2`）。
`daily_traces` 现在是 0 行，所以这条 run 指向一个不存在的对象。影响：如果将来某次重跑撞上它的
fingerprint，`applyPlan` 会判定「already organized」直接跳过，那一天就永远写不出来。顺手删掉。

#### F · watcher 监控范围（已在本文件「启动方式」小节写明，此处只做提醒）

把 `docs/STATUS.md` 也纳入监控，并加 10 分钟兜底轮询，不要只依赖 INBOX 的文件变更事件。
Teddy 反馈现在总要他自己打字 Code 才会看到 Cowork 写的东西。


---

### T15-B 结论 · 乳儿班缺口 = 整个 2026-08，用 `--since` 新建任务补，**不要动 max_attempts**
status: ready（Cowork 2026-09-04 20:2x 定，不需要 Teddy 再确认——这是补数据不是删数据）

Code 问「是放宽 max_attempts 重跑，还是先查清 3 次死在哪」。Cowork 查了库，两个都不用：**缺口是连续的一整段，
用这个仓库已经验证过的 `--since` 新任务路径补就行。**

#### 事实（Cowork 只读查证）

乳儿班（`conversation:2109e1e89306b57b8334d349`）已入库 6,118 条，按月分布：

| 月份 | 条数 |
|---|---:|
| 2026-02 | 441 |
| 2026-03 | 1,365 |
| 2026-04 | 1,009 |
| 2026-05 | 1,284 |
| 2026-06 | 794 |
| 2026-07 | 1,007 |
| **2026-08** | **0 ← 整月缺失** |
| 2026-09 | 218 |

失败的 task `chat-import-task-db017c77`：`safe_error_code = MAX_ATTEMPTS_EXCEEDED`、`attempt 3/3`、
checkpoint 停在 `messageOrdinal 5900`、phase `media_link`。5,900 这个位置正好是 2026-07 末尾——
**它从来没走到 8 月**。缺的 ~1,126 条基本就是整个 8 月。

#### 为什么不动 max_attempts

`chat-import-state.ts:222` 那道「耗尽次数就拒绝重试」的保护是对的，Code 没有绕过它是对的判断，保持不动。
而且真正的问题不是「重试次数不够」——是那个 task 的 checkpoint 卡在 5900，就算给它更多次数，
它也是从同一个位置用同样的方式再撞一次。

#### 正确做法（这个仓库已经验证过两次的路径）

**新建一个带 `--since` 的任务**，让它只处理 8 月那段：

```
--since=2026-07-31
```

（取 7-31 而不是 8-01 是留一天重叠冗余；canonical message id 会去重，重叠不会产生重复行——
本轮 `chat-import-task-180941e1` 就是 `reused_messages=538 / created_messages=0` 的纯复用，
证明去重是好的。）

**同样路径已经成功过两次**：
- 主群 `chat-import-task-f8fe1de7`：`--since=2025-11-14`，处理 3,958 条，`completed_with_warnings`
- 乳儿班自己 `chat-import-task-e5fbd25c`：`--since=2026-09-01`，处理 218 条，`completed_with_warnings`，
  checkpoint 走到 `messageOrdinal 7244`（= 快照总条数，说明它能正常走到文件末尾）

那个失败的 db017c77 就让它保持 `failed` 状态，不要复活、不要改它的任何字段。

#### 为什么这件事对 P0 重要

2026-08 月页现在有 1,684 条 raw_sources 但 0 条 life_events。乳儿班是 2026 年最安全、最丰富的文字来源
（Teddy：「所有信息都是关于张年的」），8 月整月缺失意味着 T7 跑 2026-08 时会明显缺料。
**建议顺序：先把 8 月这段导进来，再跑 2026-08 的 T7**，不然要跑两遍。

#### 验收

| 检查 | 期望 |
|---|---|
| 乳儿班 2026-08 条数 | 从 0 变成非 0（预计 ~1,100） |
| 乳儿班总数 | 6,118 → 约 7,200 |
| 其他月份条数 | 不变（去重生效，不产生重复行） |
| `raw_sources` 其他会话 | 不受影响 |
| db017c77 | 仍是 `failed`，字段未被修改 |


---

### ⚠️ T15-B 更正 · `--since` 要用 **2026-07-27**，不是 07-31（缺口比之前判断的大）
status: ready（Cowork 2026-09-04 20:3x 更正。**以本条为准，上一条 T15-B 结论里的 07-31 作废**）

Teddy 指出 JSON 里明明有 8 月，Cowork 直接数了源文件，发现之前只按「整月有无」判断，漏了 7 月的尾巴。

#### 源文件 vs 库（Cowork 直接数 JSON + 查库）

`E:\WechatHis\texts\群聊_乳儿班张小年家庭群-57fc0f857d\...json`，顶层 `messages` 共 **7,244** 条：

| 月份 | JSON | 库里 | 差 |
|---|---:|---:|---:|
| 2026-02 | 441 | 441 | ✅ 0 |
| 2026-03 | 1,365 | 1,365 | ✅ 0 |
| 2026-04 | 1,009 | 1,009 | ✅ 0 |
| 2026-05 | 1,284 | 1,284 | ✅ 0 |
| 2026-06 | 794 | 794 | ✅ 0 |
| **2026-07** | **1,261** | **1,007** | ❌ **−254** |
| **2026-08** | **872** | **0** | ❌ **−872** |
| 2026-09 | 218 | 218 | ✅ 0 |
| **合计** | **7,244** | **6,118** | **−1,126** |

**254 + 872 = 1,126**，跟总差值严丝合缝对上。

#### 修正后的判断

导入不是「没走到 8 月」，是**死在 7 月中途**：checkpoint `messageOrdinal 5900` 对应的是
**2026-07-27**（库里 8 月之前的最后一条就是 `2026-07-27T00:56:49Z`），后面 7 月还剩 254 条、
整个 8 月 872 条，全部没进。

9 月之所以完整（218/218），是因为它是另一个任务 `chat-import-task-e5fbd25c` 用
`--since=2026-09-01` 单独导的，跟这个失败的任务无关。

#### 所以命令改成

```
--since=2026-07-27
```

（取 07-27 而不是 07-28，是让边界那一天重叠一整天做冗余；canonical message id 去重，
重叠只会产生 `reused_messages`，不会重复入库。）

其余不变：**不要动 max_attempts，不要复活 db017c77**。

#### 修正后的验收

| 检查 | 期望 |
|---|---|
| 乳儿班 2026-07 | 1,007 → **1,261** |
| 乳儿班 2026-08 | 0 → **872** |
| 乳儿班总数 | 6,118 → **7,244**（= JSON 总数，一条不差） |
| 2026-02～06、2026-09 | 数字**完全不变**（去重生效的证明） |
| `reused_messages` | 应该 > 0（07-27 那天重叠的部分） |

**7,244 这个数字现在是硬验收标准**——不是「大概 84% 差不多了」，是可以一条不差对上的。

#### 这条更正的教训（Cowork 自己记）

上一轮只查了「按月有无」，看到 2026-07 有 1,007 条就当它是完整的，没跟源文件逐月对数，
差点让 254 条 7 月消息永久丢失。**以后凡是判断导入完整性，必须拿源文件的逐月计数对，
不能只看库里「这个月有数据」。** 已按此更新 nianlife-verify 的用法（见 STATUS.md）。


---

### 🔧 T15-B 执行指令 · 立刻跑这条 — status: ready · **不需要再问 Teddy，这是补数据不是删数据**

前面两条 T15-B 是分析。**这条是要执行的命令。**

```bash
cd $HOME/mnt/Nianlife/v2 && REPOSITORY_BACKEND=postgres node \
  --import $HOME/.local/lib/node_modules/tsx/dist/loader.mjs \
  scripts/wechat-import-all.mjs \
  --source-root "E:\WechatHis" \
  --since 2026-07-27 \
  --only 3
```

#### 三个必须注意的点

1. **`--since 2026-07-27` 是空格分隔，不是 `--since=2026-07-27`。**
   `wechat-import-all.mjs:27` 的 `option()` 取的是 `argv[i+1]`，等号写法会被解析成 `undefined`
   然后回落到出生日 `BIRTH_DAY`——那会让它从 2025-01-03 重扫整个会话，白跑几小时。
   （Code 自己那个失败的后台任务「Resume WeChat import with corrected forward-slash path」
   八成就是栽在这类参数形态上，这次别再踩。）

2. **`--only 3`**：3 是乳儿班在本次 run 里的会话索引，取自 Code 自己 12:14 那条 STATUS 里的
   「conversation 3（乳儿班）」。**跑之前先用 `--dry-run` 确认索引 3 确实是乳儿班**，
   会话顺序会随目录变化而变——认错索引会去导别的群。

3. **不要加 `--retry-failed`**：那个失败的 task `db017c77` 保持 `failed` 不动。
   这条命令是新建任务，走的是 `${conversationDigest}|${since}` 这个新 key
   （`wechat-import-all.mjs:88-93` 已经修好了 narrow-since 不会污染 digest 完成标记），
   跟那个死掉的 task 无关。

4. **不要加 `--max-media` / `--max-messages`**（丢照片的老坑）。

#### 跑完自己核对（一条 SQL 就够）

```sql
SELECT to_char(captured_at,'YYYY-MM') m, count(*)
FROM raw_sources
WHERE profile_id='profile-zhangnian'
  AND source_label='conversation:2109e1e89306b57b8334d349'
GROUP BY 1 ORDER BY 1;
```

期望：

| 月份 | 跑之前 | 跑之后 |
|---|---:|---:|
| 2026-02 | 441 | 441（不变） |
| 2026-03 | 1,365 | 1,365（不变） |
| 2026-04 | 1,009 | 1,009（不变） |
| 2026-05 | 1,284 | 1,284（不变） |
| 2026-06 | 794 | 794（不变） |
| **2026-07** | 1,007 | **1,261** |
| **2026-08** | 0 | **872** |
| 2026-09 | 218 | 218（不变） |
| **合计** | 6,118 | **7,244** |

**7,244 = JSON 源文件的总条数，一条不差。** 对不上就停下报告，不要"差不多了"就算过。

#### 跑完之后接着做

2026-08 的料齐了才跑 2026-08 的 T7（否则要跑两遍）。顺序：
**先这条导入 → 再 T15-A（09-02/09-03）→ 再 T7 Phase 1 剩余月份 → 2026-08 归到 Phase 2。**


---

### T16 · 视觉方向落地（4 个小改动）— status: ready · **Teddy 2026-09-04：「不用和我 review，直接执行」**

依据 `docs/nianlife-product-principles.md` §4 视觉方向。原文的判准：

> 视觉靠近的是：**家庭档案、编辑出版物、摄影集、私人日记、生活杂志、高质量年鉴**。
> 明确远离的是：黄色宝宝 App、卡通图标、密集的圆角卡片、母婴商城、幼儿插画。

§4 本身是 P2，但下面 4 条是纯渲染层、零数据改动、各自独立可回滚的便宜账，今晚顺手做掉。
**不要因为这条耽误 T15-B 导入和 T7——这条排在它们后面，或者在等导入的空档做。**

#### 现状（Cowork 刚 curl `/memory/2026/07` 看到的）

```
2026 年 7 月
1 岁 6 个月
  7 月 1 日
  1 岁 5 个月
  这一天还有 N 张照片在月末的档案里
  7 月 2 日
  1 岁 5 个月
  这一天还有 N 张照片在月末的档案里
  7 月 3 日
  1 岁 6 个月
  这一天还有 N 张照片在月末的档案里
  …
```

每天三行，全是 chrome，**一个字的内容都没有**。这是登记簿，不是出版物。

---

#### V1 · 年龄不要每天重复

`components/month-moment.tsx` 的 `DayHead` 每天都印 `ageLabel`。一个月页里「1 岁 6 个月」会出现二十遍，
而月章节标题**已经**印了一次。杂志不会在每篇文章下面重复印刊期。

**改**：`DayHead` 只在 `ageLabel` 与本月章节标题所述年龄**不同**时才渲染它
（即月内跨过「几岁几个月」边界的那些天）。相同就不印。

`TimeSignature`（首页/单条记忆页用的「2026 年 8 月 14 日 · 当时 1 岁 7 个月」）**不要动**——
那里只出现一次，是对的。

#### V2 · 没展示照片的那天，不要印「这一天还有 N 张照片在月末的档案里」

同文件最后一行那个 `chapter-meta`。**如果这一天既没有 `hero` 也没有 `supporting`**，
这句话是在告诉读者「有些照片你看不到」——纯粹的归档说明，不是内容。

**改**：只有当这天**已经展示了至少一张照片**时才印这句（此时它是合理的「这天还有更多」提示）。
一张都没展示时不印。

#### V3 · 既没有文字也没有照片的那天，不要生成条目

现在 2026-07 每个日期都成了一个空 stub。**一个月章节应该只包含"有东西可读或可看"的日子。**
没有内容的那天，它的照片仍然在月末档案里可达，但不该在正文里占一个带日期的空位。

**改**：`lib/publication-moments.ts` 里，构造 moment 时跳过 `text.length === 0 && !hero &&
supporting.length === 0 && !memory` 的天。

**注意**：这**不是**「无文字月份放照片」那条已被推翻的旧规则。Teddy 的现行原则是
**「文字可以没有照片，照片不可以没有文字」**——所以有照片没文字的那天，照片归月末档案，
不在正文里单独成条。这条改动正是在执行那个原则。

#### V4 · 月章节开头加一行事实性导语

杂志的一章开头有 standfirst。现在月页从「2026 年 7 月 / 1 岁 6 个月」直接掉进日期列表。

**改**：在月章节标题下加一行，纯计数拼出来，**不是 AI 写的句子、不含任何判断**：

```
这个月记下 11 天，收进 214 张照片。
```

规则：
- 天数 = 本月有文字的天数（V3 之后 = 正文里实际出现的天数）
- 照片数 = 本月 media 总数（含月末档案里的）
- 两个数字任一为 0 时，那半句省略（「这个月记下 11 天。」/「这个月收进 214 张照片。」）
- 两个都是 0 就整行不渲染
- 用站点现有的暖纸色/墨色，**不要**新加颜色或组件库风格的样式

---

#### 硬边界

- **只改渲染层，零数据改动**，不碰 `life_events` / `daily_traces` / `raw_sources`
- **不要"现代化"现有视觉资产**——暖纸色、墨色、赭红、大号中文衬线是符合方向的资产（§4 明确说了），
  不要换成通用组件库的样子，不要加圆角卡片
- 四条各自独立提交，任何一条出问题可以单独回滚
- `tsc --noEmit` 通过；相关测试（`publication-moments`、`memory-chapters`）通过，
  断言需要更新就更新，但**不要为了让测试过而改变行为**

#### 验收

| 检查 | 期望 |
|---|---|
| `/memory/2026/07`（T7 跑完后） | 只有有内容的天出现；年龄不重复；没照片的天没有归档提示行 |
| 月章节开头 | 有一行「这个月记下 N 天，收进 M 张照片。」 |
| `/memory/2025/08` | 「假哭时睁眼偷看有没有人哄」正常显示，未被 V3 误删 |
| 首页 | `TimeSignature` 未受影响，仍显示「当时 1 岁 X 个月」 |
| 视觉 | 暖纸色/墨色/衬线未变；无新增圆角卡片 |


---

### 🚨 T17 · 给 T7 写库脚本加并发 — status: ready · **最高优先级,这是"今晚做不做得完"的唯一杠杆**

Teddy 定 P0 今晚完成。Cowork 算了账:**按现在的代码做不完,差一个数量级。**

#### 账

`scripts/organizer-month-write.mjs:208` 是 `for (const item of work)`,**完全串行**,
每个窗口挨个 `await editor.organize()` → `await writer(...)`。

| | 实测/推算 |
|---|---|
| 2026-07 dry-run 实测 | 53 分 29 秒 / 39 个窗口 |
| 单窗口 | **~82 秒**(几乎全是等 DeepSeek 的网络往返) |
| 21 个月总窗口 | ~5,200(2026-07 是 227 窗口/26 天,按此外推) |
| 过主体门后要真跑的 | ~2,400(实测过门率 106/227 ≈ 47%) |
| **串行总耗时** | **~55 小时** |

CPU 和数据库都不是瓶颈——**82 秒里绝大部分是单条 HTTP 请求在等 DeepSeek 返回**。
串行跑等于把 2,400 次网络往返排成一条队。

#### 要做的

把那个 `for` 循环改成**有界并发**,建议并发度 **8**,加 `--concurrency N` 参数(默认 8,允许 1–16)。

预期:55 小时 → **~7 小时**;并发 12 则 ~4.6 小时。

#### 必须保住的四件事(改并发最容易破的就是这些)

1. **T10 的指纹短路要保留**,而且必须仍在任何模型调用之前
   (`findOrganizerRun(item.fp)` 那段)。并发下它依然是每个 item 自己先查。
2. **`MAX_CALLS` 封顶要仍然有效**。`calls` 变成共享计数器,并发下要么用原子递增,
   要么在派发时就按额度切片——**不能出现 8 个 worker 各跑各的把封顶冲破**。
   宁可略微少跑几个,不要超。
3. **写库顺序不重要,但 `applyPlan` 的幂等要靠指纹而不是靠顺序**——这一点现有设计已经满足
   (`organizationFingerprint` 唯一),确认一下并发下没有两个 worker 同时处理同一个 fingerprint
   (`work` 里如果有重复 fp,先去重)。
4. **错误隔离**:一个窗口的 editor/writer 抛错只能跳过它自己,不能让整批 Promise 挂掉。
   现有的 `try/catch → continue` 语义要保留成"这个 worker 记下错误继续拿下一个"。

#### 速率限制

DeepSeek 侧如果开始返回 429,**降并发,不要重试风暴**:
指数退避 + 把并发度自动降一档,并在日志里说清楚降到了几。
跑之前先用 `--concurrency 4` 试 10 分钟看有没有 429,没有再上 8。

#### 做完之后立刻用它跑

顺序按「家人最可能翻的」优先,不是按时间顺序:

```
第一批(2026,料最全、乳儿班在这段): 2026-08*、2026-07、2026-06、2026-05、2026-04、2026-03、2026-01
第二批(2025 下半年,主群最活跃): 2025-11、2025-10、2025-09、2025-08、2025-07、2025-06、2025-05
第三批(2025 上半年 + 剩余): 2025-12、2026-02、2025-04、2025-03、2025-02、2025-01
```

\* 2026-08 必须等 T15-B 的导入补完再跑,否则缺 872 条乳儿班的料。

#### 如果到深夜仍跑不完

**不要为了赶时间跳过质量门或提高 DeepSeek 温度。** 按上面的批次顺序,跑到哪算哪,
在 STATUS.md 写清楚跑完了哪些月、剩哪些。**第一批跑完就已经是家人能用的东西了**
——2026 全年可读,这比 21 个月都半生不熟有价值得多。


---

### 🎯 P0 验收范围收窄（Teddy 2026-09-04 21:0x 定）— **只要 2026-06 / 07 / 08 / 09 这四个月**

> Teddy 原话:「那就完成 26 年 9 月-6 月完整数据作为 p0 验收通过标准吧,验收通过后,继续慢慢补」

**P0 验收 = 2026-06、2026-07、2026-08、2026-09 四个月完整。** 其余 17 个月(2025 全年 +
2026-01～05)降级为 P0 之后「继续慢慢补」,**不再是今晚的目标,不要为了赶它们牺牲这四个月的质量**。

#### 这四个月的依赖和状态

| 月 | 原始数据 | 当前 life_events | 阻塞 | 可否现在开跑 |
|---|---:|---:|---|---|
| **2026-06** | 1,938 | 0 | 无 | ✅ 现在就能跑 |
| **2026-07** | 2,154 | 0 | 无(07-01→07-10 dry-run 已经 Cowork 抽读通过) | ✅ 现在就能跑 |
| **2026-08** | 1,684 | 0 | ⛔ **等 T15-B 补完 872 条乳儿班** | ❌ 先补导入 |
| **2026-09** | 458 | 1(09-01 已完成) | 无 | ✅ 只差 09-02 / 09-03 |

#### 执行顺序(改过的,按这个来)

```
1. T17 并发           ← 唯一杠杆,先做,~30 分钟
2. T15-B 乳儿班补导    ← 解 2026-08 的锁,可与 T17 并行(它是导入,不占 DeepSeek)
3. T15-A 09-02/09-03  ← 最小,先拿一个完整月出来
4. 2026-07 整月        ← dry-run 已过,直接 --commit
5. 2026-06 整月
6. 2026-08 整月        ← 等 2 完成
7. T16 视觉四条        ← 上面跑 DeepSeek 的空档做,不占同一资源
```

#### 估算(四个月,不是 21 个月)

| | 窗口数(估) |
|---|---:|
| 2026-09 | ~10 |
| 2026-07 | ~106(实测) |
| 2026-06 | ~90 |
| 2026-08 | ~90 |
| **合计** | **~300** |

- 串行(现状):~7 小时 → **今晚做不完**
- **并发 8:~50 分钟** → 今晚能完成
- 并发 12:~35 分钟

**所以 T17 仍然是今晚能否验收通过的唯一决定因素。**

#### 验收(只验这四个月)

| 检查 | 标准 |
|---|---|
| 四个月每月都有文字 | `/memory/2026/06`、`07`、`08`、`09` 每页都有带标题的正文 |
| 无「家人」 | 四页 grep = 0 |
| 无垃圾标题 | 无 `[media]`、表情、GPS 坐标 |
| 格式一致 | 全部 EditorialMemory(有标题),不混折叠痕迹格式 |
| 称谓正确 | 抽读每月 5 条,妈妈/爸爸/奶奶/雪姨/老师,无含糊指代 |
| 2026-08 料齐 | 乳儿班 2026-08 = 872 条(不是 0) |
| 照片 | 同天照片跟文字在一起,不是全堆月末 |
| 测试 | `npm test` ≤3 失败 |

四个月全过 = **P0 完成**。剩下 17 个月之后慢慢补,不影响验收结论。



---

### 🐛 T18 · 照片没绑到 life_event 上 + 首页「最近的一天」选了没文字的 8/27 — status: ready · **P0 验收卡在这，最优先**

Teddy 2026-09-04 21:4x 打开网站看到的（Cowork 验收时漏了，见文末）：

1. 首页头部写「2026 年 8 月 · 最近」「最近的一天 2026 年 8 月 27 日」，配 3 张照片——**但 8/27 一个字都没有**（2026-08 life_events = 0）。往下滚，「2026 年 9 月」有 3 条带标题的记忆。**最新的有文字的一天是 9/3，首页却把一个只有照片的 8/27 当成「最近的一天」放在最显眼的位置。**
2. 点进 9/3「画画涂到脸上，吃饭香香」详情页：**只有文字，一张照片都没有**，下面折叠着「当时留下的资料 24 项」。而 9/3 当天 `media` 表里有 **21 张**照片（乳儿班的）。

#### ⚠️ 22:11 追加：这个 bug 会随数据增长**持续恶化**，不是静态的

21:4x 首页「最近的一天」= **8 月 27 日**；22:11 再看 = **8 月 28 日**。日期在往后飘。

原因：乳儿班 2026-08 的照片正在补导（22:11 已 837/872），每导进更晚一天的照片，
首页那个"最近有照片的日子"就跟着往后挪一天。**等 872 条全导完，它会停在 8 月某个最晚的、
照片有而一个字都没有的日子上。**

这说明选择逻辑是「最近**有照片**的一天」而不是「最近**有内容**的一天」。
即使 2026-08 的 T7 跑完、8 月有了文字，只要逻辑不改，它仍可能选中一个只有照片的日子。

**所以 T18 的第一条验收标准要更严**：首页「最近的一天」必须 =
`SELECT max(occurred_at) FROM life_events`（当前 = 2026-09-03），
**不是"最近有照片的一天"，也不是"最近有内容的一天"里挑一个**。没有已发布记忆的日子，
永远不能出现在首页那个位置——这是原则四检验句「不点任何东西能否说出张年最近怎么样」的直接要求。

#### Cowork 查到的事实（只读，供定位）

```
life_event            media_ids  hero   当天 media 表   其中 life_event_id 已绑
2026-09-01 英语课…        0      null       32                 0
2026-09-02 粥粥…          0      null       83                 0
2026-09-02 游泳链接        0      null       83                 0
2026-09-03 画画涂到脸上    0      null       21                 0
2026-08-27（无 life_event）                  28                 0
```

06/07 里只有 writer 明确引用为证据的那几条有 hero（`usedMediaIds` 2、3、6 那些），其余 ~85% 也是 `media_ids: 0`。

**Cowork 的判断（Code 自己核实）**：T11 Part C 的「同天 vouched 照片绑到文字旁」只在 `lib/publication-moments.ts` 的**月页组合时**发生，**不落库**。所以：
- 月页（`/memory/2026/09`）能看到照片旁边有字 ✅（Cowork 之前只验了这一个面）
- **事件详情页**（`/events/<id>`）直接读 `life_events` 行 → `media_ids=[]` → 没照片 ❌
- **首页「最近的一天」**大概率也是直接读库选的，9/3 没 hero 就跳过，退到最近一个「有照片的日子」= 8/27 ❌

这两个面都绕过了 T11 Part C。

#### 要做到的（验收标准，Code 决定怎么实现）

| 面 | 标准 |
|---|---|
| 首页「最近的一天」 | **必须是最新一条已发布 life_event 的日期**（现在 = 9/3），带它的标题、正文、当天照片。**绝不能选一个没有文字的日子**——这是 Teddy 的原则「照片不可以没有文字」在最显眼位置的直接违反 |
| 事件详情页 | 有同天 vouched 照片的 life_event，详情页**必须**显示照片（hero + 若干 supporting），和月页看到的一致 |
| 月页 | 保持现状 |
| 一致性 | 同一条记忆，月页 / 详情页 / 首页三处看到的照片**是同一批** |

实现上 Cowork 倾向**把 Part C 的绑定结果落库**（T7 写 life_event 时就填 `media_ids` + `hero_media_id`，或写完后一次性回填），这样三个面读的是同一份数据，不用在每个渲染面各写一遍组合逻辑。但这是 Code 的判断，只要三处一致、验收表全过即可。**已有的 06/07/09 那 84 条要回填，不要只修新写的。**

#### 验收（Cowork 会 curl + 查库）

- `/`：「最近的一天」= `SELECT max(occurred_at) FROM life_events` 那天，有标题有字有图
- `/events/<9-03 那条的 id>`：≥1 张照片
- 06/07/09 全部 life_event：凡当天 `media` 表有 vouched 照片的，`media_ids` 非空
- 三处照片一致

---

### 🐛 T19 · 06/07 里群务通知、妈妈的 App 抱怨被当成了张年的记忆 — status: ready · **T18 之后做，P0 验收风险**

Cowork 抽读 2026-06/07 的 80 条标题，这些**不是张年的记忆**，是群务/大人的事：

```
老师发来返园通知            老师提醒明天带尿不湿和口水巾    老师提醒尿不湿不多了
老师提醒带备用衣物和书包    老师提醒返园准备               老师发布夏日水宝宝感官课
妈妈忘了带备用衣服          妈妈要张小年的两份报告          摄像头转到大班了
妈妈想保存托班群里的照片    妈妈说起下载照片的痛点          妈妈拉雪姨进托班家庭群
妈妈问今天谁去接张小年      妈妈团建，游泳可能改天          妈妈转述AI对张年18个月的分析
爸爸是电子产品的代言人      妈妈说「你比张小年能败家」       把苹果都分给了苹果（标题疑似坏了）
```

约 18/80。它们不违反「无家人」「无垃圾标题」，所以 Cowork 之前的 grep 抓不到——**这是主体门 / 值得性判断的问题，不是格式问题**：句子确实来自群里、称谓也对，但说的是通知、后勤、大人之间的话，**主语不是张年**。

**要做到的**：一条 life_event 的核心必须是「张年做了什么 / 张年怎么样了」。老师的通知、家长的行政沟通、大人对 App 的吐槽、大人之间的调侃，**不进正文**——它们可以留在证据链里（`当时留下的资料`），但不该有标题成为一段记忆。

具体怎么加这道门（写手 prompt 加规则 / 主体门加「行为主语」检查 / 值得性轴加权）是 Code 的判断。**06/07 已写的这 ~18 条要处理掉**（撤回或降级），不能只管新写的。

**验收**：Cowork 重新抽读 06/07 各 10 条，主语是张年的 ≥ 9/10。

---

### 📌 Cowork 验收清单更新（自己记，也让 Code 知道验收会验什么）

之前只验了：grep「家人」= 0、grep `[media]` = 0、有标题。**漏了下面这些，以后每次验收都加上**：

1. 首页「最近的一天」== `max(occurred_at)` of life_events，且有字
2. 随机点 3 条详情页：有同天 vouched 照片的必须显示照片
3. 月页 / 详情页 / 首页照片一致
4. 抽读标题 10 条：主语是张年的 ≥ 9
5. `life_events.media_ids` 非空比例（当天有 vouched 照片的那些）


---

### 📐 T20 · 按产品原则逐条验收线上，发现的问题与要做的事 — status: ready

> Teddy 2026-09-04 22:0x：「你要经常学习 `nianlife-product-principles.md`，这是产品主原则，验收照着这个标准。
> 我找你来是给我惊喜的，要超出我的审美，不是让我发现这么多明显的问题。」
>
> Cowork 读完全文，拿八条原则各自的「检验」段对着线上 `/`、`/memory/2026/07`、`/memory/2026/09`、`/about` 过了一遍。
> 下面每条都标注违反的是哪条原则、原文的检验句、线上实测数字。**验收时 Code 和 Cowork 都用原则里的检验句，不另造标准。**

#### 线上实测（2026-09-04 22:0x，`/memory/2026/07`，T16 尚未部署）

| 指标 | 数字 |
|---|---:|
| 页面体积 | **1,279 KB** |
| `<figure>` / `<img>` | **507 / 507**——一个月的照片全部平铺 |
| 「这一天还有 N 张照片在月末的档案里」 | **98 次** |
| 「1 岁 6 个月」出现次数 | **184 次** |
| 「2026 年 7 月 1 日 / 当时 / 1 岁 5 个月」在**每条**记忆内重复一遍 | 是（DayHead 印一次，EditorialMemory 内的 TimeSignature 再印一次） |
| 46 条记忆的版面大小 | **全部相同** |

---

#### A · 月页的「登记簿感」——违反原则三、原则五（纯渲染，T18 之后立刻做）

**原则三检验原文**：「随机截一个普通浏览页面，上面是否出现任何工程名词、来源系统名、**计数式描述**？」
**原则五检验原文**：「在记忆流里，一段真正重要的记忆和一天的普通照片，是否一眼就能分辨？**大部分内容是否默认不出现？**」

线上：98 次计数式描述；507 张照片全部默认出现；46 条同样大小。三条全违反。

**A1 · 订正 T16 V1（Cowork 的 spec 错了）**
T16 V1 只让 `DayHead` 在年龄等于月龄时不印。但 184 次重复的大头不在 DayHead，在**每条 `EditorialMemory` 内部的 `TimeSignature`**——它把「2026 年 7 月 1 日 · 当时 1 岁 5 个月」在每条记忆里又完整印了一遍，而上面的 DayHead 刚说过「7 月 1 日」。Cowork 在 T16 里写「TimeSignature 不要动」，是没看清它在月页上的位置，**这条作废**。

改为：**在月页语境下**（EditorialMemory 位于 DayHead 之下），EditorialMemory **不渲染自己的 TimeSignature**——日期和年龄由 DayHead 说一次即可。首页 lead 和事件详情页没有 DayHead，那两处 TimeSignature 保留。

验收：`/memory/2026/07` 里「当时」出现次数 = 月内跨年龄边界的天数（7 月应 ≤ 2），不是 46。

**A2 · 订正 T16 V2（同样不够）**
V2 加了 `shownAnyPhoto` 条件，但 T11 Part C 让几乎每天都有 hero，条件几乎总为真，98 次基本不会少。

改为：**删掉这行**。它是原则三点名的「计数式描述代替内容」。月末档案自己有标题，那里写一次「这个月的其他照片」即可，正文里不再逐日报数。

验收：`/memory/2026/07` 里「张照片在月末的档案里」= 0。

**A3 · 月末档案封顶（原则五「大部分内容默认不出现」）**
507 张照片全铺是"把一切平铺"。改为：月末档案默认只展示**一屏**（建议 ≤ 24 张，按 hero 尺寸 / 有人脸 / 与已发布记忆同天 优先），其余折叠在「还有 N 张」之后按需展开。**不是删，是默认不出现。**

验收：首屏加载 `<img>` ≤ 100；页面体积 < 400 KB；折叠展开后仍能看到全部。

**A4 · 首页「这个月还有 28 天 · 翻看整个月」**
「还有 28 天」数的是有照片的天，不是有内容的天。这也是计数式描述。改为不带数字：「翻看整个月」。

---

#### B · 月度回顾「这个月的张年」——原则七，**这是 Teddy 要的惊喜**

**原则七原文**：「月度回顾回答的是"这个月，他有什么变化？"，不是"32 张照片 / 8 条消息 / 4 个 LifeEvent"。由几句有代表性的原话或描述；4–8 张有意义的媒体；关键节点……构成。**回顾是系统生成初稿**……材料不足时不伪装成回顾，只做安静的索引。」
**检验原文**：「一份月度回顾去掉所有数字后，是否仍然能读出这个月的张年？」

线上：月页 = 标题列表 + 照片。**没有回顾。** 但 7 月有 46 条记忆——材料远远够，"安静的索引"这个退路不成立。

**要做的**：每个月章节的最顶上，在月份标题之下、第一天之前，放一段**「这个月的张年」**——

- 3–5 句，≤ 200 字，中文衬线，跟正文同一套排版，**不加标题装饰、不加图标**
- **只能从这个月已发布的 life_events 里综合**，不看原始聊天，不引入任何新事实（这是原则八"可追溯"在回顾层的体现：每句都能指回某条记忆）
- 优先写**变化**（这个月开始会什么、比上个月多了什么、一个新习惯），其次是这个月反复出现的事，最后才是单次事件
- 引 1–2 句原话，用「」
- 称谓规则与写手相同：妈妈/爸爸/奶奶/雪姨/老师，无「家人」
- 不写数字（几张照片、几条记忆）
- 一个月记忆 < 5 条时**不生成**，退回安静索引（原则七原文）
- 生成后进 `content_quality_reviews`，与记忆同一套门；prompt 版本号单独记

**P0 范围**：只做 2026-06/07/08/09 四个月，四次 DeepSeek 调用。

验收（原则七检验句）：把回顾里所有数字去掉，Cowork 读一遍，能否说出「这个月张年有什么变化」。能 = 过。另抽查每句能否指回一条已发布记忆。

7 月的材料举例（Cowork 从 46 条标题里看到的线索，供 Code 校准 prompt 用，不是让它照抄）：升入大班（7/23）、开始自己吃饭（7/22「家里也让他自己吃饭了」）、自己拿鞋要穿（7/14）、感冒两周去医院（7/26）、把绿豆一粒粒放进小孔（7/31）。这些连起来就是"这个月的张年"。

---

#### C · 记忆的分量——原则五，与 T19 合做

**原则五原文**：「有些日子是章节，有些日子只是纸上很淡的一个日期。产品必须用视觉权重表达这种差异。……这就是 Organizer 里 worthiness 在产品层面的意义。」

线上：T7 把所有记忆都写成 `memoryWeight: "trace"`，46 条一样大。「小年年升入大班了」和「老师提醒尿不湿不多了」版面完全相同。

**要做的**：
1. **T7 不再一律写 `trace`**。写手已经产出 worthiness（`worthinessAxis`），按它落 `memoryWeight`：高 → `memory`（章节），中 → `trace`（正文一段），低 → **不发布为带标题的记忆**，只留在证据链里（这就是 T19 的解法——群务通知、后勤、大人的事，worthiness 本来就该低）
2. 一个月的 `memory` 级建议 **1–4 条**，多了就不是章节了
3. 月页渲染：`memory` 级用大版面（hero 照片 + 大标题 + 全文），`trace` 级用现在的段落体；这个区别要一眼看出来（原则五检验句）
4. 首页「最近的一天」优先选最近的 `memory` 级，没有再退到 `trace`
5. **已发布的 06/07/09 这 82 条要重新定级**，不只管新写的

验收（原则五检验句）：随机截月页一屏，能否一眼分出哪条是章节、哪条是普通一天。抽读 10 条 `memory` 级，10/10 是张年自己的事。T19 的那 ~18 条群务应全部降到不发布。

---

#### D · 小处（顺手）

- `/about`：「1 岁 8 个月 **，**2025 年 1 月 3 日出生」——逗号孤悬在行首，是拼接时的标点错位。
- 首页头部「2026 年 8 月 · 最近」与下方「2026 年 9 月」章节并列出现——「最近」的月份标签应跟最近的记忆一致（T18 修完自然对）。

---

#### 顺序

T18 → **A**（纯渲染，快）→ B（四次调用）→ C（含 T19，动写库逻辑，需回填 82 条）。
A 和 B 做完，四个月的月页就已经从"登记簿"变成"章节"；C 是让"章节"里真的有章节。

#### 验收方式（Cowork 会做的）

不再只 grep。每次验收：
1. 打开首页，不点任何东西，能否说出张年最近怎么样（原则一）
2. 随机截一屏月页：有没有计数、工程名词；能否一眼分出重与轻（原则三、五）
3. 读月度回顾，去掉数字后能否读出变化（原则七）
4. 随机点 3 条详情页：日期+年龄同时可读、有照片、来源可折叠展开（原则二、三、八）
5. 抽读 10 条标题，主语是张年 ≥ 9


---

### 🐛 T21 · 撤掉月首「收进 M 张照片」那半句 — status: ready · **Cowork 自己设计错了，优先级高于 T20-B**

线上 `/memory/2026/08` 月首现在是：

> 这个月记下 10 天，**收进 572 张照片。**

前半句可以留。**后半句必须去掉。**

#### 为什么

这句导语是 Cowork 在 **T16 V4** 里设计的，当时的理由是"纯计数、无判断，所以零事实风险"。
**这个推理是错的，它正好撞在两条原则上：**

- **原则三**违反方式原文：「用「**X 张照片 / Y 条消息**」代替内容本身」——一字不差。
- **原则七**原文：「月度回顾回答的是"这个月，他有什么变化？"，**不是"32 张照片 / 8 条消息 / 4 个 LifeEvent"**」。

一个家庭档案的章节开头不会写"本章收录 572 张照片"。**照片数是系统的自我描述，不是张年的事。**
Cowork 上一轮刚让 Code 把 98 处计数句删掉，自己却在月首新加了一处。

#### 改成

**第一步（立刻，一行）**：只留「这个月记下 10 天。」，删掉「，收进 M 张照片」。
两个数都为 0 时整行不渲染（原规则不变）。

**第二步（T20-B 落地时）**：这行整个被月度回顾取代——「这个月的张年」那段 3–5 句散文放在同一位置。
到那时连「记下 N 天」也不留，因为读者读的是内容，不是计数。

#### 验收

四个月页月首：grep「收进」= 0、grep「张照片」= 0。

#### 记给 Cowork 自己

新增任何文案前，先过原则三的违反方式清单 + 原则七原文。
**「纯计数所以安全」是错的——原则三禁的就是计数本身。**

---

### 🔍 2026-09-04 23:3x · Cowork · 抽读 2026-08 全部 46 条标题，给 T19/T20-C 的具体清单 + 一条需要直接排除的跑题记忆

抽读方式：直接读 `/memory/2026/08` 线上全部 47 个标题（含月首行），不是只看几条样本。

**A · 主语不是张年、建议 T19/T20-C 降级为不发布带标题记忆的（约 20/46）**：
老师提醒返园准备 / 妈妈买好了张年的晚饭 / 老师提醒明天带尿不湿 / 妈妈想预防张小年驼背 /
妈妈今天去接他 / 妈妈赶不回来，有人接小年 / 妈妈落地后说接不上张小年 /
妈妈说老师们都对小年超好 / 台风停托一天，次日正常入园 / 鞋子落在学校，明天再取 /
崽说睡了，妈妈回九点压线 / 妈妈给张小年买鸡蛋 / 妈妈发消息说崽睡着了 /
妈妈想多陪陪张小年 / 老师吃饭时帮张年解皮筋 / 老师反馈小年鼻涕有点多 /
妈妈提醒把婴儿推车放进车里 / 老师通知明天入园 / 妈妈告诉大家崽拉屎了 /
妈妈让把衣服扔到张小年床上 / 妈妈让老师给张年喷盐水 / 妈妈去处理张小年拉屎 /
妈妈计划周末带他去泡汤

共同点：主语是妈妈/老师的动作或安排（接送、通知、采购、家务），张年本人只是被提到一句，
不是他在做什么或他身上发生了什么。这是 T19 说的"群务/后勤"类，08 月新写的里占比更高（约 43%），
说明这不是历史存量问题，是写手每个月都会持续产出的。

**B · 一条完全跑题，建议直接不发布（比降级更严重，不是权重问题）**：

`event-v2-a78ad09fdfcc339bb4ecfa016207a5ef`——标题「妈妈讲解记录网站的协作方式」，正文：
「妈妈向对方说明如何协作维护张小年的人生记录网站，讲了 GitHub 仓库、协作规则和内容规范。
这些还只是说明，不是已经做到的事。」

这条记的是 Teddy 在聊 nianlife 这个项目本身怎么开发协作，跟张年的生活没有任何关系，
连"群务"都算不上——是**关于这个网站的元讨论被网站自己当成了张年的记忆**。
T19「主体不是张年」的检查目前显然没拦住这类内容。T20-C 做 worthiness 分级时，
这条不该是"低权重"，应该是**不发布**（reject），因为它连"张年生活"这个大类都不属于。
建议顺手确认同一批素材里是否还有别的"聊 nianlife 项目本身"的消息被当成候选——
这类内容源头上就该在 capture/organizer 阶段排除，不只是靠后期分级兜底。

**C · 质量可以、建议进月度回顾（T20-B）取材的候选**：
张年入选毕业庆典节目 / 妈妈说他突然爱看绘本了（新习惯）/ 吃着饭睡着了，会说ball了（新词汇）/
早起情绪不好，到幼儿班就笑了 / 一个人晃出了镜头 / 别的小朋友坐好，他跑来跑去 /
能和老师音乐一起舞动了 / 小年也扎了个小辫子

---

### 🛑 2026-09-05 00:1x · Cowork · Teddy 明确指令：P0（2026-06~09 四个月）做完就停，不要自动往下做

Teddy 原话：「p0还差啥，按照26年6-9月标准，这几个月做完先不要继续了」。

**这句话是硬指令，不是建议**：T20-C+T19、T20-A3 做完、四个月过完验收之后，**停下来等 Teddy/Cowork
下一步指示**，不要自己往下接 P0 之外的任务（17 个月的历史数据回填、阶段 1 审阅台等——那些都是
`nianlife-assessment-2026-09-04.md` 里"阶段 0 之后"的计划，不是今晚默认要做的事）。

**P0（06~09 四个月）现在实测还差什么（2026-09-05 00:1x 直接查库+curl 线上得出，不是复述终端）**：

1. **T20-C+T19 记忆分量分级**：07、08 已跑完（各 5 条 memory / 41 条 trace），**06、09 还没跑**
   （查 `life_events.memory_weight`，06 全部 32 条还是 trace，09 全部 4 条还是 trace）。
2. **T20-A3 月末档案封顶完全没开始**：四个月页 `<img>` 数量还是 06:225 / 07:435 / 08:621 / 09:139，
   没有任何折叠。这是原则五"大部分内容默认不出现"最后没做的一块。
3. **顺手发现一个设计张力，不是 bug，但要让 Teddy 知道**：T20-C 上线后，首页"最近的一天"现在
   优先选**最近的 memory 级**（这是我在 INBOX C.4 里自己写的规则），结果首页显示的是 8 月的
   「吃着饭睡着了，会说 ball 了」，而不是 9 月 3 日那条（9 月 4 条还全是 trace，没有 memory 级）。
   9 月已经有内容了，首页却往回跳到 8 月——跟"最近怎么样"的直觉有点错位。**这里需要 Teddy 判断**：
   接受"首页展示最重要的最近时刻，哪怕不是最新月份"，还是要求"永远不早于最新有内容的月份，
   同月内再挑 memory 优先于 trace"。Code 不用现在改，等 Teddy 看过一次网站再定。
4. `/about` 页的逗号问题已经不在了（现在是「现在 1 岁 8 个月，2025 年 1 月 3 日出生。」，正常）。

**四个月做完的验收口径不变**：curl 四个月页 grep 家人=0、`[media]`=0（已过）；四个月都有 memory/trace
分级、照片默认折叠到一屏；抽读通过；然后**停下**，把 3 的判断留给 Teddy。


---

### 🎨 T22 · 视觉系统 V1 落地：从「成人极简档案」到「高级家庭成长杂志」— status: ⛔ **暂缓（Teddy 2026-09-05 01:4x：「p22 先取消」）**

> **不要执行本节。** Teddy 01:4x 取消了 T22，用词是「先取消」——暂缓，不是废弃。
> spec（`docs/design/visual-system-v1.md`）和 mockups（`docs/design/mockups/*.html`）原样保留，
> 等 Teddy 明确说恢复再动。当前唯一在做的是 P1，见文件顶部看板。
>
> （以下是取消前的原文，存档。）

**先读**：`docs/design/visual-system-v1.md`（规则）+ `docs/design/mockups/*.html`（手感；用浏览器打开看，手机宽度）。
本任务是纯渲染层（`v2/app/**`、`v2/components/**`、`globals.css`、`lib/home-view.ts` / `lib/memory-chapters.ts` / `lib/publication-moments.ts` 的**选择规则**），零数据库写入，不碰 Organizer / 写手 / 主体门。

#### 目标（家人看得见的）

苏静打开 nianlife.cn 首页，第一屏是张年的照片和一枚「1 岁 8 个月」的印章，下面是一句他的事和一句家人原话；翻到 8 月，像翻一期杂志而不是登记簿；点「张年」，看到的是他本人的肖像和家人最近怎么说他。全程没有一个数字、没有一条横线在数她看了多少。

#### 做什么（按设计文档 §5 逐页；顺序 = 提交顺序，每步独立可回滚）

1. **Tokens + 字阶 + 动效**（§1、§2、§6）：替换 `globals.css` 顶部 token；巨字下调；删 `.text-link:hover` 位移；加 `reveal` / `drift` / `prefers-reduced-motion`。**不引入任何 webfont。**
2. **四个品牌小件**（§3）：`AgeStamp`、`DayMark`、`Speaker`、`GrowthRuler` 四个组件，内联 SVG/CSS，无外部图标。
3. **照片布局**（§4）：`bleed` / `duo` / `cluster` 三种 + 月页的 bleed↔inset 交错规则，落在 `MonthMoment` / `PhotoStrip` 层。
4. **首页**（§5.1）：删巨型刊头；封面照 bleed；印章；那一句；「家人说」（确定性正则抽第一句带称谓原话，抽不到不渲染）；最近长大的一点；最近的一组（cluster）；本月（燕麦色块，唯一色块）。无 hero 时按 `home-sparse.html` 走纯排版封面。
5. **月页**（§5.2）：刊头 = 月份 display + 印章 + 回顾 standfirst；**取消「这个月记下 N 天」整行**（T21 第二步）；正文日子之间无横线，chronicle 合并进正文；档案 summary 去掉「N 张」。
6. **张年页**（§5.3）：**肖像选择规则改为「最近一条已发布记忆绑定的 hero，且 media 来源身份为夸克 family_photo 背书」**，乳儿班/微信来源即使 trusted 也不得作肖像（线上现在的肖像是乳儿班 9/3 的香蕉和牛奶——`latestPortrait` 在 T11 Part B 把乳儿班升 trusted 后选中了它）；无符合者退到首页封面照；再无则不放图。印章放大；「家人最近说」（最多 3 条，同一正则，可点回记忆）；「最近记下来的」改 DayMark 列表；不渲染任何空格子。
7. **记忆索引**（§5.4）：月份行用「第一条记忆标题」替换 `indexCount` 的计数；年份区块用 GrowthRuler（V1 等距简化版可以）。
8. **两个顺手的 bug**：(a) 手机 375px 上 8 月页正文被右侧裁切（Cowork 2026-09-05 实测）——查 `.reading-wrap` / `.moment-text` 的宽度与 `overflow-wrap`；(b) `Photo` 组件的 `sizes` 让 Next 对每张缩略图都请求 `w=3840`（线上所有 `<img src>` 都带 `&w=3840`）——这是一个属性的事，改对 `sizes` 即可。**(b) 不是性能任务，是正在改的组件里的一处错字；Teddy 可否。**

#### 硬边界

- 只改渲染层与选择规则；`life_events` / `daily_traces` / `raw_sources` / `media_*` 零写入。
- **页面上每一句话都必须能回溯到已发布的 life_event / snapshot 文本**；「家人说」只能是正则从 `story` 里原样切出的引号内容 + registry 称谓，**不允许生成、不允许拼接、不允许无称谓回落**。抽不到就不渲染那块。
- 封面照 / 肖像 / 最近的一组只用有背书绑定（`hero_media_id` / `media_ids`）的照片；不为了填满放无背书图。
- 主阅读层（首页、月页正文、张年页、记忆索引）**零计数**；`<details>` 内允许 `<small>` 计数。
- 不引入 webfont、图标库、组件库；不加圆角卡片阵列；不做轮播 / 蹦跳。
- 不动 Organizer、写手、主体门、`month-review.mjs`；不动 `/inbox` `/capture` 的功能（样式可以跟随 token）。
- `tsc --noEmit`、`npm test` 通过；测试断言按新行为更新，但不为过测试改行为。
- 每步独立 commit；提交信息带 `t22-N`。改完 push，部署后在 STATUS.md 追加三行 + 贴首页 / 8 月 / 张年三页手机截图。

#### 验收（Cowork 会做的，设计文档 §8 全部 8 条，这里只列判定句）

1. 首页不点任何东西：第一屏 ≥60% 是照片；无数字、无通栏横线、无同尺寸卡片；能说出「1 岁 8 个月，最近……」。
2. `/memory/2026/08` 与 `/memory/2025/03`：无横线分隔、无计数、无「暂无」；稀疏月读起来像安静。
3. `/about`：肖像是张年本人且来源夸克；「家人最近说」每条有称谓、可点回；无空格子。
4. 随机截三屏：无工程名词、无计数；重与轻一眼可分。
5. 抽读 5 句：全部在库里有出处。
6. 375px 不裁切、不横向滚动。
7. `prefers-reduced-motion` 下无动画。
8. 新增字体请求 = 0。

#### 不可接受

- 页面上出现任何不是家人/老师原话或写手已发布文本的句子。
- 为了「有照片」选了无背书的图；肖像仍然不是人。
- 「稀疏态」用占位、灰框、「暂无」来表达。
- 把现有暖纸/墨色/衬线换成通用组件库的样子（原则 §4 明说这是资产，V1 是在它之上升温，不是替换）。


---

### 🚀 P1 · 2026 全年正确 + 档案活起来 — status: ready · **Teddy 01:3x 指令「开始干 p1」**

来源：`nianlife-P1-P2-plan.md`（09-04 15:45 写成）+ **Cowork 01:2x 的逐条校读**
（`nianlife-P1-plan-review-2026-09-05.md`）。**下面这份是修订后的版本，与原计划冲突时以本节为准。**

---

#### ⚠️ 计划已被修订——动手前必须知道的四条

原 P1 计划写在 P0 那一晚开工**之前**，有几条前提已经被今晚的实况推翻。以下是实测数字（01:2x 直接查生产库）：

1. **P1-4 的选图规则会造成回退。** 原文要求「照片是夸克（trusted）**且**同天有过门文字才并排」。
   实测 06~09 页面上已绑定的 286 张照片：**微信 261 张（91%）、夸克 25 张（9%）**。
   那 261 张主力是乳儿班群，它的信任是 Teddy 在 P0 里亲口给的（「所有信息都是关于张年的」），
   T11 据此实现并已上线验证。**照原文执行会把九成照片撤回月末档案。**
   → **改法：「背书」= 来源在信任名单里（夸克 + 乳儿班群 + 以后任何 Teddy 点头的会话），
   不是「provider 叫夸克」。**
2. **`daily_traces` 现在是 0 行**（T11 改管线 + T13 清库之后这张表在生产上空了）。
   原 P1-5 里「给 `daily_traces.occurred_at` 加索引」**删掉**，那是给空表加索引。
   另外 `life_events_occurred_idx` **已经存在**；仍然缺的只有 **`raw_sources.captured_at`**。
3. **数据量翻了五倍**：raw_sources 8,796 → **44,452**，media_assets 1,131 → **7,395**。
   性能不再是收尾的优化，是后面所有写库任务的地基（今晚 Code 已经撞上 `getStore()` 在这台机器上
   直接挂死、只能绕开走纯 SQL）。**P1-5 提到 P1-2 之前。**
4. **今晚多出来一个判官。** `t20c-regrade-memories.mjs` 是事后重新分级，P1-3 要做的是写入时的门。
   同一件事两个判断点必然漂移。→ **P1-3 的范围 = 把 T20-C 的分类器收编进写入时的门，
   全站只保留一个判断点**，不要再写第三套规则。

---

#### 🔴 P1-0 · 2026-01~05 五个月过 T7 管线（**立刻开跑，B 轨**）

**为什么它排第一**：P1 的退出标准写着「2026 每月『这个月记下来的』非空」，但这五个月是
**11,521 条 raw_sources、0 条 life_event**——原计划的六个任务里没有一条负责写它们，是计划漏了。
它也是 P1 里唯一直接让网站上多出家人能读的东西的任务，且不依赖任何其他任务。

**目标**　2026-01、02、03、04、05 五个月，每个月都像 06~09 那样有带标题的正文、有绑定的照片、
有月度回顾（够 5 条的月份）。

**硬边界**
- 用今晚已经跑通的那条链，**不要重新发明**：`organizer-month-write.mjs --month=YYYY-MM --commit`
  → `t18-backfill-media-binding.mjs` → `t20c-regrade-memories.mjs --commit` → `month-review.mjs --commit`。
  这四步的顺序和"每个新月份都要补跑后三步"已经写在 `organizer-month-write.mjs` 的头注释里。
- **每一步跑完立刻直接查生产库确认，再报完成。** 今晚 T20-B 的教训：脚本忘设
  `REPOSITORY_BACKEND=postgres` 时会静默写进本地 JSON，终端照样打印 "WRITTEN"。
- 称谓规则不变：妈妈/爸爸/奶奶/雪姨/老师，**「家人」一处都不许有**；解析不到发言人就不写那句。
- 私聊来源仍按 T7 的主体门处理：只留明确点名张年的，不靠代词猜。

**验收（按页面说，不按进程说）**
- curl `/memory/2026/01`…`/05`：每页都有带标题的正文，`grep 家人` = 0、`grep '\[media\]'` = 0
- 每个月抽读 5 条，主语是张年 ≥ 4/5
- 每个月的 `life_events.media_ids` 非空比例 ≥ 上一批四个月的水平
- **每月 ≥ 8 天有文字**（见下面「⚖️ 内容量下限」）

**不可接受**　为了让页面看起来满而放宽称谓或主体门；只跑第一步就报"这个月完成了"；
终端打印当作入库证据。

**每个月的四步（照抄，不要重新发明；`cd v2` 之后跑）**

```
# 1) 写这个月的 life_events（--out 必须是仓库外的绝对路径）
node --import tsx scripts/organizer-month-write.mjs --month=2026-01 \
     --out=C:/Users/teddy/nianlife-backups/p1-2026-01.json --concurrency=8 --commit

# 2) 把照片绑到这些新记忆上（幂等，可重跑）
node --import tsx scripts/t18-backfill-media-binding.mjs --month=2026-01

# 3) 记忆分量分级 + 群务降级
node --import tsx scripts/t20c-regrade-memories.mjs --month=2026-01 --commit

# 4) 月度回顾（该月已发布 <5 条时自己跳过，属正常）
node --import tsx scripts/month-review.mjs --month=2026-01 --commit
```

**每跑完一步立刻查库确认，再进下一步**（今晚 T20-B 的教训：`REPOSITORY_BACKEND` 没设时脚本
会静默写进本地 JSON，终端照样打印 WRITTEN。`month-review.mjs` 已在 `fb0e6ee` 里硬编码修好，
**如果新写/改了别的脚本，先确认它自己设了 `process.env.REPOSITORY_BACKEND = "postgres"`**）。

一句话自查（跑完一个月就跑一次，四个数字都要动）：

```
SELECT to_char(occurred_at,'YYYY-MM') mo,
       count(*) AS 写出,
       count(*) FILTER (WHERE memory_weight='memory') AS 章节级,
       count(*) FILTER (WHERE media_ids IS NOT NULL AND media_ids::text <> '[]') AS 有照片
FROM life_events WHERE profile_id='profile-zhangnian'
  AND occurred_at >= '2026-01-01' AND occurred_at < '2026-06-01'
GROUP BY 1 ORDER BY 1;
```

**顺序建议**：**从 2026-05 往回做到 2026-01**（离现在近的先出来，Teddy 醒来先看到最近的）。
五个月各自独立，一个月跑完就报一次，不要五个月全跑完才报。

---

#### ⚖️ 内容量下限（Cowork 暂定，Teddy 可推翻）

今晚的门收得很严：写出 128 条**只发布 52 条**（59% 不发布），2026-06 只剩 **7 天有内容、0 条章节级**。
P1-3 还要继续加严，这个数字会继续往下走。这里两条原则已经开始互相拉扯——
原则五「大部分内容默认不出现」支持收严，原则一「家人不点任何东西就能说出张年最近怎么样」
在一个月只剩 7 天时就悬了。

**所以从 P1 开始，主体门相关的验收必须同时看两个方向：**

| 指标 | 下限 |
|---|---|
| 每月有文字的天数 | **≥ 8 天** |
| 每月章节级（`memory_weight=memory`）记忆 | **≥ 1 条** |
| 抽读 5 条主语是张年 | **≥ 4/5** |

**低于下限 = 门太严，要回调**，不是"精度提高了"。这正是接手评估里批评过的老毛病：
精度高到把真实人生挡在外面。Teddy 若要改这个下限，以他的话为准。

---

#### 其余任务（P1-0 之后按此顺序）

| # | 事项 | 相对原计划的变化 |
|---|---|---|
| **P1-5** | `raw_sources.captured_at` 加索引；`getStore()` 改按月 scoped read；手机首屏 ≤3 秒 | **提前到 P1-1 之前**；删掉 daily_traces 索引那条 |
| **P1-1** | 身份修复：`conversationId` 去掉导出时间/消息数 + 存量迁移。验收＝重新导出一次微信，raw_sources 零重复 | 不变，仍是 P1-6 的硬前置 |
| **P1-2** | 夸克 2,279 入库，只入库不触发 Organizer；307 张无日期单独放 | 不变 |
| **P1-3** | 主体门加严 **+ 收编 T20-C 分类器为唯一判断点** | 范围改写（见上 4）；**验收加内容量下限** |
| **P1-4** | 图文同日绑定 + 首页 | **「夸克」改成「信任名单」**（见上 1） |
| **P1-7** | 月末档案展开交互（"还有 N 张"可点开看全部） | **新增**。原则五检验句写的是"折叠展开后仍能看到全部"，现在这半句不成立，是 P0 遗留的欠账，很小 |
| **P1-6** | 本地 worker（Windows 任务计划：增量导入 → 主体门 → 写手 → 发布） | 不变，**严格排在 P1-1 之后** |

**并行规则**：A 轨（T22、P1-7、P1-4、P1-5 的代码部分）改仓库，B 轨（P1-0、P1-2 的入库、P1-1 的迁移）
写库，可以同时跑；但**仓库写操作同一时间只能有一个 Session**，且 **P1-5 的性能测量需要写库静默窗口**。

**P1 退出标准（含 Cowork 补的一条人的验收）**
1. 2026 每个月页非空、抽读零错、`grep 家人` = 0
2. 重新导出一次微信，raw_sources 零重复
3. 关机一周再开，worker 自动补齐
4. 首页不违反原则一/二/三
5. **苏静在 2026 任意一个月页停留超过一分钟，并说出一件她不知道的事**（P1 原计划的退出标准全是
   机器检查，可以在没有任何人读过页面的情况下达成——这与"每一轮结束网站上要多出一样家人能读的
   东西"冲突，所以补这一条）

---

#### 还挂在 Teddy 那里的一个产品判断（不要擅自改）

首页「最近记下来的一天」现在优先选 `memory` 级，导致 9 月（4 条全是 trace）被 8 月的一条
memory 级记忆抢了首页。**这是 Cowork 写的规则（INBOX C.4）产生的真实后果，不是 bug。**
两种解都成立——"首页展示最重要的最近时刻"，还是"永远不早于最新有内容的月份，同月内再挑 memory"。
**等 Teddy 看过网站后定，Code 不擅自改。**
