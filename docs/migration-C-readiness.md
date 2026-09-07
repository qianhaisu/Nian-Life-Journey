# MIG-C-001 · 离线迁移准备 / 费用保护缺口 / 发布回滚清单

生成：2026-09-07（Code C，纯离线核查，未连接生产数据库，未访问 nianlife.cn，未改动 Vercel/Neon 控制台任何设置）。
背景文档：`docs/nianlife-P0-report-2026-09-06.md`（Git/Vercel/Neon 控制台状态权威来源，本文件不重复其内容，只引用）。

## 1. 当前部署基线（引自 P0 报告，未重新核实控制台，只做代码侧交叉检查）

- Vercel Production：Paused；GitHub↔Vercel 自动部署连接已断开；Vercel Cron 总开关 Disabled。
- Neon：Launch 计划，0.25 CU，PostgreSQL 18，服务 Enabled（未降级、未删除）。
- 代码侧无 GitHub Actions，无 `vercel.json`（根目录），`v2/vercel.json` 仅一条 cron：`/api/internal/organizer-worker`，`0 3 * * *`（保留在文件里，Cron 总开关关闭不会触发，迁移到 ECS 时需要显式重建这条调度，不能假设"文件里有 = 已经在跑"）。

## 2. 费用保护缺口（代码层面核实，未在生产验证）

### 2.1 `app/events/[id]/page.tsx` 仍在每次渲染时跑一次全量 `getStore()` ——未修复的缺口

`getStore()` 是 `docs/STATE.md` 明确标注"不给页面渲染路径用"的全量读取函数
（`v2/lib/db/postgres-repository.ts` 文档注释实测 ~5-10 分钟/全量数据）。9-06 事故修的是
`getEventDetail`（`a04d8d2`）和 `generateStaticParams`/`cache()` 去重（`94ea000`），
两个 commit 文件范围都不包含这一行：

```
app/events/[id]/page.tsx:45
const [detail, store] = await Promise.all([getCachedEventDetail(id), getStore()]);
```

`store` 只是为了拿 `store.profile.id`（校验）、`store.links`（按 `lifeEventId` 过滤）、
`store.mediaAssets`/`store.mediaLocations`（传给 `deliverableMediaIds`）。这三样都可以按
单个 `id` 或该事件的 `media` 集合窄查询替换，不需要整表。**当前状态**：只要
`generateStaticParams` 返回 `[]`（已改），这个全量读就从"每次构建触发 651 次"变成
"每次访客首次打开一个事件页触发一次，之后 300 秀 ISR 缓存到下次 revalidate"——比 9-06
当天的情况轻得多，但只要 Production 恢复、有真实访客点开事件页，**同一种全表读模式仍会
在生产上执行**，不是"已经解决"，是"触发频率从构建时降到了运行时、从确定发生降到了按访问
发生"。这是本轮离线核查发现的、尚未有人认领修复的**唯一新增费用缺口**，其余 C-1/C-2/C-3
项（ISR、`/api/media` 单条查询、`/api/health`）已核实为已完成状态（见第 3 节）。

**修复方向**（不在本任务范围内实施，留给下一个接单 session 或 Teddy 决定优先级）：
用 `getEventDetail` 已有的按 id 收窄模式，把 `store.links`/`mediaAssets`/`mediaLocations`
的三个用途各自换成按 `lifeEventId`/该事件 `media.id` 集合的窄查询，替代 `getStore()`。

### 2.2 迁移期间的隐性触发面

- `v2/vercel.json` 的 organizer-worker cron 一旦迁移到 ECS 时被误重建为"迁移完立刻按
  `0 3 * * *` 跑"，且此时数据尚未验证完整，会在数据不完整的状态下对 Neon 发起写入。
  迁移执行方应在环境变量/数据校验完成前保持这条调度关闭，不能因为"文件里一直有这行"
  就当作默认应该跑。
- `app/api/internal/revalidate/route.ts`（C-1 交付物）用 `INGESTION_TOKEN` 做 Bearer
  校验，一次最多 50 个 path。迁移后如果本地 worker 的 base URL 配置错误指向了错误的
  Vercel 部署，此接口本身限流已经足够小（50 path/次），不构成新的费用风险，仅记录供
  迁移检查表核对 `NIANLIFE_INGESTION_URL`/等价变量确实指向新环境。

## 3. 已确认完成、不需要重跑的项（交叉核实用，避免下一个接单者重复劳动）

| 项 | 状态 | 证据 |
|---|---|---|
| C-1 五个公开页 ISR (`revalidate = 300`) | 完成 | `page.tsx`/`about/page.tsx`/`memory/page.tsx`/`memory/[year]/page.tsx`/`memory/[year]/[month]/page.tsx` 均已是 `revalidate = 300`，非 `force-dynamic` |
| C-2 `/api/media/[id]` 去 `getStore()` + 长缓存 | 完成 | 路由内无 `getStore` 引用；命中缓存头 `public, max-age=31536000, s-maxage=31536000, immutable` + ETag；未命中/404 用 `no-store` |
| C-3 `/api/health` | 完成 | 存在，`no-store`，返回 DB 连通性 + 两张表计数，503 分支同样 `no-store` |
| C-7 事件页构建期放大 | 完成（`94ea000`，已推） | `generateStaticParams` 返回 `[]`；`getEventDetail` 用 `cache()` 去重；但 `getStore()` 缺口未覆盖，见 2.1 |
| Ignored Build Step 致命 bug | 已修复（Teddy 已保存新命令），且 Git 连接现已断开，该配置暂时不再是触发面 | `docs/STATUS-C.md` 2026-09-06 记录 |

