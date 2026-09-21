# HEALTH-02-R1 复审与定点补正卡

日期：2026-09-21。审核 `0b37591`，回执 `cc74e69`（远端一致）。结论：**多数修复通过，剩余三组工程衔接问题需定点补正；HEALTH-02 尚未关闭。** 不进入 HEALTH-03/04，不重开已通过的 HEALTH-01。

本卡待 Teddy 转交原 Claude 会话，未收到补正 ACK。不是要求再做六类全量返工。

## 本轮独立验证与保留项

- 独立运行 `node --import tsx --test --test-concurrency=1 test/health-ledger.test.mjs test/health-concurrency.test.mjs test/health-r1.test.mjs`：**42/42 通过**，包括活进程超时不抢锁、实际 SIGKILL 恢复、多等待者、所有权丢失阻止提交及路径边界。
- 独立反例确认上一轮同批异内容拒绝、更正 ID 换目标拒绝、明显非法日期拒绝、观察更正使病程分析 stale、医院事实影响病程、仓库根路径拒绝均生效。
- 私有账本只读核验：203 条规范事实均在时间轴中有对应项；489 条未挂靠观察、10 条历史更正；九个输入当前哈希均匹配回执；重新生成的时间轴与交付 timeline.json 内容一致，账本当前不变量无报错。
- 本轮未重跑完整私有生成器、未重新 OCR 或阅读全部历史；未重跑全仓 lint/typecheck/test/build，其结果仍采用执行方报告，不称为独立复跑。没有业务代码修改、数据库访问或部署。
- 独立脚本和结果：`C:\Users\teddy\NianlifeOps\health-tracking\2026-09-21\codex-review-health02-r1\probes.mjs`、`results.json`。不覆盖旧审核或执行目录。

锁、完整记录保留、真实 Markdown 格式复用、输出路径边界等已通过内容保持有效。Postgres、生产桥接、全会话抽验、断电持久性和 PID 复用按回执保留限制，不为此扩大本轮工作。

## 仅补正以下三组

### 1. 来源版本、更正与依赖传播（P1）

位置：`v2/lib/health/graph.ts` 的 closureHash，`ledger.ts` 的链接身份/版本绑定，`timeline.ts` 的来源视图。

独立复现：

- 观察仍绑定 source v1；source 从 v2 再更新至 v3，缓存时间轴复用全部三块，但全量结果中的 currentVersion 已改变，二者不相等。closureHash 仅记录“是否有新版本”布尔值，v2/v3 无法区分。
- source.text 人工更正已成为 effectiveContent 当前值；trace 仍只读原始版本，依赖病程分析仍 current。当前 hash 把来源节点替换为常量 `src`，边只哈希原始 ver.content，遗漏人工更正。直接引用 source 的分析也应纳入同一验收。
- 同批导入 source v2 和据此更新的 observation v2，已有 `from_source` 链接按三元组判 duplicate，最新事实仍只绑定 source v1。不能通过“固定旧来源”实现所有新事实版本永久引用第一版。

要求：保留历史来源及原始绑定，不自动用新原文替代旧证据；同时使更正、连续新版本和需复核状态准确参与依赖失效及展示。对新事实版本建立明确且可审核的新证据绑定，旧事实版本仍能回溯原绑定；输入未明确所依据版本时报告待核，不猜。不能直接覆盖全局 link.toVersion 导致历史证据漂移。检验 v1→v2→v3、来源人工更正、事实版本与来源版本一起变化、直接/间接分析失效、缓存与全量全内容相等。

### 2. 弱身份升级后的引用与歧义（P1）

位置：`v2/lib/health/ledger.ts` 的 sameText/weakSame、rekey 和别名解析。

独立复现：先导入一条弱身份消息，再一次导入两条同会话/时间/发送人/正文但强 ID 不同的消息，两条都试图收养同一个弱实体，第二次 rekey 抛 `Cannot read properties of undefined (reading 'aliases')`。反向顺序会通过 `find` 任意选一个强身份，无明确多候选判定。另在弱实体被升级后，用已留存的旧弱 ID 发合法更正，会报目标不存在；保存别名但读取/更正接口未统一解析。

要求：多个强身份符合一个弱记录时不能取第一条或重复搬走实体；保留两条强消息及弱记录的待决映射，或明确拒绝整批零写入，不以内部异常替代可审核决定。覆盖 JSON/MD 顺序互换、相同正文重复发送/媒体占位、多候选、跨批和同批。所有引用、trace、分析和更正入口使用同一身份解析；旧有效 ID 仍可查、可更正或明确返回重定向。已接受的更正重试仍幂等，旧审计快照不得被静默改写而丢原身份。影响面须含身份升级前已有依赖。

### 3. 结构化医学字段的有效值、展示和校验（P1；日期完整解析为 P2）

位置：`v2/lib/health/timeline.ts` 的 FactView/View.fact，`ledger.ts` 的 CONTENT_VALIDATORS/unitChanged/isValidTimeString。

独立复现：规范处方携带 structured.dose 和频次，但时间轴 JSON/Markdown 都不含这些结构化字段。人工更正 structured.dose.value 后，账本值已改变，展示事实完全不变、diff.changedBlocks 为 0。真实规范数据中 23 条处方和 138 条检验含 structured；当前 value 文本往往包含旧读数/用法，结构化更正不能继续展示旧文本作为当前结论。

另药物 dose={value:3} 缺单位仍可导入；现有验证只覆盖 measure。时间校验正则无结尾锚，`2030-05-01NOT_A_TIME` 被接受。这些仍属上轮“更正不能绕过单位/时间校验”范围。

要求：明确原始 value 文本与有效结构化字段的关系；保留原始文本，当前展示与差异报告必须显示更正后的药物剂量/规格/频次/途径、检验值/单位/参考范围等实际已存字段及更正追踪，不静默让旧文本继续充当有效值。检查 import 与 correction 对实际支持的 dose/structured 等结构一致，单位变化不能绕过冲突处理；原文没有的信息可明确未知，不编造剂量或做医学换算。完整解析支持的日期、时区和精度，拒绝尾随垃圾；允许已有合法近似日期/区间的约定，不靠放宽正则吞错。

## 补正交付边界

1. 先 ACK 实际 main 基线、路径和 ETA；沿用上一卡允许路径，仅修以上三组与必要回归。不得调整其他会话文件，不建分支。
2. 新增合成用例验证上述组合行为；已有通过测试复用其语义，不用硬编码探针文字。修改共用模块后复跑 42 项及新增项、必要项目检查；按仓库规则完成 lint/typecheck/全仓测试/build。
3. 私有新输出 `C:\Users\teddy\NianlifeOps\health-tracking\2026-09-21\health-02-r1-fix\`；旧执行和审核目录只读。核对输入哈希、记录与关联守恒，以及修正后的结构化字段展示和全量/缓存一致性；不重新扩大历史采集。
4. 脱敏回执 `docs/health-tracking-batch-02-r1-fix-report-2026-09-21.md`，逐项记录反例→修复证据与未验证限制。精确提交并 push main，不连接现有库、不部署、不调用外部模型。
5. 状态为“已提交审核，等待 Codex”；本卡不要求新建会话或自动派发，不自行进入 HEALTH-03/04。
