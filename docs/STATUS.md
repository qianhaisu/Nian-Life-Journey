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
### 2026-09-04 · Claude Code · T7 第一步：2025 那条链的真相（与入箱记载不符）

1. **线上多了什么**：本条无线上变化，是 T7 动手前的链路核实。同时 T5（`3bff3ee` 肖像背书）、
   T6（`04d402a` 月份倒序）、T4 代码改造（`3aefad9` `organize` 开关默认关）已推送。
2. **没做到 / blocker**：**T8 两项 Codex 审查都没派出去**——本机没装 Codex CLI
   （`npm install -g @openai/codex` 后 `/codex:setup`）。按入箱要求没有为它阻塞 T7。
3. **下一件**：2026 全年 backfill（rule-based，零 AI）→ quality-audit → family-writer，从 2026-09 往回。

**入箱事实 1、2 需要更正（已逐条核实）**：

- 入箱写「现在网站上所有能读的文字，全部来自 rule-v2 运行」。**不成立。** 2025-07 那条痕迹
  `trace-c8f1f9b8` 的三段 prose（「家人自制了一个床中床…」）在它指向的 **65 条源消息里一条都找不到**；
  源是原始群聊（「同事老婆手织了一条豆豆毯给张小年」「哇，肯定很舒服」）。`rule-based.ts` 的
  `traceEntry` 只产生 **一条** entry（`[traceEntry(sources)]`，取第一条有文字的 source 截 180 字），
  而这些痕迹有 2–3 条。入箱事实 2 猜测的「大概率是 deepseek-family-writer 的改写」**是对的**。
- **完整链条（这是要对 2026 复制的那条，不要新发明）**：
  1. `backfill-wechat-organizer.mjs`（rule-based，零 AI）建 life_events + daily_traces，文字是原始聊天行
  2. `deepseek-quality-audit.mjs` 逐条跑 `runPipeline`，产出 `subjectRelevance` + `coreFacts`
     （证据绑定、≤60 字、过 H1–H9 sanitiser），并写 `content_quality_reviews`。**主体门就在这里**
  3. `deepseek-family-writer.mjs` 把 approved 痕迹的 `entries` 用 `coreFacts` 重写（≤3 条）。
     **这一步不调模型**；没有可用 fact 的痕迹会被撤回 approval 而不是发占位文字
- **因此入箱「建议路径」第二步（自己加一个点名张年的过滤）不用做**：主体门已经存在于第 2 环，
  再加一个平行的门等于新发明一条链，违反入箱自己的「不要发明新链路」。
- 证据：痕迹 `created_at` 2026-09-01 09:05（rule 建的），`entries` 的 `updated_at` 是同日 16:44–16:45
  （writer 改的），而 `organizer_run` 仍是 rule-based——provenance 记的是建者，不是写者。
- 时间线上另一处更正：`life_events` 2025-07 的 title/story 至今仍是原始聊天行（`@hxx\. 下大雨了`、
  `[media]`），说明 writer 的 life_event 改写只覆盖了很小一部分。

**已确认的安全性**：rule 产出 fail-closed（`requiresQualityReview` 对 `organizerType==='rule'` 返回 true，
只有 `approved` 才发布）。所以 backfill 本身**不可能**把错的文字推上网页；花钱和风险都在第 2 环。
`deepseek-quality-audit.mjs` 的 editor variant 默认 v1 → `promptVersion=memory-editor-v1`，与现有 105 条
审阅记录一致，所以已审过的会被跳过，**不会重复计费，也不会改动 2025 已发布的状态**。


### 2026-09-04 15:30 · Teddy · 确认 /about 肖像是张年

1. T5 上线后 /about 的肖像换成夸克照片 `media-quark-sha-379105…`，**Teddy 亲眼确认是张年**。
2. 这是夸克 `family_photo` 背书第一次被人工验证。样本量 1，但方向对：夸克人脸搜索的结果可以作为 `trusted` 来源。
3. 后续凡是靠夸克背书进正文的照片，仍按「未逐个核实」处理，等审阅台。

### 2026-09-04 · Cowork · Teddy 两条决定：T4 → P1，T7 走 C 今天完成

