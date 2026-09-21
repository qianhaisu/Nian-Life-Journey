# HEALTH-02-R1 回执

状态：**已提交审核，等待 Codex**。ACK 基线 main `2bbd9c1`（审核卡提交）；交付 SHA 见文末。HEALTH-01 未重开，未新增医学结论。
脱敏：真实资料只以计数、ID 类别与规则名出现。

## 逐项修复与证据（合成回归：`v2/test/health-r1.test.mjs` 25 项 + 保留的原 17 项，共 42 项全部通过）

### A 增量身份与真实格式
| 审核发现 | 修复 | 证据 |
|---|---|---|
| 同批同身份异内容返回 new+conflict、只存第一版、顺序改变结果 | 同批同身份内容不同 → **整批拒绝、零写入**（不再首条胜出）；相同内容折叠 | A1：两种顺序均拒绝，`revision` 不变 |
| JSON→MD 一条、MD→JSON 两条 | 强/弱身份对齐与顺序无关：强项先规划；强项遇同槽同文弱实体 → **改键收养**（弱 ID 留作别名，版本历史保留）；弱项遇同槽同文强实体 → 记别名；`slotIndex` 含本批新增 | A2：两种顺序均 2 个 source，`businessDigest` 相同，别名保留，无歧义 |
| 同槽异文 | 两条都保留、**不合并**，记入 `ledger.ambiguities`（排序对，顺序无关）并置 `needsReview`；时间轴单列 | A3：两种顺序摘要相同，CLI 退出码 3 |
| Markdown 适配器不支持真实 `## 时间 发送人` + 多行 | 新适配器**复用 HEALTH-01** `parseMarkdownExport/messageIdentity/unescapeMarkdown`（`scripts/health-import/message-adapters.mjs`，另有 WeFlow JSON） | A2：多行正文、转义、`[图片]` 占位保留；私有抽验见下 |
| 空/不支持/解析失败不能空导入成功 | 空输入、无标题、缺会话身份、缺时间/发送人、JSON 形状错误均明确失败（退出码 2），错误只含行号和原因码 | A4：错误信息不含消息正文 |
| 原始消息与健康事实的边界 | 消息路径**只生成 source**；健康事实只经已核事实文件（`adapters.ts`）接入 | A5；模块头注释 |

### B 更正身份、有效值校验、引用
- 同更正 ID 比对**完整规范化请求**（目标/字段或角色/值/作者/时间/理由）；异请求拒绝（B1：换目标、字段、值、作者、理由、时间均拒绝，o2 未被触碰）。
- 字段更正后**重验有效对象**：真实日历（2030-13-45、02-31 拒绝）、精度枚举、时间基准、单位、空角色、`__proto__`/空路径段均拒绝；允许原子多字段更正（如把发生时间置为未知同时改基准），不补猜（B2）。
- 链接更正的 afterRole 必须适用于该链接的实体类型且属于同一关系族（B3）。
- 更正 dry-run 与 apply 走同一 `applyCorrection`，失败原因一致，dry-run 不落盘（B2）。

### C 依赖闭合、分析失效、差异
- 新增 `graph.ts`：唯一的依赖定义（病程→成员/就诊；就诊→其规范事实/文件；观察/事实/病程→来源），用**有效角色**（含人工更正）。
- 影响面 = 反向依赖闭包；分析快照与时间轴块哈希都用**依赖闭包哈希**（成员内容、医院事实、来源绑定版本、有效角色、更正）。
- C1：仅引用 e1 的分析在成员事实被更正 → stale；医院规范事实更正 → `impact.episodes=["e1"]`（事实→就诊→病程）；文件更新同样传递；无关分析保持 current。
- C2：来源修订、事实更正、就诊更正、未挂靠观察更正、来源支持链撤销、病程改名 —— 每一步 **缓存时间轴 == 全量重建**（`timelineContentHash`）。
- C3：差异含未挂靠观察/就诊/事实的**正文变化**。
- C4：链接绑定所依据的来源版本（`toVersion`）；来源后来修订 → 仍显示绑定版本正文，标「有更新版本」并进入 `impact.sourceRevisions`，不自动替换。
- C5：`removed` 的支持链在 trace 和展示中生效、单列 `removedSources`，重导入不复活。

### D 完整适配与可审阅时间轴
- 医院层：规范事实/就诊/处方随病程展示；预约「仅预约（未就诊）」、「仅检查」、「已就诊」区分，且不计入已发生就诊次数；无就诊号的本人事实**保留为未挂靠事实**，不伪造就诊；非本人就诊（X01）排除并报告。
- 来源一对多：同 `document_id` 的**全部**原件都挂到事实；保留 `primary_source`、`agreement_detail`、`all_source_values`、OCR 观察 ID、原件路径/字节数。
- 历史更正：R2 的 10 条以 `historical` 类型入账（前/后值、依据、方法、时间），**作者记为 `unrecorded (method: …)`，不编造审核者**，不改变有效内容；可定位到具体事实的挂 targets（无法定位的不猜）。
- handoff_refs：15 条按记录自身决定挂为候选（4）或同期背景（11），**不计确认事实**；转述层角色 `summary_relay`，显示「汇总稿转述」，不再显示成「交接」。
- 病程保留 canonical / superseded_by / group / 依据 / 关联审核理由。
- 时间轴不再静默截断：501→489 条未挂靠观察**全部列出**；长文本节选处标注并指向 `timeline.json`；未挂靠就诊/事实单列（D1–D3）。

