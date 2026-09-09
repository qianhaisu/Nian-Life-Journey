# HANDOFF-C（Code C，≤80 行，2026-09-09 更新）

## 身份 / 当前状态
- Code C，唯一 worktree `C:\Users\teddy\Documents\Nianlife`，当前分支 `main`。
- MIG-C-Phase3C2 已完成离线实现与验证；本轮精确提交并 push `main` 后交 Codex 总审核。
- 无生产占用；未连接 Neon/R2/OSS/Vercel/ECS，未部署、采购、改 DNS、启动 worker/cron。

## 授权与边界
- 生效协议：`docs/DIRECT-COORDINATION.md`，Codex 直接派单/审核 A/B/C。
- 本轮只动 Phase3C2 白名单代码、`docs/STATUS.md` 与本文件。
- 明确保留未动：`docs/HANDOFF-COMMANDER.md`、`docs/ORCHESTRATOR-INBOX.md`、
  `v2/package-lock.json`、`docs/nianlife-handoff-2026-09-06-neon.md`、
  `v2/db-check-tmp.mjs`、`v2/scripts/quark-heic-ingest-linux.mjs`。

## MIG-C-Phase3C2 结果
- 新增 `v2/compose.production.yaml`：web + Caddy proxy，无 scheduler/worker 服务。
- 新增 `v2/Caddyfile`：ALB 终止 TLS 后，HTTP `:80` 转发至 `web:3000`。
- 新增 `ORGANIZER_WORKER_ENABLED=false` + `CRON_SECRET` 示例变量。
- 新增严格 worker gate；自动 kick 和内部 worker API 均需显式 `true` 才能 claim job。
- 删除 `v2/vercel.json` 的旧每日 cron，避免迁移时隐式保留自动写入触发面。
- 人工发布/回滚顺序、验证分层和未验证项见 `docs/STATUS.md` Phase3C2 条目。

## 验证证据
- worker gate/batch 针对性测试：5 pass / 0 fail。
- typecheck、lint：通过。
- 全量测试：691 total / 681 pass / 10 skip / 0 fail。
- Compose：`js-yaml` 解析通过，确认 web/proxy 服务存在。
- 隔离 build：无 `.env.local`，本地/假配置、worker=false、Next 15.5.24；18 路由和
  standalone trace 完成，exit 0。
- Docker 不存在：镜像构建、compose config/up、Caddy 转发、ECS/ALB 均未验证。

## 下一步 / 放行门槛
1. 有 Docker 的机器补 `docker compose config`、build/up、健康检查与 Caddy 转发验证。
2. Teddy 批准后才创建/配置 ECS/ALB；发布前记录 commit SHA、旧目标和回滚负责人。
3. 数据/页面验收通过前 worker=false，且不创建 scheduler。
4. 若需 worker，专用 secret + 显式 true 后先手工有界批次；scheduler 另行批准。
5. 异常先 worker=false、停止新目标流量、恢复已记录旧目标；保留历史，不删除数据。
