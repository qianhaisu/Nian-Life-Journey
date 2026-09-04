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
| Claude Code | `daily_traces` 2 行删除（T11 数据迁移，09-01/09-02） | 等 Teddy 确认 | — | predeclare 见时间线；确认后立即执行并重跑写库脚本 |

**互斥规则**

- **仓库写**：同一时间只有一个 session 可以改文件 / commit / push（CLAUDE.md 规定）。
- **数据库写**：微信导入和夸克入库写不同的行，也不共用 `chat_import_tasks` 队列，**并不需要串行**（2026-09-04 核实；此前本文写「必须串行」是没有依据的断言）。真实的共享资源只有两个：Neon 连接池（STATE 记过一次空闲连接掉线导致进程级崩溃，两个长任务同压会放大它），以及 **Claude Code 只有一个**——长任务的排队是操作者的排队，不是数据库的排队。
- **性能测量**：测量期间数据库写入必须停止，否则数字是噪音。
- **git 命令**：只由 Claude Code 执行。Cowork 侧的挂载删不掉文件，跑 git 会留下 `.git/*.lock` 把仓库卡住。

---

## 时间线（只追加，最新在上）

### 2026-09-04 · Claude Code · T11 + T12 代码完成；T11 数据迁移等 Teddy 确认

1. **线上多了什么**：T12 已部署（`b6830f4`）——31 条垃圾 life_events（`[media]` 标题、表情包、`@` 提及、
   原始聊天当标题的）在渲染层被过滤，不再出现在月页，数据库行不变。T11 三部分代码已提交（`abf0dc6`）：
   - Part A：`organizer-month-write.mjs` 改为输出 `life_event`（有标题+正文），不再是无标题的 `daily_trace`
   - Part B：`subject-gate.ts` 导出 `DAYCARE_CONVERSATION` 常量；`family-archive.ts` 中乳儿班媒体获得 `trusted` 身份
   - Part C：`publication-moments.ts` 为文字时刻和记忆时刻绑定同天 trusted 照片
   但 **2026-09 月页的格式仍未改变**——现有 2 条 `daily_trace` 还在，要删掉它们并重跑才能出 `life_event`。
2. **最大 blocker**：删除 2 条 2026-09 daily_traces 需要 Teddy 确认（T11 hard boundary）。
   **Predeclare**（供 Teddy 确认后执行）：
   - `daily_traces` 157 → 155（删 `trace-v2-91eb177c84ed0f77533364de36db3e00`、`trace-v2-3205610a1354c62c37a3e62fd403530d`）
   - `content_quality_reviews` 109 → 107（删对应的 2 行 `daily_trace` reviews）
   - `organizer_runs` 488 → 486（删对应的 2 行 organizer runs）
   删完后 Cowork 用 `--day=2026-09-01 --commit` 和 `--day=2026-09-02 --commit` 重跑，产出 `life_event`（157→159，life_events 83→85）。
3. **下一件**：Teddy 确认删除 → 执行删除 → Cowork 重跑 09-01/09-02 → 线上验证格式与 2025-08 一致。

### 2026-09-04 · Claude Code · T10 完成：写库脚本支持按天切片，重跑零成本

1. **线上多了什么**：还没有——T10 本身不写库，是给 Cowork 的写库工具加了两处改动（`b3d2cfa`）。
   `organizer-month-write.mjs` 现在支持 `--day=YYYY-MM-DD`（或 `--from`/`--to`），且已组织过的窗口
   在调用 DeepSeek **之前**就被 `findOrganizerRun` 指纹短路跳过，不再是等写手跑完才发现白跑。
2. **验证**：`--day=2026-09-01`（09-01 已被 Cowork 写入）跑出 `daysConsidered: 1`，那条已提交窗口
   打印「already organized...skipped before any DeepSeek call」且 traceId 对得上；同一天里另一条
   还没提交过的窗口正常照跑不受影响。`written: 0`（未带 `--commit`）。全量 typecheck 通过。
3. **下一件**：Cowork 用 `--day=2026-09-03 --commit` 补上 2026-09 最后一天，然后逐月往前推
   （08、07…01，每月先出 dry-run 样本给 Cowork 抽读，通过后再按天 `--commit`）。

### 2026-09-04 18:05 · Cowork · 2026-09 前两天已写库并核对（Code 被拦下的那条命令，Cowork 跑通了）