### E 锁与中断恢复（真进程）
- 锁目录内有 `owner.json{token,pid,host}`；**活着的持有者不会因超时被抢**；回收只在持有进程已死（同机）或所有者不可读/异机且超龄时进行，且在**回收互斥**内二次核对（先读后删竞态）；释放与提交前均校验所有权，失去所有权则中止、不写入、不删他人的锁。
- 实测发现并修复一个 Windows 特有缺陷：目录 rename 在另一进程正读取其内文件时会失败，导致锁残留 →30–60 s 超时（旧的目录改名式释放）。改为原地带重试删除后，E5/8+3 并发各连续 6/6 通过。
- E1：3 写入者、`staleLockMs=300ms`、各持锁 1.5 s，无一被抢、revision 恰 +3；E2：SIGKILL 持锁进程后下一写入者**立即**恢复；E3：SIGKILL 在「临时文件已写、提交前」→ 账本字节不变，孤儿 temp 由下一写入者清除；E4：持有者失锁 → 提交中止、未写入、外来锁原样保留；E5：8 并发各仅一次。
- 声明范围：进程崩溃/中断；**不声称**断电持久性（仅尽力 fsync 文件与目录）、也不处理崩溃后 PID 复用。

### F 私有输出边界与失败报告
- `paths.mjs`：解析 symlink/junction（最近存在祖先 realpath），**仓库根本身与任何子路径（含尚未创建）拒绝**；`--ledger/--out/--report` 全部检查；`--allow-repo-path` 已删除。F1 含 junction 指向仓库的用例。
- 退出码统一：0 成功｜1 错误｜2 输入被拒/零写入｜3 需人工审阅；报告与错误只含 ID、计数、原因码、行号，不含正文（F2 用哨兵字符串验证）。

## 私有重跑（`C:\Users\teddy\NianlifeOps\health-tracking\2026-09-21\health-02-r1\`，仅文件账本，未连库）
命令：`node --import tsx scripts/health-import/baseline-dryrun.mjs --r4 …\run-20260920-r4-fix2 --r2 …\run-20260920-r2 --out …\health-02-r1 --export-md <一份真实 WeFlow md>`。九个输入文件运行前后 SHA-256 一致；health-02-a、审核目录、第一批目录未改。
- 账本：source 769（51 来自医院清单）、encounter 15、**canonical_fact 203（=输入全部本人事实，此前丢 5）**、observation 689、episode 10；拒绝 0。
- 与已接受基线：确认关联 164/164、候选 24/24；逐病程就诊数与输入一致；未挂靠规范事实 5（保留）；未挂靠就诊 0；同 document_id 多原件的文档号 5 组；事实→文件链接 313。
- 历史更正 10/10 入账，其中 3 条能定位到具体事实，其余 7 条**未定位、不猜**；handoff 病程链接 15/15（候选 4、背景 11、确认 0）。
- 重放：全部 duplicate，摘要不变。增量演练（前 95% 再全量）：新增 67 项；仅 2 个病程块变化（EP-E +24、EP-G +1），8 块复用；**缓存时间轴与全量重建一致**；最终摘要等于一次性全量导入。
- 真实 Markdown 导出结构抽验（只读，仅计数）：一份真实导出解析 293 条，`消息数量` 头部与解析数一致、无警告，全部弱身份，输出仅 source，文件未变。**只抽验了这一份**，未跑全部会话。

## 检查
`npm run lint` 0 错；`npm run typecheck` 通过；`npm test` 全仓 1549 项：通过 1538、失败 0、跳过 11（原有）；`npm run build`（`DATABASE_URL=` `REPOSITORY_BACKEND=json`）通过。目标测试（health-*）共 42 项。

## 面向 V2 接入的接口与字段映射（未接入）
- 领域：`lib/health/model.ts` 类型 + `ledger.ts` 纯函数（planImport/applyPlan/applyCorrection/computeImpact/analysisStatus）+ `graph.ts`（依赖）。存储接口即 `transaction(fn)`/`read()`（`HealthFileStore`）；Postgres 版本按 `drizzle-health/0001_health_ledger.sql`（本轮同步了别名、`to_version`、`req_hash`、historical 更正、歧义表）实现同一接口即可。
- 映射：`source.content.rawSourceId` ↔ `raw_sources.id`（软引用，未启用）；`episode` ↔ `care_episodes`（不复用 `persistCareEpisode`）；观察/事实不进 `care_records`，保持独立身份。

## 剩余限制 / 未验证
1. 真实 Postgres 事务/并发仍**未验证**；文件锁结论不外推。SQL 仍只写未执行。
2. 未做生产桥接；接入后的「既有故事/媒体不被改」保护未验证。
3. r4 的 wechat 来源无正文，原始消息导入后与之对齐需 `--conversation` 与 r4 的会话标识一致；正文到来时表现为对这些 source 的新版本（`version_change`）。真实全部会话的 Markdown/JSON 未逐个导入验证。
4. `historical` 更正的 7 条未定位到具体事实（不猜），仅挂在来源上。
5. 版本顺序仍为到达序；PID 复用与断电持久性不在保证内。
6. 时间轴 HTML 仍是极简审阅页；未做产品 UI。

## 边界
未连生产、未写业务库、未迁移、未部署、无外部模型调用；真实原文与私有产物不入 Git；未改 `.env*`、`persistCareEpisode`、既有故事/媒体代码；其他会话的未提交改动未纳入。

## 提交
见提交信息与回执补记（本文件由随后的文档提交补记交付 SHA）。

R1 代码与测试交付 `0b37591`（已 push main）。状态：已提交审核，等待 Codex；未进入 HEALTH-03/04，未部署。
