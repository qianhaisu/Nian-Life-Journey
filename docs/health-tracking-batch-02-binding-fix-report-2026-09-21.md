# HEALTH-02 来源绑定收尾回执

状态：**已提交审核，等待 Codex**。ACK 基线 main `b79e649`（已取消本机 Postgres 的最新卡）。仅做卡内两项来源绑定收尾；已通过的 52 项与第一批结果保留。**本轮没有下载/安装/启动 PostgreSQL，没有 PG 存储实现、SQL 迁移执行或真实库测试，也未改用 RDS**（原 B 阶段未开始，无任务进程需要停止）。
脱敏：真实资料只以计数出现；私有产物 `C:\Users\teddy\NianlifeOps\health-tracking\2026-09-21\health-02-binding-fix\`。

## 1. 旧事实版本不得展示后来新增的来源

反例（`binding-probes.mjs`）：o1 v1 只有 s1；导入 o1 v2 新增 s2 → v1 的追溯里出现 s2 与后来的正文。
- 根因：历史视图对所有当前有效链接生成来源，`bindingAt(...)===null` 时回退到最新来源版本。
- 修复（`timeline.ts` `sourceRefs`）：**一个关系只适用于「有绑定且绑定在该事实版本或更早创建」的版本**；无绑定不再回退最新证据（只有完全没有绑定记录的旧账本链接才按原行为兜底）。
- 当前关系 vs 历史审计分开：历史版本按**声明时的关系**展示，之后的撤销/更正只作标注（`withdrawnSince`、`currentRole`），**不向后抹除**；最新版本才用有效关系（撤销后不再显示）。审计行从不删除。
- 证据（`v2/test/health-binding.test.mjs` H1/H2）：v1 只含 s1 且不含后来正文；s2 之后再更新两次，v1 追溯字节不变，v2 仍绑 s2@v1 且正文为当时的；撤销 s2 后 v1、v2 仍显示它（标注 `withdrawnSince: rm`），v3 不再显示；链接行数不变。
- 复跑审核探针：`historicalSources` v1 = `[s1]`，v2 = `[s1, s2@bound1]`。

## 2. 待复核绑定持久、可明确确认

反例：新事实版本未说明来源版本 → 首次 `needsReview`，原样重放却变 false；相同正文补交 `toVersion=2` 被判 duplicate，绑定仍为 v1。
- **持久待决**：新增追加式 `bindingEvents`（业务内容，进入摘要）。新事实版本未说明依据版本时沿用旧绑定并记录一条 `pending` 事件（前绑定、来源当前版本、时间、运行）；**重放同一输入仍报告 `unconfirmed`（`source_binding_pending_confirmation`）且不重复记事件**；`buildTimeline` 输出 `pendingBindings`，Markdown 有「待确认的来源绑定」段，条目上标「依据版本待确认」。
- **明确确认，不改正文**：对**同一事实版本**重发链接并带 `toVersion` + `confirmation{by, reason}`（导入通路的 `links`，或新增 CLI `confirm-binding`，默认 dry-run）：追加绑定 `{from:当前事实版本, to:所述来源版本, event}` 并记 `confirmed` 事件（确认人、理由、时间、before→after）；事实版本数不变。缺 `by/reason` 拒绝；越界版本拒绝。
- **幂等与冲突**：相同确认重试 → 无变化、摘要不变；已确定的版本再被给出**不同**来源版本 → `conflict`（`binding_for_this_version_already_established`，`needsReview`，不覆盖）；没有待决时也不能对已绑版本悄悄改绑。
- **历史保持**：旧版本绑定原样保留（如 `[1→1, 2→2(event)]`），追溯按版本显示各自绑定与 `confirmedBy`。确认会改变闭包哈希，依赖的分析被标 stale，缓存时间轴仍等于全量重建。
- 证据：H3（持久/重放/时间轴）、H4（相同正文确认、审计事件、幂等、分析 stale、缓存==全量）、H5（信息不全、冲突、确认到旧版本、不悄悄改绑）、H6（CLI dry-run/apply/幂等/拒绝）。
- 复跑审核探针（补上确认人/理由后）：`firstNeedsReview:true`、`replayNeedsReview:true`、确认动作 `confirm`、绑定 `[1→1, 2→2]`。**注意**：探针原来只给 `toVersion` 而没有确认人/理由，按本卡「确认要留确认人、时间、理由」现在会被拒绝（`confirmation_requires_by_and_reason`），这是有意行为。

## 私有文件级核对（`health-02-binding-fix\`，仅文件账本）
命令：`node --import tsx scripts/health-import/baseline-dryrun.mjs --r4 …\run-20260920-r4-fix2 --r2 …\run-20260920-r2 --out …\health-02-binding-fix --export-md <一份真实 WeFlow md>`。
- 九个输入运行前后 SHA-256 一致；health-02-a/r1/r1-fix 与审核目录只读未改。
- 守恒：source 769、encounter 15、canonical_fact 203、observation 689、episode 10；确认关联 164、候选 24、handoff 病程链接 15、历史更正 10、未挂靠观察 489；重放业务摘要不变；增量演练缓存==全量、最终摘要==一次性全量；结构化探针（上一轮）保持通过。
- 绑定探针（`ledger-probe` 临时账本，真实结构上的合成修订）：给一条观察新版本追加额外来源 → 旧版本仍只有原来 1 个来源、当前版本含额外来源；来源修订后新版本未说明版本 → 待决已记录，重放仍 `needsReview`；确认后事实版本数不变、绑定为 `[1,1,2]`、待决清零。

## 检查与复跑命令
- `cd v2 && node --import tsx --test --test-concurrency=1 test/health-binding.test.mjs test/health-r1-fix.test.mjs test/health-r1.test.mjs test/health-ledger.test.mjs test/health-concurrency.test.mjs`
- `npm run lint` 0 错；`npm run typecheck` 通过；`npm test` 全仓 1565 项：通过 1554、失败 0、跳过 11（原有）；`npm run build`（`DATABASE_URL=` `REPOSITORY_BACKEND=json`，未连库）通过。`health-*` 共 58 项（新增 6 项，原 52 项保持通过）。
- 同步更新的文件账本读取兼容：旧账本无 `bindingEvents` 时按空处理。SQL 草案增加 `health_binding_events` 表结构，**仍只写未执行**。

## 限制 / 未验证
1. **真实 Postgres/RDS 事务与并发未验证**（本轮按指令取消，登记为后续数据库接入前的必验项）；并发结论仍只限文件账本。不宣称数据库通路已验证。
2. 未做生产桥接；接入后既有故事/媒体保护未验证。
3. 确认只支持「事实版本 → 来源版本」；没有做多人审批流或撤销确认（确认后要改需新增事实版本）。
4. 弱记录多候选的「人工裁定谁对应」写入接口仍未提供（沿用上轮限制）。
5. 断电持久性、崩溃后 PID 复用、全会话导入抽验沿用既有限制。

## 边界
未连业务库/RDS、未部署、无外部模型调用；真实原文与私有产物不入 Git；未改 `.env*`、`persistCareEpisode`、既有故事/媒体代码；其他会话未提交改动未纳入。

## 提交
代码与测试交付 SHA 见文末补记。