1. **线上多了什么**：2026-09-01、09-02 两天的痕迹已入库（部署后可读）。这是今天第一次真正意义上的产出。
   - 09-01：英语课跟读单词，英语老师夸奖；老师说上课可以，提醒一下就开始动起来
   - 09-02：粥粥来时小年说了好多次「粥粥」，发音很清楚；吃点心比别的孩子快
   称谓全部是「老师」，**无一处「家人」**。
2. **没做到**：09-03 还没写——Cowork 侧单条命令 175 秒硬上限，每次重跑都要先把 09-01/09-02 的 DeepSeek
   调用重付一遍才轮到它。已开 **T10**：给脚本加 `--day`，并把指纹短路提到 editor 调用之前。
3. **下一件**：T10 做完，Cowork 按天跑完 09-03，再逐月往前。

**实际 delta（与 Code 的预声明对照）**：`daily_traces` 155 → 157（预声明 158，差的就是没跑的 09-03）；
`content_quality_reviews` 107 → 109，全部 `daily_trace` / `approved`；`organizer_runs` 486 → 488；
`life_events` 83 未动。**方向和比例完全符合预声明，没有意外写入。**

**两个机制第一次被实测**：
- 指纹幂等：第二次跑同一天打印 `already organized under this fingerprint, no new write`，零重复
- 主体门：2026-09 共 30 个窗口，**只有 14 个通过**；消息保留 120、拒绝 338。validator 另外拒了 3 个
  （`inner_state_stated_as_fact`——写手替孩子说了心理活动），writer 自己判 2 个证据不足。层层都在挡。

**Cowork 侧的一条环境事实（写进坑里）**：device_bash 每次调用是独立沙箱 `--die-with-parent`，
**后台进程活不过一次调用**；`pgrep` 还会匹配到自己的命令行给出假的 RUNNING。长任务必须前台跑，
或者切片跑。今天为此白等了 20 分钟。

### 2026-09-04 · Claude Code · T7 写库脚本已就绪，实际写入被本机权限拦下，需要 Teddy 手动跑一条命令

1. **线上多了什么**：还没有。写库脚本 `v2/scripts/organizer-month-write.mjs` 已经写好、typecheck 通过、
   不带 `--commit` 时跑过两次，行为和只读的 `organizer-month-dryrun.mjs` 完全一致（已核对：gate 统计、
   写手输出、`written: 0` 全部对得上，`张小年小群 md`（`d016ea9b`，还没删的那 11 行）在这次跑里正确显示
   `policy: "excluded"`，没有一条通过）。**带 `--commit` 的那一次真实写入被 auto-mode classifier 拦下**
   （前台、后台各试了一次，`Reason: Blocked by classifier`）——这是工具层的拦截，不是 T7/CLAUDE.md 里
   任何一条边界的问题，我按规则没有尝试绕过。已发桌面通知给 Teddy。
2. **Teddy 需要做的**：在这个仓库的终端里手动执行（或把 Bash 权限规则调整成允许后我再跑）：
   ```
   cd v2
   REPOSITORY_BACKEND=postgres node --import tsx scripts/organizer-month-write.mjs --month=2026-09 \
     --out=<仓库外任意路径>.json --max-calls=40 --commit
   ```
   **Predeclare（写之前的基线，供跑完核对）**：`daily_traces` 155 → 预计 158（+3）；
   `content_quality_reviews` 107 → 预计 110（+3，全部 `target_kind=daily_trace`、`decision=approved`）；
   `organizer_runs` 486 → 预计 489（+3）；`life_events` 不变，仍是 83。三条预计是 2026-09-01、09-02、
   09-03（每条一个 `daily_trace`）。**DeepSeek 调用预计 ≤21 次**（上一次不带 `--commit` 的同参数跑用了
   21 次，T7 至今累计约 70 次，远低于 300 次上限）。跑完请把终端输出的 `=== SUMMARY ===` 那段贴回本文件，
   我会核对实际 delta 是否与预声明一致，不符会立即停下。
