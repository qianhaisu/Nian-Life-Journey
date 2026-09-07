# HANDOFF-C（Code C，≤80 行，2026-09-07 更新）

## 身份 / 占用
- Code C，唯一 worktree `C:\Users\teddy\Documents\Nianlife`，分支 `main`，与 `origin/main` 同步。
- 交互式会话 + 会话内 Cron `0d8bb6dd`（每 5 分钟，session-only，7 天自动过期），
  只读 `docs/ORCHESTRATOR-INBOX-C.md` 顶部看板与 `docs/DIRECT-COORDINATION.md`。
- 工作区非本会话产生的改动（保留，不动）：`v2/package-lock.json`（modified）、
  `docs/nianlife-handoff-2026-09-06-neon.md`、`v2/db-check-tmp.mjs`、
  `v2/scripts/quark-heic-ingest-linux.mjs`（均 untracked）。

## 授权来源
- `docs/DIRECT-COORDINATION.md`（2026-09-07 生效，Cowork 派单/初审移除，Codex 直接对接）。
- `docs/COMMANDER-OUTBOX.md` CMD-20260907-006 / OPS-C-001 / MIG-C-001。

## 已完成任务 ID（去重用，不重跑）
- MIG-C-001：`docs/migration-C-readiness.md`（新建，commit `90955af`，已 push）。
- OPS-C-001：本次处理——ACK、HANDOFF-C 同步、`migration-C-readiness.md` 补四列、
  mtime 检查器可行性报告（见 `docs/STATUS-C.md` 对应条目）。
- 历史（迁移协议生效前，仍不重跑）：C-1～C-7（ISR、`/api/media` 长缓存、`/api/health`、
  Ignored Build Step 修复、事件页构建期放大）均已完成并推送，证据见
  `docs/migration-C-readiness.md` 第 3 节。

## 最近消息游标
- `ORCHESTRATOR-INBOX-C.md`：已读到 OPS-C-001 任务卡（2026-09-07，CMD-20260907-004）。
- `COMMANDER-OUTBOX.md`：已读到 CMD-20260907-006。

## 调度
- Cron `0d8bb6dd`，每 5 分钟，session-only，本会话退出即消失，7 天自动过期。
- 尚未验证"压缩/恢复后调度仍存活"——下一次上下文压缩或新会话开始时需重新确认。

## 已知缺口（未修复，供下一任务接手）
- `app/events/[id]/page.tsx:45` 仍在每次渲染调用全量 `getStore()`，见
  `docs/migration-C-readiness.md` 第 2.1 节，定位已给出，未改代码。
