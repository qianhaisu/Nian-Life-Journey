# HANDOFF-A（Code A，直连 Codex，≤80 行）

**更新**：2026-09-07 · 本 session（含 MIG-A-002）

## 任务 ID 状态
- A-12-1 / A-12-2：已完成，`a04d8d2`，已在 `main`（`git merge-base --is-ancestor` 确认），已 push。
- MIG-A-001（离线核对 Phase 2 备份产物/进度/阻塞）：本轮完成，只读，见 `docs/STATUS.md` 2026-09-07 条目。
- OPS-A-001（调度状态 + HANDOFF-A 同步）：本轮完成，见下方「调度」。
- MIG-A-002（生产备份受控失败分析）：本轮完成，只读，未连生产、未改脚本，见下方摘要。

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
等 Codex/Teddy 从 A/B/C 三条路线里选一条并给授权（尤其路线 B 的并发数上限、路线 C 的新功能/套餐决定）；`NIANLIFE-RUN-FULL.bat` 的两处不一致等决定是否现在修；本轨暂无更多离线核查项，回到收件轮询待命。