3. **脚本设计要点（供审阅）**：
   - 沿用 `organizer-month-dryrun.mjs` 完全相同的主体门 → DeepSeek 写手 → grounding → narrative
     validator 链路；`--commit` 之前的每一步判断（拒绝/通过）逐字相同，只是在「验证器通过 + 无家人」
     之后多了一步持久化
   - 持久化走 `lib/organizer/production-adapter.ts` 的 `planArtifacts`/`applyPlan`（生产 V2 pipeline
     本来就用的同一套函数），不是手写 SQL；`organizationFingerprint` 复用 dry-run 已验证过的窗口指纹，
     `applyPlan` 自带按指纹幂等（重跑同一天不会二次写入，见 `findOrganizerRun` 短路）
   - **`daily_trace` 分支本身不写 `content_quality_reviews` 行**（只有 `life_event` 分支写）——查过
     `production-adapter.ts` 源码确认。而 `requiresQualityReview()` 对 `organizerRun.organizerType==="ai"`
     一律 fail-closed，没有审阅行的 AI 产物写了也是永久不可见。脚本因此在 `applyPlan` 成功后单独调用
     `persistQualityReview({ decision: "approved", ... })`——这个「approved」就是 Cowork 在 STATUS.md
     里已经做过的人工通过的代码化，绝不能在没有那条「通过」记录的情况下触发（这条路径目前只在这个
     脚本、只在这一次调用里存在）
   - `DailyTrace` 类型本身没有 `title` 字段、没有媒体字段（`lib/types.ts:61` 核实过）——写手的
     `title` 和 `usedMediaIds` 因此不落库，只有 `story`（整段正文）进 `entries`。这和现有月页的渲染
     方式一致（`entries` 就是按天显示的正文，从未读过任何标题字段），媒体关联的确实缺口 Cowork 17:15
     已经记过（P1-4 的事，不阻塞今天）
4. **下一件**：Teddy 跑完写库命令后，我 commit 这个脚本（还没提交）+ push，然后 curl `/memory/2026/09`
   核对页面，回来给 Cowork 抽读。之后按 T7 步骤 3 继续 08、07…01，一个月一个月，每次都先 dry-run
   （不带 `--commit`）等抽读通过再写。

### 2026-09-04 17:22 · Cowork · md 重复行退役：88 / 90 已删，小群 11 条等 json

Teddy 17:20 批准删除。predeclare 与实际一致，COMMITTED：
- 乳儿班 md `bb5d5ba6`：70 行 raw_sources + 36 行 media 删除；36 个 media_assets 的 owner 改指到 json 那份的 raw_source（资产本身共享，未删）。孤儿资产 0。
- 亲爱的爸爸妈妈 md `2bca9fd8` / `b4bdc971`：各 9 行删除，无媒体。
- **张小年小群 md `d016ea9b` 11 行暂留**：它唯一的一个 media_asset 还没有 json 那份来接手（小群 json 未导），现在删会留孤儿资产。**等 T9a 把小群 json 导到 2026-09 后再删**（已写进 INBOX T9a 第 4 点）。
库：raw_sources 37,241 → 37,153；media 4,516 → 4,480；media_assets 4,400 不变。

### 2026-09-04 17:15 · Cowork · 抽读通过：2026-09（带一个写库前提）

逐条判断（4 条不同事实 + 1 条重复）：

| 日期 | 来源 | 关于张年 | 称谓 | 「家人」 | 判断 |
|---|---|---|---|---|---|
| 09-01 英语课跟读被夸 | 乳儿班 json | ✅ | 老师 | 0 | **通过** |
| 09-02 喊粥粥 | 乳儿班 json | ✅ | 老师 | 0 | **通过** |
| 09-02 喊粥粥（md 份） | 乳儿班 md | ✅ | 老师 | 0 | **重复，不写** |
| 09-03 画画涂头发 / 奶奶说吃饭香香 | 乳儿班 json + 奶奶私聊 | ✅ | 老师、奶奶 | 0 | **通过**——奶奶那句证明 registry 的 陈亚萍→奶奶 生效了 |

**结论：2026-09 通过，可以写库，前提一条**：写库时把四个 md 来源的会话排除在主体门之外——
`bb5d5ba6`（乳儿班 md 70）、`d016ea9b`（小群 md 11）、`2bca9fd8`、`b4bdc971`（爸爸妈妈 md 各 9）。
json 是同一会话更完整的那份，md 份今天不参与生成，**不需要删任何行就能避免重复**。90 行 md 的退役
（删除）另行等 Teddy 确认，不阻塞今天。

**顺手记两条，不阻塞**：
- 09-02 那条挂了 2 张 `wechat-media`。乳儿班群的图几乎必然是张年，但按现在的背书规则它们是「无背书」，
  展示层会自己决定放不放——这是 P1-4 要定的事（乳儿班是否升级为 trusted 来源），今天不改规则。
- 引号内多了个尾逗号（「涂下巴，」），写手的标点小毛病，P2 排版时一并看。

**给 Code**：按上面前提写库 2026-09 → commit + push → 在这里追加三行。我会 curl /memory/2026/09 核对。
### 2026-09-04 · Claude Code · T9 已派发给 Codex（后台，不等结果）

