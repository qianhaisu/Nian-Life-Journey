# HANDOFF-A（Code A，直连 Codex，≤80 行）

**更新**：2026-09-09 · 本 session（Phase 4：94 秒根因定位完成——隧道带宽是主因，已给最小修复方案）

## 任务 ID 状态
- A-12-1 / A-12-2：已完成，`a04d8d2`，已在 `main`，已 push。
- MIG-A-001（离线核对 Phase 2 备份产物/进度/阻塞）：已完成，见 `docs/STATUS.md` 2026-09-07 条目。
- OPS-A-001（调度状态 + HANDOFF-A 同步）：已完成，见下方「调度」。
- MIG-A-002（生产备份受控失败分析）：已完成，见 `docs/STATUS.md` 2026-09-07 条目。
- **MIG-A-Phase2（Teddy 直接授权路线 B，directory 格式 + jobs=4 生产备份）：本轮完成，四条客观退出
  条件全部满足，详见 `docs/STATUS.md` 2026-09-08 条目。** 两份 10,305,188 bytes 备份 + schema-only
  已在 `E:\NianlifeBackups\2026-09-08\` 和 `C:\Users\teddy\nianlife-backups\final\2026-09-08\`，
  SHA-256 61 项全部 match；两份都已恢复验证（19/19 表、104,347/104,347 行，与源库完全一致）。

### 2026-09-09 Phase 4 历史（第一〜三轮，详见 `docs/STATUS.md` 对应日期条目，不复述）
- 总审撤回早期「与源库完全一致」结论，改记 partial/changes_requested；Runbook v1→v4 按 Teddy
  反馈逐步修正（locale 硬编码、`pg_restore \| tee` 掩盖退出码、目录格式命令、locale 名称不同
  不自动等于不兼容的最小判断方法）；第二轮完成 locale 兼容性判断（结论：源库 `C.UTF-8` 与目标
  `Collate=C`/`Ctype=en_US.utf8` 技术兼容），仍卡在 RDS 凭据/ECS 执行位置未连接。

### 2026-09-09 Phase 4（第三/四轮，历史，详见 `docs/STATUS.md` 对应条目）
- 第三轮：备份 A 经 SSH 隧道（ECS 跳板）用 `pg_restore --format=directory --no-owner
  --no-privileges --exit-on-error` 恢复到 RDS，退出码 0；19 表精确行数/序列/扩展全部对账通过；
  `nianlife-rds.env` 凭据仍留原处。
- 第四轮：用应用真实 `@/lib/family-archive`/`@/lib/db/repository` 代码（独立进程、只设该进程
  env，未改 `.env.local`）验证首页/月页/事件详情读取全部成功；权限/迁移/索引/约束核对通过；
  发现 `loadFamilyArchive()` 耗时 94,252 ms（远超 ≤3 秒验收线）；日期边界/时区行为核实安全。

### 2026-09-09 Phase 4（第五轮）：94 秒根因定位——隧道带宽是主因，唯一推荐最小修复已给出
- 有界诊断（每条查询 `statement_timeout`/`query_timeout`，单条超时即停不重试）：RDS 服务端
  `EXPLAIN ANALYZE` 5 张最重表全部 <25 ms，**服务端查询本身极快，不是瓶颈**。四个独立测量
  （合成带宽探针 + 3 个真实表的独立拉取）互相印证：本次隧道路径传输带宽约 **0.5–0.6 MB/s**；
  `loadFamilyArchive()` 一次并发请求总负载约 **54.6 MB**，按测得带宽反推预期总耗时 ≈99 秒，与
  原始 94.25 秒高度吻合——这就是 94 秒的算术解释。
- 代码里确认存在真实、可安全消除的重复查询：`content_quality_reviews` 一次调用里被整表拉 **3
  次**（`assembleStore()` Promise.all 一次 + 自己第 456 行串行再拉一次 + `getAllEvents()` 再拉
  一次），`life_events` 拉 **2 次**——合计约 2 MB 纯浪费，源码位置已列清楚。
- **唯一推荐最小修复**（未改代码，只给方案）：`v2/lib/db/postgres-repository.ts`
  `assembleStore()` 约第 456 行，把 `const reviews = await reviewIndex();` 换成直接复用同函数
  已拉到的 `qualityReviewRows`（`indexReviews(qualityReviewRows...)`）——同一张表同一条 SQL，
  改动前后 `reviews`/`store.qualityReviews`/`events`/`dailyTraces` 逐字节相同，只省一次网络
  往返+0.48MB。**明确标注：这个修复省不到 94 秒→≤3 秒**，真正主因是隧道带宽，需要 ECS 同 VPC
  内实测才能验证生产真实数字（本轮未装数据库客户端到 ECS，按指令未做，标为「尚未证实/推测」）。
- 详见 `docs/STATUS.md` 2026-09-09「loadFamilyArchive() 94 秒根因定位」条目（完整诊断表格、
  验证方法、跨函数去重为何本轮不做）。

## 调度（历史失效，2026-09-09 起不恢复）
- `CronCreate` Job ID `acf5497f`（`*/5 * * * *`）是旧三轨 Cowork 派单协作模式下的心跳调度；
  `docs/DIRECT-COORDINATION.md` 已确认改为直接对接，不再经 Cowork 派单。**本条已作废，不续期、
  不重建、不再要求"每次唤醒先查 CronList"。**

## MIG-A-001 / MIG-A-002 结论摘要（历史，详见 `docs/STATUS.md` 2026-09-07 条目）
- MIG-A-001：早期 Downloads/E 盘目录均无真正备份文件；发现 `nianlife-prod-ecs.pem` 存在。
- MIG-A-002：串行 `pg_dump` 单连接带宽受限，推动转向 directory 格式 + jobs 并行路线（后由
  MIG-A-Phase2 完成）；`NIANLIFE-RUN-FULL.bat` 有两处已知 bug 标记不可用，未实施修复。

## 占用
- 本轮无仓库写占用冲突；`docs/STATUS.md`/`docs/STATUS-C.md`/`v2/package-lock.json` 的既有未提交改动非本 session 产生，未触碰，仅在 STATUS.md 追加新条目。

## 消息游标
- 已读 `docs/DIRECT-COORDINATION.md`（全文）、`docs/ORCHESTRATOR-INBOX.md`（顶部 CMD-20260907-006 起至 OPS-A-001/MIG-A-001 两张卡）。
- 未读：`docs/ORCHESTRATOR-INBOX.md` 更早的历史存档段落（按协议不需要）。

## 下一件事
**数据库恢复完成，应用真实读取路径验证通过，94 秒根因已定位并给出最小修复方案**（见上方
第三/四/五轮条目）。**尚未完成**：把第五轮的一行修复实际改进代码并按给定方法验证（本轮按指令
未改代码）；ECS 同 VPC 内实测 `loadFamilyArchive()` 真实耗时（未装数据库客户端，未做）；OSS
媒体迁移（完全未涉及）；ECS Web 部署切流（配置草案未跑过）。`NIANLIFE-RUN-FULL.bat` 两处历史
bug 仍未修（不在本轮范围内）。
