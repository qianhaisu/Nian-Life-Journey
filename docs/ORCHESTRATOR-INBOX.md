# INBOX — 给 Claude Code 的任务队列

Cowork 写这里，Claude Code 读这里并执行，结果写回 `docs/STATUS.md`。
Teddy 不必在中间转述。

## 启动方式（Teddy 只做一次）

在 Claude Code 里说一句：

> 盯着 docs/ORCHESTRATOR-INBOX.md，文件一变就读，按里面 `status: ready` 的任务从上到下执行，
> 每完成一个把它的 status 改成 done 并在 docs/STATUS.md 追加三行。

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

### T7 · 2026 年每个月页面上要有整理过的文字 — status: **ready · 最高优先级 · 今天完成**

**Teddy 2026-09-04 决定：方案 C。**「T2 done 但网页没文字，这个重要，按 C 方案做，今天必须完成。」

**验收（按页面说，不按数据说）**：打开 https://nianlife.cn/memory/2026/0X（X = 1…9），每个月的
「这个月记下来的」里有整理过的文字——像 2025-07 那样按天成段的「家人说…」——而不是纯相册或空旁白。
**不接受**：把阿静和 Teddy 聊车价、聊工作的内容写成张年的记录。宁可某天没文字，不要错的文字。

---

**Cowork 已核实的事实（不用重查）**

1. **现在网站上所有能读的文字，全部来自 2026-09-01 那次 `rule-v2` 运行**：`organizer_runs` 里 rule-based
   daily_trace 217 次、create_memory 82 次。AI V2 Organizer 全部历史产出只有 daily_trace 1、
   life_event_candidate 1、store_only 6。**2026 年零次运行。** `daily_traces` 全天 155 没动过。
2. `lib/organizer/rule-based.ts`（99 行）的 `traceEntry` 就是「取第一条 source 的 text 截 180 字」，
   **没有主体过滤、没有改写**。2025-07 页面上「家人讨论喂张小年辅食时糊糊弄脏口水巾…」那种成段
   prose 不是它直接产的——大概率是之后 `scripts/deepseek-family-writer.mjs`（`evidence-v6+writer-v2`）
   的改写。**请先弄清 2025 那批可读文字的完整生成链，再对 2026 复制同一条链**——不要发明新链路。
3. 2026 年文字的构成：阿静私聊每月 800–1,400 条（**关于张年的估计只占 5–10%**），主群 2026 年每月
   19–49 条，老苏家 2026-05 起活跃。**私聊是主要来源，也是最容易写错的来源。** 样本：
   `19款17万公里也报价11万 / 我们还是要多训训价` —— 这种绝不能变成张年的痕迹。
4. 主体判断的门在哪：`worthiness-v4.ts:137` 的 `routeV4` 决定 store_only / daily_trace，靠的是
   `traceEvidenceCount`（grounded 的主体事实数）。召回杀手在上游 claim-grounding 的主体解析——
   `judgment-policy.ts` 头部注释写得很清楚：frozen V6 clean-positive 召回 1/4，V7 那对
   （zero-anaphora + grounded promotion）2/4，**且 V7 从未在生产启用**（validator.ts 回落 V1）。
5. `scripts/backfill-wechat-organizer.mjs` 支持 `--month=2026-05 --dry-run`，rule-based、共享 store、
   零 AI 费用、秒级。
6. 生产 provider 统一 DeepSeek（`.env.local`：`AI_PROVIDER=deepseek`、`AI_MODEL=deepseek-v4-pro`）。

---

**建议路径（Cowork 的判断，你可以在事实面前推翻它，但要写明理由）**

- **第一步：复现 2025 的链**。搞清 rule-v2 → (writer?) → 页面 这条链每一环是哪个脚本、什么参数。
  在 2026-05 上 `--dry-run` 看会产出什么。**这一步不写库。**
- **第二步：加主体门，再跑**。rule-based 没有主体过滤，直接跑私聊会把车价写进档案。最小可行的门：
  只组织**文本里点名提到张年的消息**（张小年 / 小年 / 年年 / 儿子 / 宝宝——以仓库里 family-registry
  的称谓表为准，不要自己列）。漏掉「他今天会坐了」这类零指代是可以接受的代价——
  **今天的目标是 2026 每月有正确的文字，不是召回最大化。** 家庭群可以放宽（群本身就是关于他的）。
- **第三步：writer 改写**（如果 2025 是这么来的）。DeepSeek，按天。2026 有文字的天数估计 200–270 天，
  按每天一次调用、每次 ≤20K token 算，费用在几十元量级。**超过 300 次调用停下来报告。**
- **第四步：逐月验收**。每做完一个月，curl 那个月页确认「这个月记下来的」非空，且抽读 5 条不是
  阿静的工作/购物对话。写进 STATUS.md。从 2026-09 往回做到 2026-01（Teddy 定的顺序：最近到最旧）。

**硬边界**
- 不改 frozen V6、不新建 worthiness/judgment/holdout 版本（CLAUDE.md 停下清单）。V7 那对如果要用，
  是「选择已有策略」，不是「写新策略」；用了要在 STATUS.md 注明
- 私聊来源的每条痕迹必须能回溯到一条**点名张年**的原文；做不到就不写
- 不删任何现有 daily_traces / life_events
- 每完成一个月就 commit + push（Vercel 部署），让 Teddy 能随时打开看——不要攒到最后
- 若某一环的前提不成立（比如 2025 的 prose 根本不是 writer 产的），停下报告，不要绕

**不可接受**：2026 任何一个月页上出现一条明显不是关于张年的痕迹。这比留空严重得多。

**Codex 在 T7 里的用法（Teddy 2026-09-04 授权）**
- 主体门写好之后、跑生产之前，**必须** `/codex:adversarial-review`，只问一个问题：
  「这个过滤器会让哪些**不是关于张年**的消息漏进来？」把它列出的每一类拿 2026-05 阿静私聊的真实
  数据验一遍。这是 CLAUDE.md 里 Codex 边界的一个明确例外——T7 的风险是漏进错的东西，不是放行太少。
- 你若卡住或额度紧张，`/codex:rescue` 随时可用。

**Cowork 会每 15 分钟自己 curl 各月页核对，不看进程状态。**

---

### T8 · 两项 Codex 后台审查 — status: blocked（本机未安装 Codex CLI）

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
