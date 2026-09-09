# HANDOFF-A（Code A，直连 Codex，≤80 行）

**更新**：2026-09-09 · 本 session（Phase 4：备份 A 已恢复到 RDS `nianlife`，对账全部通过）

## 任务 ID 状态
- A-12-1 / A-12-2：已完成，`a04d8d2`，已在 `main`，已 push。
- MIG-A-001（离线核对 Phase 2 备份产物/进度/阻塞）：已完成，见 `docs/STATUS.md` 2026-09-07 条目。
- OPS-A-001（调度状态 + HANDOFF-A 同步）：已完成，见下方「调度」。
- MIG-A-002（生产备份受控失败分析）：已完成，见 `docs/STATUS.md` 2026-09-07 条目。
- **MIG-A-Phase2（Teddy 直接授权路线 B，directory 格式 + jobs=4 生产备份）：本轮完成，四条客观退出
  条件全部满足，详见 `docs/STATUS.md` 2026-09-08 条目。** 两份 10,305,188 bytes 备份 + schema-only
  已在 `E:\NianlifeBackups\2026-09-08\` 和 `C:\Users\teddy\nianlife-backups\final\2026-09-08\`，
  SHA-256 61 项全部 match；两份都已恢复验证（19/19 表、104,347/104,347 行，与源库完全一致）。

### 2026-09-09 总审纠正 + Runbook 文档修正（历史，详见 `docs/STATUS.md` 对应日期条目）
- 总审撤回了「与源库完全一致」及「Phase 2 完整 final_pass」的早期结论，改记为「核心备份/恢复
  成功，完整一致性验收 partial / changes_requested」（序列/扩展/timezone/collation 当时未逐项
  对账）；无需重跑备份，明文双副本口径差异待总指挥确认。
- `docs/RUNBOOK-RDS-RESTORE.md` v1→v2 按 Teddy 反馈修正过严/掩盖问题的步骤（locale 硬编码、
  `pg_restore \| tee` 掩盖退出码、`n_live_tup` 单一依据、`DROP DATABASE` 移出默认回滚等）；
  v2→v3 填入控制台截图确认的 RDS 目标环境信息。

### 2026-09-09 Phase 4 恢复执行（第二轮）：locale 判断已过，卡在真实凭据/执行位置
- 完成 Teddy 要求的最小 locale 兼容性判断：schema 唯一约束全部建在 hash/ID/复合业务键上，
  全仓库无 `ILIKE`/`COLLATE`/`LOWER()`/`UPPER()`，仅两处 `ORDER BY` 且 id 只是并发 tie-breaker；
  `C`/`C.UTF-8`/`en_US.utf8` 均为确定性 collation，等值比较不受影响。**结论：源库 `C.UTF-8` 与
  目标库 `Collate=C`/`Ctype=en_US.utf8` 技术兼容，不阻塞，不需要重建目标库。** 已写回
  `docs/RUNBOOK-RDS-RESTORE.md`（v3→v4），同时把示例命令从单文件 `-Fc` 纠正为目录格式
  `pg_restore --format=directory`（备份 A/B 实际就是目录）。
- **仍完全未连接 RDS**——真实缺口是执行位置和凭据，不是 locale：本机（家庭网络）DNS 能解析到
  RDS 内网 IP `172.24.16.96` 但 TCP 5432 直连超时，确认不在 `172.16.0.0/12` VPC 内，必须经已有
  ECS 跳转；`Downloads\nianlife-prod-ecs.pem` 存在但按隐私边界从未记录其主机/IP；RDS 数据库账号
  密码在 `.env.local`/环境变量/`~/.aliyun` 均未找到。已在 Runbook 第 4 节写明约定的环境变量名
  （`RDS_PGHOST`/`RDS_PGUSER`/`RDS_PGPASSWORD`/…或 `RDS_DATABASE_URL`；ECS 用
  `NIANLIFE_ECS_HOST`/`NIANLIFE_ECS_SSH_USER`），未搜索历史聊天或其他无关目录。
- 未重试、未清空、未改白名单/安全组/DNS、未动备份 B、未对任何库做写操作。详见
  `docs/STATUS.md` 2026-09-09「Phase 4 恢复（续）」条目。

### 2026-09-09 Phase 4 恢复执行（第三轮）：备份 A 已恢复到 RDS，对账全部通过
- Teddy 在 `nianlife-rds.env` 填好凭据后：SSH 登录 ECS 验证成功，实测 ECS 私网地址与 RDS 同一
  /24 网段（不只是落在白名单网段），ECS→RDS 5432 TCP 直连成功。ECS 无 PostgreSQL 客户端，改用
  SSH 本地端口转发把 ECS 当跳板，本机已验证的 `pg_restore`/`psql` 18.6 经隧道直连 RDS 执行，
  未在生产 ECS 上装软件包、未把家庭数据第二次落到 ECS 磁盘，恢复完成后隧道已关闭。公网/私网
  IP 均按既有隐私边界不记录进仓库。
- 目标只读预检：`nianlife` 库确认为空（`public` 下 0 张表）、`datcollate=C`/`datctype=en_US.utf8`
  与已知一致、PG 18.4（满足 ≥18 门禁）——未触发任何停止条件。
- 备份 A（`full-backup-1`）30 个文件 SHA-256 复核 30/30 与 Phase 2 清单一致。
  `pg_restore --format=directory --no-owner --no-privileges --exit-on-error`，**退出码 0**，
  日志无 error/warning。
- 对账全部通过：19 张业务表精确行数与源库一致、序列 `last_value=13` 一致、扩展仅 `plpgsql`
  一致、表数量 19 一致；`timezone` 目标 `Asia/Shanghai` vs 源 `GMT`（会话级显示设置，
  `timestamptz` 落盘按 UTC 存，非数据差异，已记录非阻塞）；只读冒烟（仅日期字段）651 行/时间
  范围吻合。
- 未做：未 `DROP`、未改白名单/安全组/DNS、未公开流量、未启用 worker、未动备份 B、未打印任何
  密码/连接串。详见 `docs/STATUS.md` 2026-09-09「Phase 4 恢复：目标库恢复完成」条目。
  `nianlife-rds.env` 凭据仍留原处，需要作废请 Teddy 自行处理。

## 调度
- `CronCreate` Job ID `acf5497f`，`*/5 * * * *`，本 session 生效，7 天后自动过期。
- 会话/设备不可用即失效；压缩或重启后需重新确认 `CronList` 是否还有该 Job，没有则重建。
- 首次自然触发写一次 scheduled PONG 到 `docs/STATUS.md`，之后无新任务不再写心跳。

## MIG-A-001 / MIG-A-002 结论摘要（历史，详见 `docs/STATUS.md` 2026-09-07 条目）
- MIG-A-001：早期 Downloads/E 盘目录均无真正备份文件；发现 `nianlife-prod-ecs.pem` 存在于
  Downloads，未读取内容。
- MIG-A-002：串行 `pg_dump` 单连接带宽受限（≈2.2KB/s），推动转向 directory 格式 + jobs 并行
  路线（后由 MIG-A-Phase2 完成）；`NIANLIFE-RUN-FULL.bat` 有两处已知 bug 标记不可用，最小修复
  方向已写入 STATUS.md 未实施。

## 占用
- 本轮无仓库写占用冲突；`docs/STATUS.md`/`docs/STATUS-C.md`/`v2/package-lock.json` 的既有未提交改动非本 session 产生，未触碰，仅在 STATUS.md 追加新条目。

## 消息游标
- 已读 `docs/DIRECT-COORDINATION.md`（全文）、`docs/ORCHESTRATOR-INBOX.md`（顶部 CMD-20260907-006 起至 OPS-A-001/MIG-A-001 两张卡）。
- 未读：`docs/ORCHESTRATOR-INBOX.md` 更早的历史存档段落（按协议不需要）。

## 下一件事
Phase 4 备份 A 已恢复到 RDS `nianlife`，对账全部通过（见上方 2026-09-09 第三轮条目）。等 Teddy
确认结果后决定后续（应用连接测试/评估切流时机）。`NIANLIFE-RUN-FULL.bat` 的两处历史 bug 仍未
修（不在本轮范围内）。
