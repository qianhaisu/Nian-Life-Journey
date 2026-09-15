# DATA-0915-COWORK-REVIEW-RUNTIME-R2 恢复 Cowork 真实数据验收环境

- line: data
- status: blocked
- round: runtime-recovery-1
- branch: `claude/data-line`
- worktree: `C:\Users\teddy\Nianlife-worktrees\data`
- objective: 在释放旧故障页面服务占用后，恢复页面提交 `e2f455d88a3797823ea45e7c8f19381a704b23a7` 的临时只读真实数据验收实例，供 Cowork 续审未完成页面。
- push_policy: no source edit, no commit, no push, no deploy

## 已知状态

- 上一轮 `4916/18081/15681` 因系统低内存被终止；没有数据库写入，两个 worktree 均 clean。
- 先前核实到旧故障 mock 服务占用 `4915`，PID `84712`，Working Set 约 1327 MB；当前派发前端口已不再监听，可能已被系统回收。
- 旧私有站 `18080` 必须保持不动；不得停止其进程。
- Cowork 已完成 `/`、`/memory`、`/memory/2026/09` 桌面验收，本轮恢复后只续审缺项，不重复已完成页面。

## 执行要求

1. 加载 exec-protocol，核对数据线与页面 worktree、HEAD、clean 状态；不得编辑业务源码。
2. 只读复核 `4915` 当前监听状态。若仍由 PID `84712` 或同一页面 worktree旧 mock Node 进程占用，且能核实为故障旧服务，允许只停止该精确进程树；若已不存在则跳过。不得碰 `18080` 或其他未核实进程。
3. 复用上一轮同一 launcher 和安全连接方式，在 `4916` 启动页面 worktree `e2f455d`，以 `18081` 提供本机验收入口、`15681` 提供数据库隧道。
4. 保持数据库严格只读，禁用 Organizer、AI、worker、导入、迁移和所有后台写任务；不得打印、复制或改写凭据。
5. 验证 `18081/api/health` 为 200、db=connected、完整 SHA=`e2f455d88a3797823ea45e7c8f19381a704b23a7`。
6. 分别 GET `/memory/2026`、`/memory/2025`、`/about`、`/inbox`、`/capture`、`/events/event-r23-20250327-swimming`，给予冷启动最多 60 秒；只回写状态码/耗时/错误类型，不输出家庭正文。
7. 若内存再次不足或服务退出，立即 blocked，不反复拉起；回写当时可用内存和精确失败证据。
8. Cowork 续审期间保持服务存活，并回写 PID、端口、停止方式。不得部署、不得产生新增费用。

## required_evidence

- ACK、context 余量、skill 已加载。
- 端口/PID/工作目录、health SHA 与 DB 只读证明。
- 六个缺项路径的 HTTP 结果；特别区分真实路由错误与上轮资源中断。
- 明确无源码改动、无 commit/push/deploy、无数据库写入。

## stop_conditions

- 无法核实旧进程身份；需要停止 `18080`；需要改源码/配置、部署、付费、写数据库；或重启后再次低内存退出时，立即 blocked。

## ACK / Progress / Result

### ACK（2026-09-15 19:10 北京时间）
- skill：已加载 `C:\Users\teddy\Documents\Nianlife\.claude\skills\exec-protocol\SKILL.md`
- context 余量：约 99%
- 数据线：`claude/data-line`，HEAD `9f121067547746c0bc24a6c408047ea57251330e`，`## claude/data-line`（clean）
- 页面 worktree：`claude/page-line`，HEAD `e2f455d88a3797823ea45e7c8f19381a704b23a7`，clean；`.next/BUILD_ID` 仍为上一轮从 clean HEAD 重建的 `56Ps-jsJ4xvAmSgu-QXK9`
- 可用内存：2.4 GB / 23.6 GB
- 端口（只读核对）：`4915` 仍在监听，PID 84712（node.exe，Working Set 1,327 MB，命令行为 `C:\Users\teddy\Documents\Nianlife\v2\node_modules\next\dist\server\lib\start-server.js`）；`18080` 由 PID 60412 监听，不动；`4916`、`18081`、`15681` 空闲
- 状态：running（先核实 84712 的身份）

### 4915 旧进程处理（19:11 北京时间）
- 身份核实（只读）：
  - PID 84712：node.exe，创建于 2026-09-15 15:58:09，Working Set 1,327 MB，与卡上记录一致。
  - 其父进程 PID 87072 的命令行为 `next dev -p 4915`，路径在 `C:\Users\teddy\Nianlife-worktrees\page\v2`，即同一页面 worktree 的旧 dev 服务。
  - `GET 127.0.0.1:4915/api/health` 返回 500 Internal Server Error，确认是故障旧服务。
- 动作：`taskkill /PID 87072 /T /F`，只结束这一棵进程树（87072 与其子进程 84712），没有其他子进程。
- 结果：4915 不再监听；18080 仍由 PID 60412 监听，health 仍为 `a56fee42cb0ed922e603400736b5ca3fb894445b`，未受影响；可用内存从 2.4 GB 升到 3.7 GB。