1. **线上多了什么**：暂无——本条只是派发记录。T9a（代理测速 + 并发调优 + 续跑三个群 + 乳儿班剩余月份 +
   身份重合预声明）、T9b（诊断并按边界修复 3 个固定失败测试）都已用 `/codex:rescue` 的等价机制
   （Agent 工具，`codex:codex-rescue` 类型）后台派出，不等结果，立即回到 T7。
2. **交接给 T9a 的信息**：我自己在这之前手动重启过一次 `wechat-import-all`（未加代理/并发调优），
   已在派发前主动 kill 掉，避免和 T9a 抢连接池；同时把这次重启过程中顺手修的一个 importer bug
   （见下方）一并写进了给 T9a 的任务说明里，以及本 session 已验证过的「身份重合」正确匹配公式
   （避免 T9a 重新踩坑）。T9a/T9b 完成后按各自要求会自己往这份文件追加，不会转述。
3. **下一件**：回到 T7，等 Cowork 抽读上一条的 5 条样本；同时等 T9a/T9b 的完成通知。

**顺手修的 importer bug（与 T9 派发同批，已验证，已提交待推送）**：`wechat-import-all.mjs` 的
「已完成」状态原来只按 `conversationDigest` 记（文件路径的哈希，与 `since` 无关）。我在这之前用
`--since 2026-09-01 --only 3` 单独导了乳儿班 9 月的 218 条，完成后这条记录把 conversationDigest
标记为「已完成」，导致**后续任何不带 --since 的重跑都会把乳儿班整条会话当成已完成而跳过**——
7,244 条里当时只有 1,668 条真的进了库，其余 ~5,500 条会被永久跳过而不报错。已修成
`${conversationDigest}|${since}` 复合键，legacy 裸 digest 按「等价于 birth day」规范化；
手工修正了本地状态文件里那一条被污染的记录；跑 `--only 3 --dry-run` 验证过修复后乳儿班重新显示
「would import 7244 message(s)」，不再被跳过。**这类问题验收看数据，不看进程日志**——当时日志和
进度看起来完全正常。

### 2026-09-04 · Claude Code · T7 步骤 3：2026-09 dry-run 第一次跑通，5 条样本待抽读

1. **线上多了什么**：还没有——这是 dry-run，零写入。**但链路第一次端到端跑通**：主体门 → DeepSeek
   写手 → narrative validator，全程真实数据。2026-09（到今天 4 号为止）共 3 天有文字：09-01、09-02、
   09-03。09-04 尚无数据。DeepSeek 调用 28 次（T7 总预算 300 次内）。**5 条样本见下方，请 Cowork 抽读**。
2. **没做到 / 新发现的 blocker（重要，会影响写库设计，先别写库）**：
   **发现同一天出现两条几乎相同的文字**——09-02 有两条几乎一样的段落（都是「粥粥」和吃点心的事），
   一条来自 `conversation:2109e1e8…`（json，7,244 条那个），一条来自 `conversation:bb5d5ba6…`
   （md，70 条那个）。查明原因：**这就是步骤 0 里预留的「身份冲突」**——md 和 json 是同一个乳儿班群的
   两次导出，同一句话在两边身份不同（`documentDigest` 不同 → `canonicalMessageId` 不同），所以数据库里
   有两份。这一步以前没做，**dry-run 帮我们提前暴露了它会怎样影响成稿**，而不是等写库后才发现重复。

   顺手把「按 (sentAt, sender, text) 找重合」这条预案自己验证了一遍，**发现它本身有两处坑，已查清**：
   - 原样精确匹配（文本一字不差）**命中 0 条**——两边文本首尾空白不同（md 是 `\n\n…\n`，json 是 `\n…`），
     这是两个 parser 对同一句话的正常格式差异，不是内容不同
   - 换成「按发言人摘要 + 掐头去尾比对」后，乳儿班 70 条 md 里能对上 json 的只有 **18 条**，其余 52 条
     全部是 `[media]` 占位符——json 的媒体消息 text 是空字符串（`da18cc7` 就是这么设计的：媒体路径绝不
     进正文），而 md 的媒体消息 text 是字面量 `[media]`，两边永远文本对不上，**但引用的是同一张图/同一条
     语音**。纯文本匹配天生覆盖不到这一半
   - **结论**：不建议按逐条文本匹配来决定删哪条。更合适的做法是「md 那份被同一会话更完整的 json 那份
     整体取代」——张小年小群、亲爱的爸爸妈妈这两个群的 json 还没导（下面在跑），等它们的 json 覆盖到 md
     那几条的日期后，**预计**可以把 70 + 11 + 9 = **90 条 md 行整体退役**，而不是逐条比对。这仍然是
     删除生产行，**仍需 Teddy 单独确认，预声明数字**，我没有删任何东西