1. 线上无变化——本轮是定位和派单。
2. 定位到的事实：**网站上所有可读文字全部来自 2026-09-01 那一次 rule-v2 运行**（217 traces + 82 memories）。
   AI V2 Organizer 历史总产出 8 次。2026 年零次运行。`rule-based.ts` 没有主体过滤——直接跑私聊会把
   车价写进档案。召回门在 claim-grounding 的主体解析，V7 那对（zero-anaphora + grounded promotion）
   从未在生产启用。
3. 下一件：Claude Code 执行 T7（详见 INBOX），Cowork 每 15 分钟 curl 各月页核对。

**T4 夸克 → P1**（Teddy：可以接受图少）。已做的 apply `organize` 开关改造保留不回滚。

### 2026-09-04 · Cowork · Teddy 抽查四处，两个 P0 漏的 bug，一条新原则

1. 修了 `/about` 肖像（待 T5 提交上线）：`latestPortrait` 只按尺寸选图，选出的不是张年。加背书检查，
   没有有背书的图就空着。
2. 没做到：T2 标了 done，但按 CLAUDE.md「完成的定义」它没完成——文字进了库，页面上一个字没多。
   **以后队列里每条任务的验收必须写「家人在页面上能看到什么」，不能只写数据层的数字。**
3. 下一件：T5 提交 → T6 记忆页排序 → T7 等 Teddy 定。

**Teddy 的新原则**：「可以接受有文字没图，不接受有图没文字。文字要么来自聊天，要么生成故事描述。」
推翻了接手评估 §04 保留的「文字可无图、图可无文」。首页「最近的强照片日」规则、2026 年各月的
纯相册状态，都因此变成违规。

**同一个病的第三次出现**：2025-01 广告（月页）、/about 肖像、以及 Cowork 下午被否掉的尺寸筛选方案——
全是「拿尺寸当照片」。以后凡是选图，一律先问有没有背书。
### 2026-09-04 · Claude Code · T2 主群补齐

1. **线上多了什么**：主群 2025-11-15 → 2026-08-25 的 3,912 条消息和 592 张照片已入库。此前 2025-12 到
   2026-07 这 8 个月在月页上一张照片都没有，现在 2025-12 出 254 张、2026-01 出 139 张、2026-07 出 96 张
   （都在月末档案折叠区，符合 T1 定下的「没有背书的图不进正文」）。主群两个 label 合计 12,462 条，
   覆盖 2025-05 → 2026-08。
2. **没做到 / blocker**：三点。**其一**，接手时导入进程（PID 11992）已经在跑，参数正确，我没有另起第二个
   ——入箱写的重复灌库正是这么发生的。本轮我只做验收，不是我启动的导入。**其二**，实际是 3,912 条不是
   3,958 条；主群合计 12,462 不是 12,508。差的 46 条是磁盘上 2025-11-15 之前、而旧 label `856b8ec2`
   没有收的消息。**这 46 条不建议补**：旧 label 在磁盘上已不存在（导出文件头变了，conversationId 随之改变），
   补它们就要以新 conversationId 重导整段，而 `canonicalMessageId` 含 conversationId，结果是 8,550 条全部
   重复入库。宁可少 46 条。**其三**，`nianlife-status.mjs` 的「图」列按 `media_assets.taken_at` 统计，
   微信图 3,508 张该字段为空，所以那一列仍显示 0——是统计口径问题，不是照片没进去，已逐条核实 592 张
   全部挂在 `media` 表上。
3. **下一件**：T3 渲染性能。刚测的基线：2025/12 4.59s、2025/07 4.09s、2026/01 4.17s、2026/07 3.67s、
   2026/05 3.60s，目标 ≤3s。导入进程已退出，测量期无写入。

**验收数据**：新 label 3,912 行；2025-11-15 之前的行 **0**；与既有 8,550 条 `(captured_at, text)` 重合 **0**；
raw_sources 34,665 → 35,377，增量 712 全部落在该 label。新 task `completed_with_warnings`，batch id 尾部
`:since=2025-11-15T00:00:00.000Z`，`--since` 进 batch id 的改法按预期生效。旧 task `0cbd0588`（failed/4900）
和 cancelled/8550 那条都未触碰。label 内有 9 组 61 行 `(captured_at, text)` 相同——磁盘 3,912 条对库里
3,912 行，**一一对应，不是重复导入**，是群里同一秒的相同内容由不同人发出。

