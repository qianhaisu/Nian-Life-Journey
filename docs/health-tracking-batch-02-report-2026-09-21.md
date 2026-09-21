# HEALTH-02 回执：模型、增量导入、更正留痕与可追溯时间轴

状态：**已提交审核，等待 Codex**。ACK 基线 `cae393d`（main，与 origin 同步）。交付 SHA 见文末「提交」。
本文脱敏：不含真实病例/消息/标识；真实资料仅以计数与规则名出现。

## 1. 现有能力与缺口（先读实际代码）

| 现有 | 对健康够不够 |
|---|---|
| `RawSource`（`v2/lib/types.ts`）单行 + 平面 `status` | 无版本、无角色（问句/提醒/回忆/转述）、无时间精度、无审核态、无多对多引用 → 不够 |
| `CareRecord` / `CareEpisode` | 无版本、无「确认/候选/同期背景」区分、无结束状态三分（进行中/明确结束/结束未知）→ 不够 |
| `persistCareEpisode()`（postgres-repository） | 同日 open 合并（会把同日不同事件并成一个病程）+ 改写来源整理状态与故事关联 → **本批不调用、不改** |

处理：新增一份与 V2 并排的健康账本（`v2/lib/health/`），对 RawSource 只留软引用（`source.content.rawSourceId` 预留位，未启用），因此以后可桥接而不需改 schema；本批不读写应用库，不 import `lib/db`（测试里有结构性断言）。

## 2. 最终变更

- `v2/lib/health/model.ts` 实体（source/observation/canonical_fact/encounter/episode）、多对多 `links`（角色：`from_source/supports/attached/candidate/background/encounter/of_encounter/documented_in`）、版本、更正、分析、证据、运行日志；`businessDigest` 只哈希业务内容（不含运行日志、运行 ID、时间戳）。
- `ledger.ts` 纯函数：`planImport`（=dry-run）、`applyPlan`、`applyCorrection`、`computeImpact`、`putAnalysis/analysisStatus`、后置不变量检查；通用校验器（无家庭 ID/日期/疾病词硬编码）。
- `file-store.ts` 文件账本 + `mkdir` 原子锁 + temp→rename 事务；崩溃/异常不改 `ledger.json`；死锁按陈旧时间回收。
- `importer.ts` 默认 dry-run；apply 在锁内**对最新账本重新规划**（不用锁外旧计划）；拒绝整批则抛错、零写入。
- `timeline.ts` 按病程分块，输入哈希未变则复用旧块；`diffTimelines`；`traceObservation`；MD/HTML/JSON。
- `adapters.ts` 显式适配 R4 微信事实、R4 病程、R2 医院规范事实/清单、汇总稿转述层、增量微信 JSONL/Markdown。
- `scripts/health-import/cli.mjs`（import/correct/timeline/analyses；账本目录必须在 Git 仓库外）、`baseline-dryrun.mjs`（私有基线文件级 dry-run）。
- `v2/drizzle-health/0001_health_ledger.sql`：拟议 Postgres 形态，**不在 drizzle journal，未执行**。
- 测试：`v2/test/health-ledger.test.mjs`（16）、`health-concurrency.test.mjs`（2，真多进程）。

关键设计决定：
- 身份=强 ID；同 ID 同哈希（含**历史**版本）→ duplicate（旧版本重放不复活）；同 ID 新哈希 → 新版本。弱身份（无消息 ID 的 Markdown）绝不凭分钟合并：同会话/时刻/说话人且文本一致 → duplicate，文本不同 → `ambiguous`（保留、不写入、报告）。
- 版本序 = 到达序（无带外修订时间，未知不猜）。
- 链接只增不改；同一 观察→病程 出现相反角色 = `membership_role_conflict`，不覆盖；人工链接更正（含 `removed`）优先，再导入不复活。
- 确认事实数只数**有效角色为 attached** 的链接；候选/背景永不计入。
- 药物/测量必须带单位；同身份单位变化 = `conflict(unit_changed)`，不静默成新版本。
- 未知发生时间必须声明 `timeBasis`；`occurredAt` 不许声称 `message_time_only`；时间轴对无发生时间者显示「仅消息记录时间，发生时间未知」。
- 病程结束状态：`ongoing / ended / end_unknown` 为声明值；`stale_no_recent_update` 由 `asOf` 与最后更新推导（不落库）。R4 无「仍在进行」断言 → 适配为 `end_unknown`，不冒充进行中。
- 更正 = 作者+时间+理由+前值+后值+基线版本；同 ID 同内容幂等，同 ID 异内容拒绝。
- 分析独立成层：快照 = 事实有效哈希 + 病程成员哈希 + 证据版本；事实变更/成员变更/更正/证据版本变更 → `stale`，证据撤回 → `invalidated`；重登记 = 新快照。本批**不生成任何诊断/治疗建议**。