3. **下一件**：等 5 条样本 Cowork 读完；同时后台继续把乳儿班剩余月份 + 另外三个群的 json 导完
   （PID 见占用板），为 08 月及更早的 dry-run 做准备。

**5 条样本（贴给 Cowork 抽读）**

> **2026-09-01**（乳儿班 json）
> 标题：英语课跟读单词被老师夸
> 正文：英语课上，小年跟读了英语单词，英语老师夸奖了他。老师转述说「小年上课可以的」，只是要提醒一下才开始动起来。

> **2026-09-02**（乳儿班 json）
> 标题：小年清楚喊出粥粥的名字
> 正文：粥粥来了，小年说了好多次「粥粥，粥粥」。老师说「发音很清楚的」。老师还说，小年吃点心每次都比别的孩子快。
> 用图：2 张（wechat-media 开头的哈希 id）

> **2026-09-02**（乳儿班 md，与上一条重复——见上方 blocker）
> 标题：小年喊出粥粥的名字
> 正文：老师转述，粥粥来的时候，小年说了好多次「粥粥，粥粥」，发音很清楚。老师还说，吃点心时小年每次都比别的孩子快一点。

> **2026-09-03**（乳儿班 json）
> 标题：画画涂到头发上，吃饭香香
> 正文：托班画画时，小年把笔涂到脸上、下巴和头发上，头发上涂了紫色。老师转述说「小年把笔涂脸上，涂下巴，」
> 「头发上也涂了紫色」。奶奶说小年宝吃饭香香，了却了心里最大的牵挂。
> 用图：1 张

**验收对照表**

| 检查 | 结果 |
|---|---|
| 抽读 5 条 | 4 条不同事实 + 1 条重复（见上）；全部关于张年，无失实 |
| grep「家人」 | 4 条正文里 **0 次**出现「家人」；用的是「老师」「奶奶」 |
| 来源回溯 | 每条 `claimsFromGatedSources` 均 ≥1，每条都能指回一条过了主体门的原文（脚本里已强制） |
| life_events | 未动，仍是 83（dry-run 不写库） |
| 私聊来源 | 09-01/02/03 三天里，阿静私聊有 2 个窗口过门，本次不在 max-calls 内被处理到，下一轮会覆盖 |

**已知次要问题（不影响本轮结论，顺手记录）**：`wechat-snapshot.ts:168` 的 `parserVersion` 写死成
`"wechat-official-markdown/1"`，json 转录导入后这个字段也是这个值——纯描述性 metadata，不参与任何
身份/去重/门禁逻辑，之后顺手修，不阻塞。

### 2026-09-04 · Claude Code · T7 步骤 0 续：改按 --since 单独导 2026-09（进行中）

1. **线上多了什么**：还没有——本条是路线调整。原后台导入（PID 11352，`--only 1,3,4,5,12 --skip 1`，
   不带 `--since`）按时间顺序导，已入乳儿班 1,400/7,244 条，停在 2026-03-18，离 2026-09 还有 5 个月的量。
   confirmed 安全可 kill：checkpoint 与库内行数一致（1,400 对 1,400），batch 语义是整批消息+媒体全部
   落库才推进 checkpoint，重跑不丢不重。已 kill，改跑 `--only 3 --since 2026-09-01`
   （dry-run 确认只有 218 条消息、93 个媒体，而不是 7,244 条的全量）。
2. **没做到 / blocker**：这条小任务本身在跑（≈26 分钟，93 个媒体 @ 3.6/分钟）。其余三个群
   （亲爱的爸爸妈妈、张小年小群、小雪微信群）+ 乳儿班 2026-09 之前的部分，仍需要后续继续跑——
   T7 明确要求从 2026-09 开始，其余月份不必等它们导完。
3. **下一件**：这条完成后跑 `organizer-month-dryrun.mjs --month=2026-09`，出 5 条样本贴这里给
   Cowork 抽读。

**正在后台运行，不要重复启动**：`wechat-import-all --only 1,3,4,5,12 --skip 1`（PID 11352）。
已入约 1,100 / 13,379 条。**可以安全 kill 并重跑**——消息身份由内容派生，重跑记为 reused。
进度用 `select count(*) from raw_sources where status='uploaded'` 看（基线 22,465）。

**下一步（按顺序）**