### 2026-09-04 · Claude Code · T1 提交上线

1. **线上多了什么**：nianlife.cn 已部署 4 个提交。2025-01 那个月页的正文里**不再有那三张二手交易广告**——
   实测正文 0 张图，115 张照片全部收在月末档案折叠区，旁白改成「21 天留下了 115 张照片，都收在月末的
   档案里，还没有人确认过它们拍的是什么」。缩略图修复同时上线：档案展开不再送 43 MB 的完整大图。
2. **没做到 / blocker**：缩略图修复只验证了代码路径，**没有实测月页首屏耗时**——那是 T3，而且要等 T2 的
   导入写入停止后再测，否则数字是噪音。
3. **下一件**：T2 主群补 3,958 条（`--since` 已进 `importBatchId`，随 4035062 上线）。


### 2026-09-04 · Cowork · 关掉空月份破例 + 修好缩略图

1. **两处会改变家人看到什么的修复**（待 Claude Code 提交后上线）：
   - `publication-moments.ts`：删掉 `wordlessMonth` 破例。2025-01（他出生那个月）此前在正文里发的是
     两张二手交易平台的尿布台/浴盆广告和一张网上抄来的新生儿奶量表，**没有一张张年的照片**。
     现在没有背书的图一律不进正文，任何月份都一样。旁白同步改成说实话：照片在月末档案里，
     **还没有人确认过它们拍的是什么**。
   - `components/photo.tsx`：`media.thumbnail_src` 在库里 3,199 行全是 NULL，而组件写的是
     `thumbnailSrc ?? src`，于是每次要缩略图都**静默地送出完整 web 大图**——实测 191 KB vs 25 KB，
     差 7.6 倍。月页档案一次展开 225 张 ≈ **43 MB**，这就是点开卡死 30 秒以上的原因。改成从 media id
     推导缩略图 URL，不依赖那个没人填的列；缺缩略图派生的回落到 web 版，只有全尺寸也失败才移除
     （直接消失会藏掉约 185 张没有缩略图行的照片）。
2. 未做：线上验证。两处都要 push 到 main、Vercel 部署后才生效。
3. 下一件：T1 提交 → T2 主群补数 → T3 性能（见 `docs/ORCHESTRATOR-INBOX.md`）。

**验证**：`tsc --noEmit` 通过。全量 `npm test` 基线 618 通过 / 4 失败 → 改后 619/3 → 再跑 618/4。
差异来自 `wechat-worker.test.mjs` 里 `WECHAT_MEDIA_HASH_CHANGED` 那条——**单独连跑三次是
通过/通过/失败，确认为 flaky**，与本次改动无关。另外 3 个固定失败（organizer-evidence-pipeline、
storage-phase-2 的夸克归档）改动前就在失败。

**被这次否掉的方案**：Cowork 曾提议用尺寸筛选（够大、长宽比 <2）让微信图进正文，理由是 1,574 张
「大图」应该是真照片。2025-01 那三张广告直接证伪：`1180x2556`、`1242x1660`、`1050x2276`——
**手机截图本来就又大又接近竖版，尺寸分不出它和照片。** 背书是唯一有效的判据。

### 2026-09-04 · Cowork · 建立入箱

1. 新增 `docs/ORCHESTRATOR-INBOX.md`：Cowork 写任务、Claude Code 执行、结果回到本文件。Teddy 不再转述。
2. 边界写在文件开头：**它传递工作，不传递判断**。删数据、改生产环境、force push、花钱的外部调用、
   **产品判断**、前提不成立——这六类停下来问 Teddy，不要问 Cowork。
3. 队列已排好 T1–T4。

**为什么保留第 5 类（产品判断）**：今天最有价值的一次修正，是 Teddy 自己打开 2025-01 看到三张广告后
说的那句「宁可没有照片，不要错的东西」。两个 AI 都没提出来——Cowork 当时正准备写一个会把更多截图
放进正文的方案。这条通道可以省掉转述，但省不掉他看一眼。

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