## 4. 发布回滚清单（供 Production 恢复/迁移切换时使用）

**前提**：以下步骤只在 Teddy 决定恢复 Vercel Production 或切换到新迁移环境时执行，
本任务本身不触发、不建议任何时间点执行——纯粹是把分散在 STATUS-C/P0 报告里的操作
顺序整理成一张一次性核对表。

1. **恢复前确认三个开关的目标状态**，不要假设"之前是什么就该改回什么"：
   - Vercel Production Paused → Active（或迁移到 ECS 后不再需要这一步）
   - GitHub↔Vercel 自动部署连接（当前断开，若继续用 Vercel 则需要 Teddy 重新连接；
     若迁移走 ECS 则这条永久保持断开，不必恢复）
   - Vercel Cron 总开关（当前 Disabled；`organizer-worker` 迁移到 ECS 的话，Vercel Cron
     不重新启用，改成 ECS 侧定时任务）
2. **恢复前跑一次本文件第 2.1 节的修复**（或至少书面确认"接受这个已知缺口，理由是访问量
   低/已加监控"），不要在缺口未处理、未决策的情况下直接把流量打开。
3. **环境变量核对**：`DATABASE_URL`、R2 五项、`INGESTION_TOKEN`、`NIANLIFE_INGESTION_URL`
   等（见 P0 报告第 1 节完整变量名列表）在新环境（Vercel 恢复或 ECS）里逐项确认非空、
   非占位值，且指向的是 Teddy 决定继续使用的那个 Neon 项目/R2 bucket，不是测试期间
   临时建的。
4. **健康检查先行**：任何流量打开前先打 `/api/health`，确认 `ok: true` 且
   `rawSourceCount`/`mediaCount` 与迁移前记录的数量级一致（数量级骤降 = 数据没迁完，
   立即停止，不对外开放）。
5. **回滚触发条件**：恢复后若 `/api/health` 延迟异常升高、或 Neon 控制台用量曲线短时间
   内出现类似 9-06 事故的陡峭上升（参考 `docs/nianlife-handoff-2026-09-06-neon.md` 与
   9-06 事故报告里的费用曲线描述），立即把 Vercel Production 重新 Pause（或 ECS 侧下线
   服务），不要先尝试"调小一个参数看看"再决定——先止损，再诊断。
6. **回滚后留痕**：任何一次恢复/回滚动作，无论谁执行，都写一条时间戳记录到
   `docs/STATUS-C.md`（或迁移专用的运行记录文件），说明触发条件和回滚耗时，供下一次
   类似决策参考。

## 6. 已有保护 / 缺口 / 最小实现 / 离线验法（OPS-C-001 补充，2026-09-07）

