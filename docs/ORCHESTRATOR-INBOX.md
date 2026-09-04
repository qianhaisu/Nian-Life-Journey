# INBOX — 给 Claude Code 的任务队列

Cowork 写这里，Claude Code 读这里并执行，结果写回 `docs/STATUS.md`。
Teddy 不必在中间转述。

## 启动方式（Teddy 只做一次）

在 Claude Code 里说一句：

> 盯着 docs/ORCHESTRATOR-INBOX.md，文件一变就读，按里面 `status: ready` 的任务从上到下执行，
> 每完成一个把它的 status 改成 done 并在 docs/STATUS.md 追加三行。

## 上下文纪律（Teddy 2026-09-04 17:26）

**当前 session 上下文达到 200k token 就主动 `/compact`，除非正处在不能中断的当口**（写库事务进行中、
一个多步操作做到一半、正在等一个马上要回来的命令）。那种情况做完立刻 compact。

compact 之后先重读 `docs/ORCHESTRATOR-INBOX.md` 和 `docs/STATUS.md` 最新两条，再接着当前步骤——
这两份文件就是为了让「上下文没了也能接着干」而存在的。**compact 不需要问 Teddy。**

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

### T11 · 格式一致性修复 + 乳儿班照片入正文 — status: code-done（`abf0dc6`）；数据迁移等 Teddy 确认

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

### T13 · T7 回刷前必须先清理旧月份的 rule-v2 数据 — status: **blocked（需 Teddy 确认删除）**

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