## 3. 验收场景结果（合成数据，`node --import tsx --test test/health-*.test.mjs` 18/18）

| 场景 | 结果 |
|---|---|
| 相同资料两次、乱序/分片重放 | 业务摘要哈希相同；运行日志单独 +1 条；链接数不变（比的是摘要，不是行数） |
| 同身份不同内容、跨格式 | 保留新版本、旧版本重放为 duplicate/`same_as_older_version_not_revived`；JSON 强 ID 与 Markdown 弱身份：同文 duplicate、异文 ambiguous 且不写入 |
| 新增一份/一批 | 增量：新增 1 条观察 → 影响 `[e3]`，重建 1 块复用 2 块，未变块对象 `strictEqual`，diff 仅 `e3` 新增 1 项 |
| 人工更正后再导旧资料 | 更正值仍有效；前值可追溯；自动导入的改动保存为新版本并标 `shadowedByCorrection`；链接更正不被复活，相反角色报冲突 |
| 同日两事件/跨日/其他部位 | 同日 `e2` 不被合并也不自动填充；候选不计确认；错目标类型与悬空目标分别拒绝（按身份判定，非集合大小） |
| 问句/提醒/回忆/转述、未知日期、单位 | 角色→类别保真；未知时间标注；无单位拒绝、单位变化=冲突；说谎的时间基准被拒 |
| 错引用/缺行/损坏 | 整批拒绝、`revision` 不变；验证器抛异常 → `validator_error:*` 失败，不计通过 |
| 并发与中断 | 8 个并发导入 + 3 个并发更正（子进程）：revision 恰 +11、无丢失更新、共享身份仅 1 版本、3 条更正全在且前值链串行；注入「rename 前崩溃」→ 账本不变，重试成功；遗留 temp+陈旧锁被回收（**模拟遗留物，不是真 SIGKILL**） |
| 与既有故事共用来源 | 本路径不 import `lib/db`、不调用 `persistCareEpisode/getStore`（结构性断言）；未接入意味着故事关联/媒体本批无从被改，**桥接后的保护未验证** |

## 4. 私有基线文件级 dry-run（`C:\Users\teddy\NianlifeOps\health-tracking\2026-09-21\health-02-a\`）

命令：`node --import tsx scripts/health-import/baseline-dryrun.mjs --r4 …\run-20260920-r4-fix2 --r2 …\run-20260920-r2 --out …\health-02-a`
输入为 R4-fix2（微信事实/病程）+ R2（医院规范事实、就诊、来源清单、汇总稿转述）；六个输入文件运行前后 SHA-256 一致（`inputsUnchanged: true`）；接受的第一批目录只读，未改。