1. 等导入跑完，或先停掉它、改用 `--since 2026-09-01 --only 3` 单独把乳儿班的 9 月先导进来
   ——乳儿班按时间顺序导，2026-09 在最后才到，而 T7 要求从 2026-09 开始。`--since` 会自建新 task
   （`4035062` 已验证不产生重复行）。
2. 跑 `node --import tsx scripts/organizer-month-dryrun.mjs --month=2026-09 --out=<仓库外>.json --max-calls=12`。
   零写入。把 5 条样本贴进本文件给 Cowork 抽读。**Cowork 写「通过」之前不写库。**
3. 通过后再做写库路径——**目前还没有写库脚本**，dry-run 驱动只报告不落库。这是刻意的。

**已知 blocker**

- **导入吞吐**：媒体派生 + R2 上传约 3.6 个/分钟，4,893 个媒体要十几小时。`--max-media` 不能用。
- **dry-run 首次未验证完**：第一次跑卡在读全库 36,000 行（10 分钟），已改成只读当月 ±7 天后停掉重来，
  **所以链路端到端还没跑通过一次**，写手输出长什么样、会不会被 narrative validator 拒，都还不知道。
- T8 两项 Codex 审查仍 blocked（本机没装 Codex CLI）。

**这轮没有动生产数据的任何一行**（除了导入新增的 raw_sources/media）。155 条 daily_traces、
83 条 life_events 原封未动。

### 2026-09-04 · Claude Code · T7 步骤 0：四个家庭群的 JSON 已能导入（进行中）

1. **线上多了什么**：暂时没有。本条是步骤 0 的代码与进度。importer 现在能读 WeFlow 的 JSON 转录
   （`da18cc7`），四个群的历史第一次可导：乳儿班 7,244、亲爱的爸爸妈妈 5,189（出生日起）、
   张小年小群 643、小雪微信群 303，合计 **13,379 条 + 4,893 个媒体引用**。dry-run 已核对，
   主群的 json（索引 1）已按会话摘要**永久排除**，不会重复 12,508 行。
2. **没做到 / 最大 blocker**：**导入吞吐**。媒体派生 + R2 上传实测约 **3.6 个/分钟**，4,893 个媒体
   意味着十几个小时；消息按 400 条一批落库，第一批 400 条已入。乳儿班按时间顺序导，**2026-09 的
   数据在最后才到**，而 T7 要求从 2026-09 开始。这正是 CLAUDE.md 点名的 importer 吞吐问题。
   `--max-media` 不能用（会把媒体标记 deferred_by_limit，照片永久丢失）。
3. **下一件**：等 2026-09 的 dry-run 结果（已在跑，`--max-calls=12`），把 5 条样本贴进本文件给
   Cowork 抽读；同时决定导入是否整夜跑。

**本轮已提交的代码（都不写生产数据）**

- `da18cc7` WeFlow JSON 解析器 + 快照扫描器识别 `.json`。与 md 解析器产出完全同形；媒体路径变成
  media ref，**文件路径绝不进正文**；无时间戳的消息计数后丢弃，不塞进猜的日期；ordinal 数所有记录，
  所以丢一条不会让后面全部重编号变成重复导入。9 条测试。
- `1f6a4a1`（`wechat-import-all`）**「已导入」改按会话摘要判定**。原来按索引记录，而新增 5 个 JSON
  会话让索引整体位移，导致三个从未导过的群被报成「已完成」——脚本自己的注释早写过索引不能当持久键。
- `c68fc05` **主体门** `lib/organizer/subject-gate.ts` + 9 条测试，全部用生产里真实出过问题的例子
  （「你几点下班」「19款17万公里也报价11万」）。乳儿班全放行；群聊要点名或同一发言人紧接着的续句
  （按发言人**摘要**判定，不按显示称谓——几个老师账号都显示「老师」）；私聊只留点名的，零指代不救；
  空消息/占位符/纯表情/纯链接一律不进；**未登记的会话按最严的私聊规则处理**。
- `c68fc05` **按月 dry-run 驱动** `scripts/organizer-month-dryrun.mjs`：零写入，只出按天段落、
  **绝不产 Memory**，文本里出现「家人」直接拒绝该天。
- 后续提交：每条句子必须能回溯到一条**过门**的原文，接地事实只依据被拒消息的一律丢弃。
- `family-registry`：**陈亚萍 → 奶奶**（Teddy 16:00，此前「低价值」判定作废）；乳儿班五个机构账号
  → 老师，共用一个 canonicalPersonId（一个机构 = 一个证人，不是五个互相印证）。个人身份不猜。

