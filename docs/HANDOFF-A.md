# HANDOFF-A（Code A，直连 Codex，≤80 行）

**更新**：2026-09-09 · 本 session（Phase 4：数据库恢复完成 + 应用真实读取路径验证通过）

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

### 2026-09-09 Phase 4 应用接入验证（第四轮）：真实读取路径全部跑通，发现一个真实性能问题
- 沿用同一 SSH 隧道，用 `npx tsx` 在独立进程里直接 `import` 应用真实模块
  （`@/lib/family-archive`、`@/lib/db/repository`），仅在该进程环境变量设 `DATABASE_URL`/
  `REPOSITORY_BACKEND=postgres`，未改 `.env.local`；`ORGANIZER_WORKER_ENABLED=false` 关闭，只调
  只读方法，未走任何写入/enqueue 路径。
- 权限/索引/约束/迁移核对：`nianlife_admin` 对 19 张业务表有全部 CRUD 权限（偏 admin，非最小权
  限专用账号，复用已有账号未新建）；`drizzle.__drizzle_migrations` 13 行与本地 journal 13 条一
  致；52 索引 0 invalid、215 约束 0 未验证。
- **首页/月页/`/about` 共用的 `loadFamilyArchive()`：成功但耗时 94,252 ms**，远超产品原则
  ≤3 秒验收线——真实发现，非本轮引入，是既有 `getStore()` 全表读取设计的已知问题，切到 ECS 部
  署后网络路径会变但根因不会自动消失，需要单独排查（本轮只读测量，未改代码）。
  `getMonthArchive`（1,629 ms）、`getEventDetail`（895 ms）耗时正常。
- 日期边界/时区行为核实通过：读了 `lib/timeline-dates.ts` 的 `calendarDayOf()`，确认它用正则
  检测偏移后缀（非硬编码 `+00`）、`Date` 正确解析任意偏移、显式转换到 `Asia/Shanghai` 取日历
  日——目标库会话 timezone（`Asia/Shanghai`）与源库（`GMT`）不同不影响这条链路的正确性。
- 详见 `docs/STATUS.md` 2026-09-09「Phase 4：RDS 应用接入验证」条目（含逐项数字、未确认项、
  下一步 ECS/OSS 缺口清单）。

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
**数据库恢复完成，应用真实读取路径验证通过**（见上方第三/四轮条目）。**尚未完成**：OSS 媒体
迁移（本轮完全未涉及，路径/凭据/一致性校验均未设计）、ECS Web 部署切流（配置草案存在但从未
在真实 ECS 上跑过）。下一步缺口清单见 `docs/STATUS.md` 同日条目末尾「下一步 ECS 应用 + OSS
迁移仍缺的具体条件」。`NIANLIFE-RUN-FULL.bat` 的两处历史 bug 仍未修（不在本轮范围内）。
