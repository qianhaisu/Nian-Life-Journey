# HEALTH-02-R1 定点补正回执

状态：**已提交审核，等待 Codex**。ACK 基线 main `7fd0631`（R1 复审卡）。只处理卡内三组问题；HEALTH-01 未重开；已通过的锁、路径边界、真实 Markdown 复用、完整记录保留等未改动语义。
脱敏：真实资料只以计数与类别出现；私有产物在 `C:\Users\teddy\NianlifeOps\health-tracking\2026-09-21\health-02-r1-fix\`。

## 1. 来源版本、更正与依赖传播（P1）

| 反例 | 根因 | 修复 | 证据（`v2/test/health-r1-fix.test.mjs`） |
|---|---|---|---|
| source v2→v3，缓存复用旧块而全量结果 currentVersion 已变 | closureHash 只记「是否有新版本」布尔值 | 闭包哈希对来源记录：当前有效状态（版本+内容+更正）、每条证据链接绑定的版本及**该版本内容（含更正）**、来源版本总数 | G1.1：v1/v2/v3 三个块哈希互异；每步缓存==全量；证据仍绑 v1 |
| source.text 人工更正不进 trace/依赖，分析仍 current | 来源节点被常量 `src` 替代；边只哈希原始内容 | 来源节点用有效哈希（直接引用 source 的分析也覆盖）；新增 `contentAtVersion`：某版本内容 + 对该版本或更早版本做的更正 | G1.2：直接、经病程、经观察三种分析全部 stale；trace 显示更正后的绑定版本内容；缓存==全量 |
| 同批 source v2 + 据此更新的 observation v2，链接按三元组判 duplicate，新事实仍绑 v1 | 绑定是链接上的单个 `toVersion`，与事实版本无关 | 绑定改为**追加式** `bindings[{from 事实版本, to 来源版本}]`；某事实版本适用「from≤该版本的最后一条」。同批来源修订 → 自动为新事实版本追加绑定（`links_rebind`）；显式 `toVersion` 按所给版本；越界拒绝 | G1.3：`[[1,1],[2,2]]`，旧版本 trace 仍见 v1 内容、新版本见 v2；G1.4：越界 `binding_version_out_of_range` |
| 未说明依据版本 | — | **不猜**：新事实版本沿用旧绑定，并报告 `links_unconfirmed`（`needsReview`，CLI 退出码 3） | G1.4：绑定未被发明，需审核 |

不做的事：不用全局 `toVersion` 覆盖历史；旧事实版本永远可回溯原绑定。旧账本的单个 `toVersion` 读入时转为首条绑定。

## 2. 弱身份升级后的引用与歧义（P1）

| 反例 | 修复 | 证据 |
|---|---|---|
| 一次导入两条强 ID 同槽同文，均试图收养同一弱实体，第二次 re-key 抛内部异常；反序任意选一 | 强项收养弱实体前先数**候选**：批内新强项数（先行统计，与顺序无关）+ 账本内同槽同文强实体。唯一候选才 re-key；多候选**不收养**，弱记录与所有强消息都保留，并各记一条待决映射（`ambiguities`）。re-key 也加了防护（缺实体/目标已存在明确报错） | G2.1：weak→strong×2、strong×2→weak、同批三者，业务摘要**一致**；弱记录未被搬走；2 条待决映射 |
| 跨批：先收养 S1，后到 S2 | 弱 ID 已是别名时，S2 与持有者建立待决映射并把该别名标为歧义 | G2.2：两条保留；`resolveRef(旧弱 ID)` 明确抛 `identity_ambiguous` 并列出候选 |
| 旧弱 ID 更正报「目标不存在」；别名只保存不解析 | 新增**唯一**解析器 `resolveRef`：更正（字段/链接）、分析、trace、链接声明都经它；旧有效 ID 可查、可更正，并返回 `redirectedFrom` | G2.3 |
| 已接受更正重试的幂等性；审计快照被改写 | 重试可用当前 ID 或任一旧 ID（哈希按各变体比对）；re-key 时移动「活指针」使更正继续生效，同时保留 `refAtRecording` / `linkIdAtRecording` / 分析快照 `originalRef` | G2.3：用旧 ID、新 ID 重试均 `duplicate`；异内容仍拒绝；`refAtRecording` 为原弱 ID |
| 影响面漏掉升级前已有的依赖 | 影响种子同时含旧键与新键 | G2.3：`impact.analyses` 含升级前登记的分析，状态 stale |

## 3. 结构化医学字段、校验与日期（P1；日期 P2）

- **展示**：`FactView` 现含 `structured`（有效值，更正已叠加）、`structuredText`、`displayValue`、`valueTextSuperseded`、`correctionIds`。原始 `value` 文本保留；只要有更正触及 `structured.*`，当前展示为结构化渲染（名称/规格/剂量/频次/途径/数量/备注；值/单位/参考范围/标志），原文**明确标注「已被更正取代，不作当前值」**。未更正的事实同时显示原文与结构化字段。缺失字段显示「未知」，不补猜、不换算。
- **差异**：结构化更正让病程块 `metaChanged`、未挂靠事实进 `unattachedFacts.changed`（G3.1：diff 恰 1 块、缓存==全量）。
- **校验（导入与更正同一套）**：
  - 药物 `dose={value}` 缺单位 → `dose_unit_missing`（观察、规范事实、`structured.dose` 对象均覆盖）；实验室型 `structured` 数值需有 `unit` 键，`null` = 源本身无单位；文字型结果、值为 `null` 的项目头（真实数据里有 2 条）明确允许为未知；源文本剂量（如「每次…」）保持文本，不解析、不换算。
  - 单位变化：`measure/dose/structured.unit/structured.dose.unit` 变化 → `conflict(unit_changed)`；文本剂量/规格/数量里**尾随单位记号**变化也报冲突（仅用于检测，不换算）；同单位改数值 → 正常版本变化。
  - **日期整串解析**：`YYYY`、`YYYY-MM`、`YYYY-MM-DD`、`…[ T]HH:MM[:SS[.fff]]`，可选 `Z`/`±HH:MM`（偏移合理性校验）；尾随文字、月 13、2 月 30、24 时、`+25:00` 全部拒绝；声明精度不得细于取值（`month` 精度需至少月份、`minute` 需含时分；`approx/range` 沿用既有约定）；更正的 `at` 同样整串校验；就诊日期也校验。
- **真实数据暴露的两处约定**（据此改适配器而**没有放宽正则**）：
  1. 病程起始日形如「2026-08-31 前后（范围表达）」：适配器拆为合法日期 + `startQualifier`，并保留原文 `startText`；不以日期开头的文本仍被校验拒绝。
  2. 两条实验室项目头 `value: null`（只有项目名、无结果）：视为明确未知，不报错。
- 证据：G3.1（展示/更正/diff/缓存）、G3.2（导入与更正的 dose/structured 校验、单位冲突）、G3.3（日期）。

## 私有重跑（`health-02-r1-fix\`，仅文件账本，未连库）
命令：`node --import tsx scripts/health-import/baseline-dryrun.mjs --r4 …\run-20260920-r4-fix2 --r2 …\run-20260920-r2 --out …\health-02-r1-fix --export-md <一份真实 WeFlow md>`。
- 九个输入运行前后 SHA-256 一致（`inputsUnchanged: true`）；health-02-a、health-02-r1、审核目录只读未改。
- 守恒：source 769、encounter 15、canonical_fact 203、observation 689、episode 10；确认关联 164/164、候选 24/24、handoff 病程链接 15、历史更正 10；未挂靠规范事实 5、未挂靠观察 489；拒绝 0。
- 重放：全部 duplicate，业务摘要不变；增量演练缓存==全量、最终摘要==一次性全量。
- **结构化字段展示**：输入中带 `structured` 的规范事实 161 条（检验 138、处方 23），时间轴 JSON 全部显示，Markdown 有「结构化：…」；在**临时账本**（`ledger-probe`）对一条处方做 `structured.note` 探针更正：展示为当前结构化值、原文保留并标注取代、diff 恰 1 块、缓存==全量（`dryrun-report.json.structured.probe`）。探针只落在临时账本，未触及输入或其他账本。

## 检查
`npm run lint` 0 错；`npm run typecheck` 通过；`npm test` 全仓 1559 项：通过 1548、失败 0、跳过 11（原有）；`npm run build`（`DATABASE_URL=` `REPOSITORY_BACKEND=json`）通过。`health-*` 共 52 项（新增 10 项 + 原 42 项全部保持通过）。

## 未验证 / 剩余限制
1. 真实 Postgres 事务/并发仍未验证；SQL 草案本轮同步了 `bindings`、`ref_at_recording`、`link_id_at_recording`、歧义别名，仍只写未执行。
2. 未做生产桥接；接入后「既有故事/媒体不被改」保护未验证。
3. 弱→强升级后，依赖该弱身份的闭包哈希会因键名变化而失效（分析变 stale）——这是有意的身份变更信号，不是缺陷，但会产生一次性复核。
4. 弱记录 + 多强消息的「待决映射」目前只报告和保留，没有提供「人工裁定谁对应」的写入接口（不在本卡范围）。
5. 结构化渲染只展示已存字段；对剂量做单位换算或医学判断未做，也不应做。
6. 断电持久性、崩溃后 PID 复用、全会话导入抽验：沿用上轮限制。

## 边界
未连现有业务库、未部署、未调用外部模型；真实原文与私有产物不入 Git；未改 `.env*`、`persistCareEpisode`、既有故事/媒体代码；其他会话未提交改动未纳入。

## 提交
代码与测试交付 SHA 见文末补记。