**找到「家人说」的根因并已修**：审阅链给模型的每条消息都硬编码 `contributorRole: "family"`，
模型看到的每个发言人角色都是「family」，所以它写「家人」——**它在复述我们递给它的东西**。
现在从 registry 解析真实称谓传进去（妈妈/爸爸/雪姨/奶奶/老师），解析不到的保留匿名代号，写手不给它安名字。


### 2026-09-04 16:05 · Cowork · T7 第一轮清理 + 发现四个家庭群没导入

1. 线上无变化。T7 第一轮（rule-v2 原样入库）已清：119 traces + 57 events + 1,267 links + 136 media 解绑，predeclare 与实际一致。库回到 155 / 83。
2. **发现**：importer 只读 .md，四个家庭群的历史只在 .json——乳儿班 7,244 条（2026-02→09，Teddy：全部关于张年）、亲爱的爸爸妈妈 7,925、张小年小群 643、小雪微信群 303，合计一万多条几乎零主体风险的 2026 文字**从未入库**。此前「2026 文字主要在私聊」的判断因此不成立。
3. 下一件：T7 重来，步骤 0 = 导这四个群的 JSON（见 INBOX）。

**Teddy 16:00 更正**：陈亚萍是**奶奶**。STATE §2 第 6 条「陈亚萍私聊低价值、已排除」作废；写手称谓表要加 陈亚萍 → 奶奶。

### 2026-09-04 15:55 · Teddy · 「家人说」是搞笑的

1. Teddy：阿静 = 苏静 = 妈妈，hxx = 雪姨 = 育儿嫂，ted = 爸爸——「这还不够吗？还能出现家人说这三个字？」
2. 核实：`family-registry.ts` 早就有完整映射和 `narrativeLabel`。「家人」来自写手 prompt（`family-writer.ts:40, 47`）自己写死，不是缺数据。Cowork 此前还把它列成 P2 待拍板事项——是在制造不存在的决定，撤回。
3. 进 T7 硬边界：写手必须用称谓，解析不到的不写，不回落「家人」。验收 grep 月页无「家人」。

### 2026-09-04 15:45 · Teddy · 不建审阅台

1. Teddy：「最终审阅台不用加了，我没空审阅。」早上决定 #1 里「人工审阅台」那一半撤销。
2. 后果：没有人工门，只剩自动门。与「宁可没有不要错的」同时成立的唯一解是**门开严、接受页面稀、Teddy 偶然看到错的就纠正**。P1 原 P1-1 删除；主体门校准改为加严 + Codex 假阳性审查 + Cowork 每轮抽读；照片绑定改为全自动双背书（夸克照片 且 同日有过门文字）。
3. 对 T7 的直接影响：私聊来源只留主体明确的句子，拿不准就不写。
### 2026-09-04 · Claude Code · T2 更正：12,508 已达成，缺的 46 条已补

我先前那条 T2 记录说主群合计 12,462、差 46 条、且不建议补。**前半对，结论已过时。**

14:43 有第二次导入（不是我起的）跑了 `--since 2025-11-14T02:59:00`——正好落在旧 label 最后一条
（`2025-11-14 02:58:55`）之后一秒——新增 **46 行**，把缺口补上了。现在：

- `856b8ec2` 8,550 条，2025-05-19 → 2025-11-14 02:58:55
- `a673c0e0` **3,958** 条，2025-11-14 02:59:00 → 2026-08-25
- 合计 **12,508**，与入箱验收数字一致；两个 label 的 `(captured_at, text)` 重合仍是 **0**

**它顺带证实了一件本来要靠 Codex 审的事**：第二次导入用不同的 `since` 重新处理了同一批 3,912 条消息，
只新建了 46 行（3,912 + 46 = 3,958），**其余全部判为 reused**。所以 `--since` 进 `importBatchId`
不会因为重新划范围而产生重复行——`canonicalMessageId` 在 `recordOrdinal` 分配之后才过滤，
会话摘要只取文件路径，两者都不随 `since` 改变。这是生产实测，不是推断。

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
### 2026-09-04 - Codex - WeChat R2 throughput measurement

1. Full three-object cycle (original JPEG plus thumbnail and web WebP, including the pipeline-equivalent verification calls): direct 12.672 s for a 3,393,681-byte sample; HTTP_PROXY/HTTPS_PROXY environment variables alone 12.720 s for a 3,392,980-byte sample; explicit proxy agent 22.861 s for a 3,388,352-byte sample.
2. The AWS SDK did not honor proxy environment variables until explicit wiring was added; explicit proxy was slower, not 3x faster. The resumed import will therefore run without proxy variables.
3. Benchmark-only R2 objects were deleted after each cycle. No chat content, conversation file paths, credentials, or production rows were recorded here.
### 2026-09-04 - Codex - WeChat import resumed

