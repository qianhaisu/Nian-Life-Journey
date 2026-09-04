# STATUS — 出箱

多个 session（Cowork 会话、Claude Code）同时动这一个仓库和这一个数据库。这份文件是它们互相看得见的唯一地方。

**和 `docs/STATE.md` 的区别**：STATE.md 是「现在是什么样」的活文档，会被改写。这份是「谁做了什么」的流水，**只追加，不改写历史条目**。

## 怎么用

1. **开工前**：读下面的「占用板」。如果你要动的东西已被占用，先去问，不要开始。
2. **开工时**：在占用板加一行，写清你要动什么、预计多久。
3. **收工时**：在占用板删掉你那行，并在「时间线」追加三行。
4. **异常结束**（被打断、卡住、放弃）：也要收工。占用板上的僵尸条目比没有条目更糟。

三行的格式（CLAUDE.md 规定，不要写成审计报告）：

1. 本轮线上多了什么家人能读的东西
2. 没做到什么 / 最大的已知 blocker
3. 下一件事

---

## 占用板（Claim Board）

写操作才需要占用；只读的查询、看页面、读代码不用登记。

| 占用者 | 对象 | 开始 | 预计 | 备注 |
|---|---|---|---|---|
| （空） | | | | |

**互斥规则**

- **仓库写**：同一时间只有一个 session 可以改文件 / commit / push（CLAUDE.md 规定）。
- **数据库写**：微信导入和夸克入库写不同的行，也不共用 `chat_import_tasks` 队列，**并不需要串行**（2026-09-04 核实；此前本文写「必须串行」是没有依据的断言）。真实的共享资源只有两个：Neon 连接池（STATE 记过一次空闲连接掉线导致进程级崩溃，两个长任务同压会放大它），以及 **Claude Code 只有一个**——长任务的排队是操作者的排队，不是数据库的排队。
- **性能测量**：测量期间数据库写入必须停止，否则数字是噪音。
- **git 命令**：只由 Claude Code 执行。Cowork 侧的挂载删不掉文件，跑 git 会留下 `.git/*.lock` 把仓库卡住。

---

## 时间线（只追加，最新在上）

### 2026-09-04 · Cowork · 夸克入库前置调查

