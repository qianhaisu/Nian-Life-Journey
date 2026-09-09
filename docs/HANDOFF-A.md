# HANDOFF-A（Code A，直连 Codex，≤80 行）

**更新**：2026-09-09 · 本 session（Phase 4：locale 判断已过，仍卡在 RDS 凭据/ECS 执行位置）

## 任务 ID 状态
- A-12-1 / A-12-2：已完成，`a04d8d2`，已在 `main`，已 push。
- MIG-A-001（离线核对 Phase 2 备份产物/进度/阻塞）：已完成，见 `docs/STATUS.md` 2026-09-07 条目。
- OPS-A-001（调度状态 + HANDOFF-A 同步）：已完成，见下方「调度」。
- MIG-A-002（生产备份受控失败分析）：已完成，见 `docs/STATUS.md` 2026-09-07 条目。
- **MIG-A-Phase2（Teddy 直接授权路线 B，directory 格式 + jobs=4 生产备份）：本轮完成，四条客观退出
  条件全部满足，详见 `docs/STATUS.md` 2026-09-08 条目。** 两份 10,305,188 bytes 备份 + schema-only
  已在 `E:\NianlifeBackups\2026-09-08\` 和 `C:\Users\teddy\nianlife-backups\final\2026-09-08\`，
  SHA-256 61 项全部 match；两份都已恢复验证（19/19 表、104,347/104,347 行，与源库完全一致）。

### 2026-09-09 总审纠正（追加，不改写上述历史回报）
- 离线复核确认：`step13.status=FAIL`、`step14.status=DONE`；step13 的两份备份、schema-only、
  双位置复制和 SHA-256 阶段已成功，随后因本地验证库创建失败退出；step14 后续完成两份本地恢复。
- 已独立核实：两处各 61 个文件且 0 哈希差异；两份备份各 30 个文件、10,305,188 bytes，
  schema-only 37,758 bytes；两次 restore exit 0；源基线及两份恢复的逐表清单均为 19 表、
  104,347 行，三份逐表清单完全一致。
- 未确认：序列、扩展版本、timezone/collation、脱敏字段摘要。撤回“与源库完全一致”及
  “Phase 2 完整 final_pass”；当前应记为“核心备份/恢复成功，完整一致性验收 partial / changes_requested”。
- 无需重跑备份或连接生产。明文双副本事实保留；原批准方案的加密归档要求与后续四条件允许明文
  副本的口径差异，待总指挥确认。RDS 采购和目标写入仍需 Teddy 明确批准。

### 2026-09-09 RDS 恢复 Runbook 文档修正
- `docs/RUNBOOK-RDS-RESTORE.md` 已按 Teddy 反馈修正为 v2：Phase 2 状态改为 partial /
  changes_requested；PG18 以下目标版本默认停止（需单独兼容性验证+批准）；`pg_restore` 退出码
  检查修正（不再用 `| tee` 掩盖）；验收禁止只用 `n_live_tup`；locale 改为执行前查源库实际值，
  不硬编码 `en_US.UTF-8`；`DROP DATABASE` 改为需单独批准，移出默认回滚；Neon egress 取不到记
  「未确认」，不为此新增监控/API Key；ECS→RDS 明确内网优先。纯文档任务，未连接任何数据库。
  详见 `docs/STATUS.md` 2026-09-09 条目。

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
- 下一件事：Teddy 通过上述环境变量或仓库外文件提供 RDS 账号凭据 + ECS 主机/登录信息后，直接
  从 Runbook「执行顺序」第 1 步继续，无需重新做 locale 判断。

## 调度
- `CronCreate` Job ID `acf5497f`，`*/5 * * * *`，本 session 生效，7 天后自动过期。
- 会话/设备不可用即失效；压缩或重启后需重新确认 `CronList` 是否还有该 Job，没有则重建。
- 首次自然触发写一次 scheduled PONG 到 `docs/STATUS.md`，之后无新任务不再写心跳。

## MIG-A-001 结论摘要
- `C:\Users\teddy\Downloads\` 和 `E:\NianlifeBackups\2026-09-07\`：**都没有真正的备份数据文件**（无 `.dump/.sql/.tar`）；E 盘目录为空。
- 任务卡里"第 18 节之后"与 `nianlife-P2-backup-execution-2026-09-07.md` 实际结构（只有 §0–§9）不符，已如实标注，未臆测。
- §8/§9 显示：两次凭据轮换后的 `pg_dump` 尝试都在启动后被 signal 中断（退出码 124），根因未定位，按约定已停止重试。
- 发现 `nianlife-prod-ecs.pem` 存在于 Downloads，未读取内容，仅报告存在性，交 Codex/Teddy 判断是否需要处理。

## MIG-A-002 结论摘要
- `step12-progress.txt` 实测速率约 2.2KB/s，全程线性无阶段性停顿（非"卡某张表"型问题）；121MB 库外推单份 dump ≈15.6 小时，今晚不可能跑完，中等置信度推测是单连接带宽/速率限制（网络路径或 Neon 侧），未能排除"本机出口带宽本身慢"。
- 三条路线：A 保持串行延长超时（≈31 小时/两份，需 Teddy 同意占机一夜）；B 目录格式 `--jobs 2-4` 并行（需先查 Neon 最大并发连接数，需新授权）；C 走 Neon 原生分支/导出机制绕开慢速路径（需新功能/套餐决定）。详见 `docs/STATUS.md`。
- **发现 `NIANLIFE-RUN-FULL.bat` 有两处 bug，标记不可用**：① 调用的 `step7-archive.ps1` 源目录硬编码 `$work\2026-09-07`，不读 `prod-run-dir.txt`；② 它写 `step7.status`，但 `step8-cleanup.ps1` 检查的是 `step7-plain.status`——若有旧的 `step7-plain.status=DONE` 残留会被误判通过，触发误清理。`NIANLIFE-RUN-PROD-RETRY.bat` 链路一致，可继续用。最小修复方向已写入 STATUS.md，未实施。
- Phase 2 完整完成的四条客观退出条件（第12/5/6/7/8 步全绿）已列在 STATUS.md，当前所有尝试都停在第一条中途。

## 占用
- 本轮无仓库写占用冲突；`docs/STATUS.md`/`docs/STATUS-C.md`/`v2/package-lock.json` 的既有未提交改动非本 session 产生，未触碰，仅在 STATUS.md 追加新条目。

## 消息游标
- 已读 `docs/DIRECT-COORDINATION.md`（全文）、`docs/ORCHESTRATOR-INBOX.md`（顶部 CMD-20260907-006 起至 OPS-A-001/MIG-A-001 两张卡）。
- 未读：`docs/ORCHESTRATOR-INBOX.md` 更早的历史存档段落（按协议不需要）。

## 下一件事
Phase 2 备份/恢复已完整完成（历史，见上）。当前唯一待办是 Phase 4：等 Teddy 提供 RDS 数据库
账号凭据 + ECS 执行机信息（见上方 2026-09-09 Phase 4 条目），到位后立即继续恢复，不重做已完成
的 locale 判断。`NIANLIFE-RUN-FULL.bat` 的两处历史 bug 仍未修（不在本轮范围内）。