### Result（2026-09-15 19:14 北京时间）
- completed_at: 2026-09-15 19:14 北京时间
- 源码改动 / commit / push / deploy：全部没有。两个 worktree 的 `git status` 仍为 clean；页面 worktree 沿用上一轮从 clean HEAD 构建的 `.next`（BUILD_ID `56Ps-jsJ4xvAmSgu-QXK9`），没有重新构建。
- 数据库写入：无。

#### 运行实例（Cowork 续审期间保持存活）
- 验收入口：`http://127.0.0.1:18081`（本机 TCP 转发，PID 70904 监听）→ 应用 `http://127.0.0.1:4916`（`next start`，PID 88552）
- 数据库隧道：`127.0.0.1:15681`（ssh，PID 29016），由 launcher 持有
- launcher：PID 70904，与上一轮是同一个 launcher，连接方式也相同（数据线 `v2/.data/night-rds.mjs`）；凭据只进子进程环境，不打印、不落盘；`.env.local` 未使用
- 工作目录：`C:\Users\teddy\Nianlife-worktrees\page\v2`
- 停止方式（无敏感值）：`taskkill /PID 70904 /T /F`，会一并结束 next 与 ssh 隧道
- 启动后可用内存：3.7 GB / 23.6 GB

#### health 与只读证明
- `GET 127.0.0.1:18081/api/health` → 200，ok=true，db=connected，rawSourceCount=52989，mediaCount=10873，build.sha=`e2f455d88a3797823ea45e7c8f19381a704b23a7`，build.id=`56Ps-jsJ4xvAmSgu-QXK9`（与页面 worktree `.next/BUILD_ID` 一致）
- launcher 启动前用子进程同一连接串核对过：`current_database()=nianlife`，PostgreSQL 18.4，`default_transaction_read_only=on`；尝试 `create temp table` 被服务端以 read-only 拒绝
- `ORGANIZER_WORKER_ENABLED=false`、`AI_ORGANIZER_ENABLED=false`、`MEMORY_ORGANIZER=rule`；没有注入 AI、R2、CRON_SECRET、INGESTION_TOKEN

#### 六个缺项路径（经 18081，每条最多 60s，只记状态）
| 路径 | HTTP | 耗时 | 错误类型 |
| --- | --- | --- | --- |
| `/memory/2026` | 200 | 44.7s（冷启动首次加载档案） | 无 |
| `/memory/2025` | 200 | 44.6s（冷） | 无 |
| `/about` | 200 | 44.6s（冷） | 无 |
| `/inbox` | 200 | 0.016s | 无 |
| `/capture` | 200 | 0.004s | 无 |
| `/events/event-r23-20250327-swimming` | 200 | 0.004s | 无 |
- 响应体里没有 `Internal Server Error`、`Application error` 或 `This page could not be found`；`next-start.log` 中 error、read-only 计数为 0。
- 与上一轮的区分：上一轮是整个实例因系统低内存被结束，属于资源中断，不是路由错误。本轮六条路由全部 200，没有发现真实路由错误。前三条约 45s，是冷启动加载档案的一次性耗时，每条都在 60s 限制内。

#### unverified / risks
- 没有做浏览器实看和审美判断，交 Cowork。
- `build.sha` 来自 launcher 注入；`build.id` 与页面 worktree HEAD 是旁证。
- 可用内存仍只有 3.7 GB。如果实例再次因低内存退出，按卡片要求立即写 blocked，不反复拉起。

### BLOCKED（2026-09-15 19:21 北京时间）：实例再次因低内存被终止，按执行要求 7 停止，不再拉起
- 失败证据：Claude Code 后台任务通知启动 launcher 的命令「was stopped because the system is running low on memory」。发生在 19:14 回写 Result 之后、19:21 之前。
- 现状核对：
  - PID 70904（launcher）、88552（next）、29016（ssh 隧道）都已不存在。
  - 4916、18081、15681 都没有监听；`GET 127.0.0.1:18081/api/health` 无法连接（000）。
  - 18080 仍由 PID 60412 监听，未受影响。
- 当时可用内存：3.4 GB / 23.6 GB。
- 占用最多的进程（Working Set）：ChatGPT 658 MB、vmmem 657 MB、quark_cloud_drive 610 MB、claude 585 MB、Weixin 543 MB、claude 491 MB。均不属于本卡可以处理的对象，未触碰。
- 数据安全：launcher 日志最后一行仍是 19:11:29 的启动记录，之后没有报错。数据库会话始终只读，没有写入；两个 worktree 仍 clean；没有源码改动、commit、push 或部署。
- 前面 19:14 回写的 URL、PID 已失效。在此之前六条缺项路径已全部返回 200，那组结果本身有效，这次中断属于资源中断，不是路由错误。
- 解除条件：本机需要稳定腾出内存，建议可用内存不少于约 6 GB，比如关掉不需要的桌面应用或 WSL（vmmem），或者改由 Codex/Teddy 指定另一台内存充足的机器或其他运行方式。条件满足后，用同一个 launcher、同样的端口即可恢复，不需要改代码或配置。