1. 线上无变化——本轮是只读调查。
2. `quark-photo-init.mjs` **不是**「只入库不调 AI」的脚本，它是 `quark-photo-apply.mjs` 的 50 行壳（`import { applyQuarkPhotoArtifact }`），走同一条 enqueue 路径。且硬编码三处：强制 `AI_PROVIDER=gemini` / `MEMORY_ORGANIZER=ai` / `AI_ORGANIZER_ENABLED=true`（**违反「生产统一 DeepSeek」的决定**），`maxGeminiJobs: 20`，以及 `ARTIFACT_DIR = .../quark-photo-prep-20260831`（**8-31 那批旧 artifact，即已入库那 107 张的来源**）。要导的 2,279 张在 `C:\Users\teddy\NianlifeOps\quark-history\2026-09-03\`。**直接跑它不会发生任何事。**
3. 下一件：夸克入库需要三项前置——artifact 目录可配置、Gemini 硬编码去掉、enqueue 策略定案。

**enqueue 的真实规模**：`quark-photo-apply.mjs:202` 按天分组，一天一个 job，不是一张一个。2,279 张约 20 个月 → 上限几百个 job。但超预算时它**照样全部入队**（第 199 行的 warning 自己写了），只是本次不 drain；剩下的会被 Vercel cron 在后台慢慢捞走。判官是冻结的 V6（召回接近 0），所以最坏情况是几百个 job 在后台烧钱、产出接近零。

**建议**：这一步只需要照片拿到 `family_photo` 来源身份——那是 `mediaPrivilegeOf` 里 `trusted` 的全部定义，也是月页正文出现照片的唯一条件（见上一条）。Organizer 不必参与。等阶段 1 recall-first 和审阅台就位再决定。

### 2026-09-04 · Claude Code · 主群补数尝试，零写入停止

1. 线上无变化——本轮撞上结构性障碍，主动停止。
2. `--since 2025-11-15` 无法执行，两个叠加原因：**(a) task 自然键 `importBatchId = wechat-import:{rootFingerprint}:{conversationDigest}` 不含 since**，所以「一个导出快照 × 一个会话」永远只有一个 task，窄范围跑出的 warnings(1) 小于该 task 全量遗留的 warnings(5)，触发 `chat-import-state.ts:151` 的单调守卫；**(b) 该 task 已 `attempt=3/3` fail-closed**（`PROGRESS_NOT_MONOTONIC`），`--retry-failed` 会被队列拒绝。实际 delta 全为 0，数据库干净，未手改任何 task 字段。
3. 下一件：把 `since` 纳入 `importBatchId`（Teddy 已定）。

**为什么是这条路**：`canonicalMessageId` 的输入是 `{v, conversation, sender, sentAt, type, text, attachments, documentDigest, recordOrdinal}`（`chat-import-bundle.ts:18`），**不含 `importBatchId`**，已逐字核实——所以改它零重复行。且新 `importBatchId` = 新 task 行 = `attempt` 从 0 开始，**顺带绕过 fail-closed 而不必调松守卫或手改状态**。那个守卫今天刚正确拦下一次异常回退，不要动它。

**不要顺手清理**：旧 task `0cbd0588` 的计数器是假的（`created=4900` 指向已删除的行），但它是这次 fail-closed 的完整现场，保留不动。

### 2026-09-04 · Cowork · 月页照片为什么不进正文

1. 线上没有新增内容——本轮是诊断。
2. 查清机制：`publication-moments.ts:148` 的 `if (!hero && !wordlessMonth) return undefined`。hero 必须有背书，背书只来自 approved Memory（全库 3 个）或 `family_photo`（夸克相册）。微信聊天图一律无背书，所以**有文字的月份照片全部折叠进档案，没文字的月份反而放出来**。2025-07 有 225 张照片、满月对话，正文一张图没有。设计本身是对的（微信图里混着截图表情包），缺的是可信来源。
3. 下一件：**夸克 2,279 张提到 P0 第一位**——它就是 `trusted` 的定义。但入库前必须先验证 `lib/ingest/quark.ts` 会不会 enqueue 2,279 次 DeepSeek 调用。

### 2026-09-04 · Cowork · 停止并清除主群重复导入

1. 线上无变化——本轮是止损。
2. 发现一轮正在进行的重复导入（进程状态、日志全部正常，`processed` 稳步增长，无报错），主群被重导为新标签 `conversation:a673c0e0…`。设了 `cancel_requested_at`，worker 12 秒响应，停在 4,900 条；随后按标签删除 4,900 条 raw_sources + 444 条 media（predeclare 与实际 delta 完全一致，media_assets / life_events / daily_traces / source_memory_links 未受影响）。
3. 下一件：主群仍缺 2025-11-14 之后约 3,958 条，等 Teddy 在补数方案上拍板。

**根因（由 Claude Code 查明，Cowork 已验证）**：`wechat-markdown.ts:17` 的 `conversationId = sha256(标题 + 头部块)`，而头部块含「导出时间」和「消息数量」。**每重新导出一次，全部会话的全部消息身份作废。** 换根不是原因（三轮日志都是 `--source-root E:\WechatHis`）。目前 6 个会话没暴露问题，只因为它们是这一版导出的首次导入。

**教训**：验收看数据，不看进程状态。这一轮从日志和进程看完全健康。

### 2026-09-04 · Cowork · 建立 Cowork + Claude Code + Codex 配合

1. 线上无变化——本轮是搭建。
2. CLAUDE.md 重写（`af48aa1`）：精简状态报告协议为三行格式、记录 Organizer V2 生产已开启且只放行 3 段、主线重排为阶段 0–3、Codex 边界限定在 importer/worker/R2、Pro→Max 修正。新增 `v2/scripts/nianlife-status.mjs`（只读核对）。
3. 下一件：本文件（出箱）建立；入箱（Cowork 直接驱动 Claude Code）等 P0 完成后再评估。

---

## 已知的坑（不要重踩）

- **`.git/*.lock` 卡死**：Cowork 侧挂载无删除权限，跑 git 必留锁。清理：`rm -f .git/HEAD.lock .git/objects/maintenance.lock`。根治：git 只由 Claude Code 跑。
- **不能删那 8,550 条主群旧行**：99% 的 `source_memory_links`（2,794）、82/83 个 life_events、143/155 个 daily_traces 都指向它们。删掉等于线上全部内容失去出处。
- 其余坑见 `docs/STATE.md` 第 3 节。
