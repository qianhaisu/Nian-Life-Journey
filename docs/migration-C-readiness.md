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

## 5. 本任务边界内未做的事（如实列出，不代表"以后也不用做"）

- 未修复 2.1 的 `getStore()` 缺口——只发现、未改代码，因为这属于会改变查询逻辑的改动，
  按当前"离线核查"任务性质不在本任务授权范围内主动改代码；下一个接到 MIG-C 后续任务
  或 Codex 指派修复任务的 session 可以直接用本节的定位信息动手，不需要重新排查。
- 未重新核实 Vercel/Neon 控制台当前实时状态——第 1 节全部引用 P0 报告，控制台状态可能
  在本文件生成后由 Teddy 或其他 session 变更，使用本文件前应先看 P0 报告或
  `docs/STATUS-C.md` 最新条目确认仍然成立。