- 首次导入到空账本：source 769（含仅被引用的 stub）、encounter 15、canonical_fact 198、observation 689（666 微信事实 + 23 转述层）、episode 10；拒绝 0。
- 与已接受基线核对：确认关联 164（预期 164）、候选 24（预期 24），逐病程一致（如 53/7、5/0、17/1…）；未挂靠观察 501 = 666−164−24+23 转述，与「未挂靠不等于无关」一致，时间轴单列。
- 立即重放：全部 duplicate，新增 0，业务摘要不变。
- 增量演练（先导入前 95% 微信事实，再导全量）：新增 67 项、61 条链接（微信批 36 + 病程批 25）；时间轴 diff 仅 2 个病程块变化（另 8 块复用且内容未变），diff 明细在 `timeline-diff-incremental.json`；最终摘要等于一次性全量导入摘要。
- 病程状态：9 个 `end_unknown`，1 个 `ended`（无「进行中」断言）。
- 适配器跳过：1 个非患者就诊、5 条无就诊号的规范事实（源文件本身无 `encounter_id`）—已列入报告，未硬挂。
- 真实数据暴露过一处校验缺口：R4 含 `approx` 精度（2 条「刚…」类近似发生时间），首次导入被整批拒绝、零写入（这正是「清楚失败」的实例）；已把 `approx` 加入允许精度并复跑。
- 产物：`ledger-full/`、`ledger-incremental/`（仅文件账本，不是业务库）、`timeline.{json,md,html}`、`timeline-diff-incremental.json`、`dryrun-report.json`。

## 5. 可复跑命令

```
cd v2
node --import tsx --test --test-concurrency=1 test/health-ledger.test.mjs test/health-concurrency.test.mjs
node --import tsx scripts/health-import/cli.mjs import --ledger <仓库外目录> --adapter messages-jsonl --input <file>          # dry-run
node --import tsx scripts/health-import/cli.mjs import --ledger <仓库外目录> --adapter messages-jsonl --input <file> --apply
node --import tsx scripts/health-import/cli.mjs correct --ledger <目录> --file correction.json [--apply]
node --import tsx scripts/health-import/cli.mjs timeline --ledger <目录> --as-of 2026-09-21 --out <目录>
```

## 6. 迁移与恢复方案

- 应用回滚：V2 无任何代码读取健康账本 → 回滚应用不需要数据动作。
- 数据恢复：文件账本 = 一个 `ledger.json`；每次事务前先复制即可回退；SQL 形态见 `drizzle-health/0001_health_ledger.sql` 头部（`DROP` 仅限无已审数据的库；否则用迁移前 `pg_dump`，回滚镜像不等于恢复数据）。
- 失败恢复：导入失败/崩溃不改账本；重试即幂等重放。

## 7. 检查

`npm run lint` 0 错；`npm run typecheck` 通过；`npm test` 全仓 1525 项：通过 1514、失败 0、跳过 11（原有跳过）；`npm run build`（`DATABASE_URL=` `REPOSITORY_BACKEND=json`，未连库）通过。

## 8. 未验证 / 已知限制

1. **真实 Postgres 的事务与并发未验证**：本机无 psql/docker/pglite，也不得用现有连接。SQL 迁移只编写未执行；并发结论只对文件账本 + 跨进程锁成立，不外推。
2. 未实现 Postgres 仓库实现与与 `raw_sources` 的桥接；桥接后「故事/媒体不被改动」需届时再验。
3. 增量 Markdown 适配器的行格式是按合成样例假设的，**未对照真实 WeFlow 切片**；真实文件若格式不同，会得到 0 条（不会误导入）。
4. 版本顺序取到达序；带外修订时间未建模。链接只增，不自动撤销；撤销靠人工链接更正。
5. R2 的 10 条人工更正已折叠进规范事实取值，本批未把它们还原为账本更正记录（前值不在这些文件里）。
6. 汇总稿转述层未挂到具体病程（源文件只有话题级关联）；「分析」层只有机制与测试，未导入任何真实分析。
7. 24 条候选是否属于该段，资料仍回答不了，仍为候选。
8. 时间轴 HTML 为极简审阅页，不是产品页面（HEALTH-03/04 范围）；未改首页/UI。

## 9. 边界

未连生产、未写业务库、未迁移、未部署、无外部模型调用；真实健康原文与私有产物不入 Git；`.env*`、`persistCareEpisode`、既有故事与媒体代码未改动；其他会话的未提交改动未纳入本批。

## 10. 提交

ACK 基线 `cae393d`；代码与测试交付 `3b144bb`（已 push main）；本回执随后由一个仅改文档的提交补记此 SHA。状态：已提交审核，等待 Codex；未进入 HEALTH-03/04，未部署。
