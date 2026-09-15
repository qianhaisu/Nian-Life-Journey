# DATA-0915-PERSISTENT-REVIEW-RUNTIME-R3

- line: data
- status: submitted
- branch/worktree: `claude/data-line` / `C:\Users\teddy\Nianlife-worktrees\data`
- target_sha: `e2f455d88a3797823ea45e7c8f19381a704b23a7`
- decision: Teddy 已明确允许把验收实例改为宿主机托管的持久只读进程，并立即继续 Cowork 审核。
- push_policy: no source edit, no commit/push/deploy

## 执行

1. 加载 exec-protocol；确认页面 worktree HEAD/clean、`18080` 不动。
2. 用宿主机独立后台进程维持同一只读真实数据实例：应用 `4916`、入口 `18081`、DB 隧道 `15681`。不得依附 Claude 后台工具生命周期；进程窗口隐藏。
3. 保持 DB `default_transaction_read_only=on`，禁用 Organizer/AI/worker/import/migrate；凭据仅进入子进程环境，不落盘、不输出。
4. 核验 health 200、db connected、完整 SHA；等待 60 秒后再复核一次进程/health，证明不会随本轮结束退出。第二次失败立即 blocked，不再重启。
5. 使用宿主机 Playwright 对以下页面以真实 CSS viewport `390x844` 只读截图，并记录 `innerWidth/innerHeight/clientWidth/scrollWidth/overflowX/build.sha`：`/`、`/memory`、`/memory/2026`、`/memory/2026/09`、`/memory/2025`、`/about`、`/inbox`、`/capture`、`/events/event-r23-20250327-swimming`。不得提交表单或触发写入。
6. 证据写到 `C:\Users\teddy\NianlifeOps\review-PAGE-0915-FULL-REMEDIATION-E2F455D-TRUE-COWORK-CONT1\mobile-shots\` 和 `mobile-capture-log.json`；不改 Cowork README。
7. 回写 PID、精确停止方式、两次 health、手机视口实测值和证据路径。保持实例存活供 Cowork 使用。

## stop_conditions

需要改业务源码、写数据库、停止 `18080`、部署/付费、泄露凭据，或持久实例再次退出时立即 blocked。

## ACK / Result

### ACK
- skill：已加载 `C:\Users\teddy\Documents\Nianlife\.claude\skills\exec-protocol\SKILL.md`；context 余量约 99%
- 执行口径：沿用 R1/R2 的同一 launcher 与只读连接方式（数据线 `v2/.data/night-rds.mjs`），这次改由宿主机 `Start-Process -WindowStyle Hidden` 独立拉起，不挂在 Claude 后台工具下；页面源码、`.env*`、18080 一律不碰
- 状态：running

### Result（2026-09-15 19:41 北京时间）
- 基线：页面 worktree `claude/page-line` HEAD `e2f455d88a3797823ea45e7c8f19381a704b23a7` clean；数据 worktree `claude/data-line` `9f12106…` clean；`.next/BUILD_ID` `56Ps-jsJ4xvAmSgu-QXK9`（R1 从 clean HEAD 构建）。18080 未动（PID 60412，health 仍为 `a56fee42cb0ed922e603400736b5ca3fb894445b`）。
- 源码改动 / commit / push / deploy / 数据库写入：均无。两个 worktree 仍 clean。截图脚本只做 GET 导航，没有点击或提交表单，记录到的非 GET 请求为 0。

#### 宿主机持久实例
- 拉起方式：PowerShell `Start-Process -FilePath node.exe -WindowStyle Hidden -PassThru`，独立于 Claude 后台工具，没有依附其生命周期；stdout 和 stderr 重定向到数据线 scratchpad 日志，不含凭据。
- 进程与端口：
  - launcher PID `12356`：持有 `127.0.0.1:18081` 入口转发和 SSH 隧道
  - `next start` PID `76144`：`127.0.0.1:4916`
  - ssh 隧道 PID `60036`：`127.0.0.1:15681` → ECS → RDS `nianlife`
- 工作目录：`C:\Users\teddy\Nianlife-worktrees\page\v2`
- 精确停止方式：`taskkill /PID 12356 /T /F`，会一并结束 76144（next）和 60036（ssh）；随后 4916、18081、15681 都释放。
- 只读与禁用（launcher 启动核对，11:33:35Z）：db=nianlife，PostgreSQL 18.4，`default_transaction_read_only=on`，写探针被以 read-only 拒绝；`ORGANIZER_WORKER_ENABLED=false`、`AI_ORGANIZER_ENABLED=false`、`MEMORY_ORGANIZER=rule`；未注入 AI、R2、CRON、INGESTION 凭据。凭据只进入子进程环境，未落盘、未输出。

#### 两次 health
- #1 `2026-09-15T11:34:01Z`（启动后约 26 秒）：`GET 18081/api/health` → 200，ok=true，db=connected，build.sha=`e2f455d88a3797823ea45e7c8f19381a704b23a7`，build.id=`56Ps-jsJ4xvAmSgu-QXK9`。
- #2 `2026-09-15T11:39:38Z`（启动后约 6 分钟）：请求 30 秒超时（000），但 12356 和 76144 两个进程都在，三个端口都仍在监听。当时我在同一实例上并行跑 `/memory/2026` 重拍（整页、24 张图），服务正忙。这是我自己造成的并发负载，不是进程退出。
- #2b `2026-09-15T11:40:51Z`（启动后约 7 分钟，重拍结束后）：200，ok=true，db=connected，build.sha 完整相同，latency 72ms。三个进程都在；可用内存 3.9 GB / 23.6 GB。结论：实例在本轮结束后仍存活，没有退出。

#### 390×844 手机视口（宿主机 Playwright chromium，CSS viewport 390×844，DSF 2，isMobile/hasTouch）
全部 9 页：`innerWidth=390`、`innerHeight=844`、`clientWidth=390`、`scrollWidth=390`，没有横向溢出；html `overflowX=visible`，body `overflowX=clip`；build.sha=`e2f455d88a3797823ea45e7c8f19381a704b23a7`。
| 路径 | HTTP | 耗时 | 备注 |
| --- | --- | --- | --- |
| `/` | 200 | 47.0s | 冷启动 |
| `/memory` | 200 | 2.8s | |
| `/memory/2026` | 200 | 11.1s（重拍） | 首轮用 `waitUntil=load` 90 秒超时，没拿到状态码；重拍改为 domcontentloaded，再等 load 最多 60 秒。截图时 24 张图里有 20 张还没加载完，截图里可能有占位；Cowork 如需完整图片请现场看 |
| `/memory/2026/09` | 200 | 29.8s | |
| `/memory/2025` | 200 | 8.8s | |
| `/about` | 200 | 83.6s | 慢，但在 90 秒内 |
| `/inbox` | 200 | 1.8s | |
| `/capture` | 200 | 2.0s | |
| `/events/event-r23-20250327-swimming` | 200 | 1.9s | |

#### 证据路径
- 截图：`C:\Users\teddy\NianlifeOps\review-PAGE-0915-FULL-REMEDIATION-E2F455D-TRUE-COWORK-CONT1\mobile-shots\` 下 9 张：home.png、memory.png、memory_2026.png、memory_2026_09.png、memory_2025.png、about.png、inbox.png、capture.png、events_event-r23-20250327-swimming.png。
- 日志：`…\mobile-capture-log.json`，包含逐页状态、耗时、视口实测值、控制台错误计数、非 GET 请求（为 0）、build。Cowork 的 README 与既有 capture-log.json 未改动。

#### unverified / risks
- 没有做审美判断，交 Cowork。
- `/memory/2026` 截图时图片未加载完，`/about` 冷渲染 83 秒，这两页在内存紧张时可能再次超时。
- 实例现在不受 Claude 工具生命周期影响；但如果系统因内存不足结束 node 进程，实例仍会退出。发生时按卡片要求写 blocked，不再重启。
- health 里的 build.sha 来自 launcher 注入；build.id 和 worktree HEAD 可作旁证。