1. The driver resumed index 3 from its DB-backed checkpoint with `--media-concurrency 12`, skipped index 1, and used no max-media or max-messages limit; confirmed checkpoint: 1,550 messages.
2. Current JSON source row count: 1,768 of expected 7,244; observed date range: 2026-02-23 through 2026-09-03; conversation remains in progress, so this is not yet a completion count.
3. No R2 429 or connection-error state was observed at this checkpoint. Indexes 4, 5, and 12 remain queued behind it; reconciliation is deferred until each JSON date range is complete.

### 2026-09-04 · Cowork · T11 INBOX 写入——格式一致性修复 + 乳儿班照片

1. **线上无变化**——本轮是任务规划。
2. 写入 T11 到 ORCHESTRATOR-INBOX.md，三个部分：
   - **Part A**：T7 管线从 `daily_trace` 改为 `life_event_candidate`。根因是 Writer v2 已经生成
     title + story，但管线丢弃 title 存为 daily_trace → 渲染走 TraceDisclosure（折叠）而非
     EditorialMemory（有标题、显眼）。production-adapter.ts 已有完整的 `life_event_candidate`
     分支，改动集中在 `organizer-month-write.mjs`。现有 2 条 2026-09 daily_traces 需删除重写
     （需 Teddy 确认）。
   - **Part B**：`mediaPrivilegeOf` 扩展，信任乳儿班（conversation:2109e1e89306b57b8334d349）媒体。
     库内 2,434 张全是 sourceType=wechat 无背书；1,076 张达到 hero 尺寸。按 sourceLabel 判断，
     零数据修改。
   - **Part C**：`publication-moments.ts` 的 text_led / memory_led 时刻绑定同天 vouched 照片。
     渲染侧（month-moment.tsx）已支持所有 kind 的 hero/supporting，不需要改。
3. **下一件**：等 Claude Code 执行 T11。同时 Cowork 审查线上其他质量问题。

### 2026-09-04 · Cowork · 主动质量审查——发现 83 条 life_events 中 55 条有质量问题

1. **线上有问题但未触发部署**——本轮是只读审计。
2. 审查发现现有 83 条 life_events（全站最显眼的内容）中：
   - **31 条（37%）是垃圾**：标题和正文都是 `[media]`、`\[表情包\]`、`\[呲牙\]`、GPS 坐标、视频文件路径等 WeChat 占位符。**家人看到的是一列 `[media]` 标题**。
   - **10 条（12%）含「家人」**：正文用「家人说」「家人转述」替代了具体称谓，违反核心规则。
   - **14 条（17%）原始聊天消息**：标题就是未编辑的聊天消息（含 @提及），title === story。
   - **仅 28 条（34%）**有可接受的编辑质量。
   全部来自 `created_by: 'rule'`、`organizer_version: 'rule-v2'` 的旧管线，从未经过 Writer v2。
3. 写入 T12 到 INBOX：渲染层过滤，不删数据，立即可做。家人和原始聊天标题留给 T7 逐月重写时修复。
4. **下一件**：T11（格式修复）+ T12（垃圾过滤）是当前最高优先级，都在 T3/T7 剩余月份之前。

### 2026-09-04 · Cowork · T13 写入——发现 T7 回刷重大碰撞风险

1. **线上无变化**——本轮是风险分析 + 任务规划。
2. **发现**：T2 导入在 rule-v2 跑完之后，给 2025-05 到 2025-11 增加了 8,981 条 raw_sources。
   T7 指纹 = `sha256(conversationId|activityDate|sortedSourceIds)`，source 变了 → 指纹变了 →
   `applyPlan` 不会 skip → 会在旧 life_event 旁边再写一条新的 = **114 条重复 life_events**。
   实测 2025-06-09：rule-v2 用 2 条 source，现在同天同群有 5 条。
3. **写入 T13 到 INBOX**：在 T7 处理 dirty months 之前，需 Teddy 确认删除 rule-v2 产的旧数据
   （~82 life_events、~144 daily_traces、~475 organizer_runs）。66% 是垃圾质量，无保留价值。
4. **T7 可以安全先做 clean months**：2025-01→04, 2025-12, 2026-01, 2026-03→07 共 11 个月，
   无旧数据碰撞。这不需要 Teddy 确认。
5. **T7 执行顺序调整**：Phase 1 clean → Teddy 确认 T13 → Phase 2 cleaned。