| 风险面 | 已有保护 | 缺口 | 最小实现建议 | 离线验法 |
|---|---|---|---|---|
| 构建隔离 | `generateStaticParams` 已在 `page.tsx`（无参数）、`memory/[year]/page.tsx`（年份列表）、`events/[id]/page.tsx`（返回 `[]`）三处收窄，避免构建期全量预渲染 | 若未来新增动态路由（如按月/按人分类页）忘记同样收窄，会重新引入"构建时全量枚举"的费用面；无自动化检查防止回归 | 加一条 lint/CI 规则或代码注释约定：任何新 `[param]` 路由的 `generateStaticParams` 默认必须显式写 `return []` 或收窄列表，否则 review 时人工拦截 | 读代码：`grep -rn "generateStaticParams" v2/app` 逐个确认返回值收窄或为空，不需要连库 |
| Cron / worker | `v2/vercel.json` 的 `organizer-worker` cron 目前 Vercel Cron 总开关 Disabled（P0 报告确认），本地 worker 默认离线（`docs/COORDINATION.md` §迁移基线：worker 默认停用） | 迁移到 ECS 时若把这条 cron 原样复制为"立即按 `0 3 * * *` 启用"，且此时数据/环境变量未校验完，会在未就绪状态下写生产库；当前没有"迁移完成前禁止自动重建 cron"的书面硬闸，只是约定 | 迁移检查表里加一条显式步骤："ECS 定时任务默认 disabled，人工确认数据校验通过后才手动 enable"，不依赖"记得关掉"这种口头约定 | 读 `v2/vercel.json` + 迁移用的 ECS 定时任务配置文件（若已建），确认默认状态是关闭，不需要连库 |
| 查询放大 | `getEventDetail`（`a04d8d2`）已收窄为 `inArray` 查询；`/api/media/[id]`（C-2）已去 `getStore()` 改单条查询 | 本文件第 2.1 节：`events/[id]/page.tsx:45` 的 `getStore()` 全量读未修复，是当前唯一已知未覆盖的放大点；`a04d8d2` 提交信息里作者自述 `contributors` 仍是全表读且未核验行数，这一项也未被本轮核查覆盖，需要单独确认 | 按 2.1 节方向替换为按 id 收窄查询；`contributors` 全表读需要另开一次代码核查（本任务未做，如实标注） | 读代码找 `getStore()`/`getOrganizerStore()` 全部调用点：`grep -rn "getStore\|getOrganizerStore" v2/app`，逐个确认是否在渲染路径上，不需要连库 |
| 跨进程预算 | 无 | 没有任何机制限制"同一分钟内有多少个渲染请求各自触发一次全表读"——ISR revalidate=300 只降低单个路径的重复读频率，不限制不同事件页/不同访客并发触发多少次 `getStore()`；也没有请求级或进程级的读取预算/熔断 | 最小实现：给 `getStore()`/`getOrganizerStore()` 加进程内简单节流（例如同一 Node 进程 60 秒内命中缓存而非重新查询），比引入外部限流组件成本低；这是设计建议，未实施 | 无法离线验证运行时行为（需要真实并发请求），只能确认代码里当前确实没有节流层：`grep -rn "getStore\b" v2/lib/db/postgres-repository.ts` 查看实现本身有无缓存包装 |
| 供应商额度不可用情形 | `/api/health` 探针存在，503 分支返回 `no-store` 的错误 JSON，不会被误缓存成"健康" | 没有观察到"Neon 额度耗尽/连接被拒绝"时应用层的降级路径——`getDb()` 失败会直接抛错，页面渲染路径没有专门的"数据库不可用"友好降级（用户看到的是 Next.js 默认错误页，不是一个说明性的临时页面） | 视优先级决定是否值得做；如果做，最小实现是在几个公开页的顶层 `try/catch` 包一层，DB 查询失败时渲染一个静态的"稍后再试"页而不是抛错 | 读代码确认当前无此类 `try/catch`：`grep -rn "catch" v2/app/page.tsx v2/app/memory/page.tsx v2/app/about/page.tsx`（预期为空或仅无关的客户端组件），不需要连库 |

## 7. 本机消息投递能力核查（OPS-C-001，是否支持 60 秒仅查 mtime、变化才唤醒的轻量检查器）

**结论：支持，本会话内已确认有一个匹配这个模式的原生工具，但按任务要求本轮未启动。**

- 本会话可用的 `Monitor` 工具支持传入任意 shell 命令，以 stdout 的每一行作为一次"事件"
  （= 唤醒/通知），命令本身可以是一个 `while true; do ...; sleep 60; done` 循环：
  只在检测到目标文件 mtime 变化时才 `echo` 一行，其余时间静默，不产生任何通知、
  不消耗一次模型调用。这正是任务要求的"每 60 秒只查 mtime，变化才唤醒"模式，且是
  本机进程内轮询（`stat`/`Get-Item .LastWriteTime`），不依赖任何外部 API 或云端投递。
- 与现有 `CronCreate`（本任务用的每 5 分钟收件调度）的区别：`Cron` 是固定周期重新入队
  一条完整 prompt（每次都相当于唤醒一次会话去读文件判断有没有变化）；`Monitor` 是同一个
  后台脚本自己判断"有没有变化"，只有真正变化时才产生一次通知，二者不是同一层，可以
  叠加使用而不冲突。
- **限制**：`Monitor` 是会话内的后台任务，随本会话结束而结束（同 Cron 的 session-only
  限制），不能跨会话/跨进程持久化；也不是"消息投递 API"意义上的推送（不能被外部系统
  主动 push 唤醒），本质仍是本机轮询，只是把"判断有没有变化"这一步从模型调用下沉到了
  shell 脚本，省的是模型调用次数，不是轮询本身。
- **本轮未启动**：按 OPS-C-001"本轮不启动新常驻服务"的要求，只验证接口存在并记录证据，
  未实际调用 `Monitor` 建立这个检查器。如果 Codex/Teddy 决定要，可以用类似
  `while true; do NEW=$(stat -c %Y docs/ORCHESTRATOR-INBOX-C.md 2>/dev/null); [ "$NEW" != "$OLD" ] && echo "changed: $NEW"; OLD=$NEW; sleep 60; done`
  的命令直接建，无需额外安装任何包。

## 8. 本任务边界内未做的事（如实列出，不代表"以后也不用做"）

- 未修复 2.1 的 `getStore()` 缺口——只发现、未改代码，因为这属于会改变查询逻辑的改动，
  按当前"离线核查"任务性质不在本任务授权范围内主动改代码；下一个接到 MIG-C 后续任务
  或 Codex 指派修复任务的 session 可以直接用本节的定位信息动手，不需要重新排查。
- 未重新核实 Vercel/Neon 控制台当前实时状态——第 1 节全部引用 P0 报告，控制台状态可能
  在本文件生成后由 Teddy 或其他 session 变更，使用本文件前应先看 P0 报告或
  `docs/STATUS-C.md` 最新条目确认仍然成立。
