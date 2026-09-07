# Nianlife 迁移 Phase 0 报告（最终版，已通过总指挥验收；本版并入 ECS 采购与 Git 工作方式定稿）

生成时间：2026-09-06，最近一次更新 2026-09-07（Cowork 执行协调）
范围：只读核查 + 控制台状态记录 + 本轮新增的仓库文档同步（AGENTS.md、本报告、Phase 2 执行方案）。**仍未接触生产数据库、未访问 nianlife.cn、未运行任何 Vercel/阿里云控制台之外的生产操作、未购买 RDS/OSS、未开始任何代码改造。**
本文件存放于三处：仓库 `docs/nianlife-P0-report-2026-09-06.md`、`C:\Users\teddy\Downloads\nianlife-P0-report-2026-09-06.md`、以及项目文档 `claude/nianlife-P0-report-2026-09-06.md`。**本轮起本文件已进入 Git 仓库并随 AGENTS.md 一并提交、push**（见第 7 节的提交记录）。
**GitHub 与 Vercel 的自动部署连接已由 Teddy 确认断开**——此前"push 会意外触发生产构建"的风险已解除（见第 1 节表格）。
**Phase 0 已正式通过，Phase 1 进行中。** Phase 2 数据备份执行方案见独立文件 `docs/nianlife-P2-backup-execution-2026-09-07.md`（不是"另附待补"占位，是可逐条执行的完整方案），**仍待总指挥审核批准，未连接/导出生产数据库，未开始代码改造**。

---

## 1. 已确认事实及证据

### Git 基线（P0-C01）
- 分支 `main`，HEAD `381ed67`，`origin/main` `f44fcaa`（迁移基线；本轮新增的文档提交会在此基础上产生新的 HEAD，见第 7 节）。
- Worktree 单一：`C:\Users\teddy\Documents\Nianlife`，无额外 worktree。
- 迁移基线的 11 个未推送提交（新→旧，早于本轮文档提交）：
  1. `381ed67` docs(evidence): daily curve 显示烧钱从 9/4 开始，比之前归咎的 commit 早两天
  2. `f7063db` docs(evidence): 无花费硬闸——组织被 Vercel 托管导致 Neon 拒绝设置 quota
  3. `c4b35a4` docs(evidence): Neon API 探测结果（小时级历史需付费计划 403、quota 未设、Free 超额 6.2 倍）
  4. `6088115` docs: Vercel 支持的答复改变了恢复的经济账
  5. `e7fb5e9` docs: 事故报告 v1 勘误 + 导出易失证据
  6. `a04d8d2` **fix(A-12-1/A-12-2)**：`getEventDetail` 不再全表读（见下方专项核实）
  7. `de97a61` docs: C-7 完成报告（仅本地，未推）
  8. `94ea000` **fix(c-7)**：`getEventDetail` 请求内去重 + 停止预渲染全部事件页（见下方专项核实）
  9. `3c9a941` docs: Neon 出站流量账单事故报告 + 派发修复前任务
  10. `89de6d7` docs: 三轨停工——生产库是人为切断，不是故障
  11. `3866b4c` docs: 心跳，P0 事故收尾
  - 迁移相关性：`a04d8d2`、`94ea000` 是唯一的代码修复，其余 9 个全部是文档，本身不影响迁移，但记录了迁移前必须知道的背景。

- **`a04d8d2` 文件范围**（已核实）：`docs/STATUS.md`（+73）、`v2/lib/db/postgres-repository.ts`（+79/-10）。`getEventDetail` 的四个查询改为 `inArray(id, ...)` 收窄；新增 `guardRowCount()`；作者自述**未在真实数据库上验证**，`contributors` 仍是全表读且未核验行数。
- **`94ea000` 文件范围**（已核实）：仅 `v2/app/events/[id]/page.tsx`（+19/-4）。React `cache()` 去重 + `generateStaticParams` 改为 `[]`。作者自述仅过 typecheck + lint。两个 commit 文件**不重叠**。

- **工作区改动计数——两侧观测不一致，分开列出（迁移基线时点，未含本轮文档提交）**：
  - **Claude 挂载环境观测**：`git status --short` 显示 **263** 个 `M` 文件 + 4 个未跟踪路径（`.claude/`、`docs/nianlife-handoff-2026-09-06-neon.md`、`v2/db-check-tmp.mjs`、`v2/scripts/quark-heic-ingest-linux.mjs`）。`git diff --ignore-all-space --numstat` 核实后，**真实内容变更只有 1 个文件**：`v2/package-lock.json`（+51/-0）。
  - **Windows 本地 Git 观测**（Teddy 提供）：只显示 `M v2/package-lock.json` + 3 个未跟踪文件。
  - **两侧一致的结论**：忽略空白后，真实 diff 仍然只有 `v2/package-lock.json` 一个文件。
  - **两侧计数本身不一致，原因未核实**（推测与 Windows/Linux 两端 `core.autocrlf` 配置不同有关，未去核实 Windows 侧全局 git 配置，仅供参考）。
  - **本轮明确保留、未暂存**：`v2/package-lock.json`、`docs/nianlife-handoff-2026-09-06-neon.md`、`v2/db-check-tmp.mjs`、`v2/scripts/quark-heic-ingest-linux.mjs`——这 4 项与本轮文档同步无关，按 Teddy 要求原样保留在工作区，不进入本次提交。

### 部署触发面（P0-C02，已并入 Teddy 最新控制台状态）
- **仓库内没有 GitHub Actions**：`.github/` 下只有 `copilot-instructions.md` 和 `skills/`，无 `workflows/` 目录。
- `v2/vercel.json` 只有一项配置：`crons: [{ path: "/api/internal/organizer-worker", schedule: "0 3 * * *" }]`（UTC 3 点 = 北京时间 11:00）。仓库根目录无 `vercel.json`。
- `.vercel/project.json` 存在（`projectName: nian-life-journey`），未含凭据。
- `v2/package.json` 的 `build` 就是原生 `next build`，无自定义 postbuild/部署钩子。
- 环境变量**仅记录变量名**（未读取任何值）：`REPOSITORY_BACKEND`、`DATABASE_URL`、`STORAGE_ROOT`、`AUTH_SECRET`、`INGESTION_TOKEN`、`NIANLIFE_INGESTION_URL`、`MEDIA_STORAGE_PROVIDER`、`R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_BUCKET`、`R2_PUBLIC_BASE_URL`、`MEMORY_ORGANIZER`、`AI_ORGANIZER_ENABLED`、`AI_PROVIDER`、`AI_MODEL`、`AI_ORGANIZER_PROMPT_VERSION`、`AI_API_KEY`、`AI_API_BASE_URL`、`GEMINI_API_KEY`、`AI_TIMEOUT_MS`、`AI_ORGANIZER_MAX_IMAGE_INPUTS`、`AI_ORGANIZER_DEBUG`。

**Teddy 提供的控制台实测状态（累计三轮，只记录状态本身，不含任何变量值、密钥、连接串或身份证件号码等资料）**：

| 项目 | 状态 |
|---|---|
| Vercel Production | 仍为 **Paused** |
| **GitHub 仓库连接** | **已断开**——今后 push 不会触发 Vercel 自动部署 |
| Ignored Build Step 命令 | `git cat-file -e "$VERCEL_GIT_PREVIOUS_SHA" 2>/dev/null && git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- .` —— 不是部署硬闸；**现在 Git 连接已断开，这条命令已不适用（没有 push 事件可以触发它了）**，仅作历史记录保留 |
| **Vercel Authentication** | **已开启，使用 Standard Protection**——即使将来 Production 恢复，访问部署也需要经过这层认证，是独立于 Pause 状态之外的另一层访问控制 |
| Neon 集成环境变量 | 同时覆盖 Production 和 Preview |
| **Vercel Cron 总开关** | **已 Disabled**；`/api/internal/organizer-worker` 的调度配置**仍保留在 `vercel.json` 里，尚未随代码一起适配为 ECS 下的定时任务，属于迁移时必须完成的项目，不是"已经处理好、可以忽略"** |
| Neon 计费计划 | 保持 **Launch**（Teddy 明确决定：不降级、不删除项目、不旋转凭据） |
| Neon PostgreSQL 版本 | **18** |
| Neon compute 规格 | **0.25 CU**（固定，非区间） |
| Neon 数据库服务 | **Enabled** |
| Neon endpoint 状态（截图时点） | **INACTIVE**——不能表述为 compute 正在运行，也不代表数据库不可访问 |
| 当前计费周期 | 2026-09-06 至 2026-10-01 |
| 本周期用量（截图时点） | compute 0.01 CU-hours；storage 151.13 MB；history 1.77 MB；network transfer **0 kB** |
| **ECS** | **已购买**，规格见第 1.1 节 |

- **只能在 Vercel 控制台确认、本轮仍未获取的状态**：最近几次部署的真实 Ready/Error 状态、Production 别名具体指向哪个构建、环境变量在 Production/Preview 的实际取值分布（只问过是否覆盖，未读值，也不建议读值）。

### 1.1 ECS 采购信息（本轮新增，Teddy 提供）

**只记录规格与计费方式，不记录实例 ID、公网 IP、密钥对名称、私钥、备案手机号或任何身份材料**：

| 项目 | 值 |
|---|---|
| 地域 | 杭州 |
| 计费方式 | 包年包月，半年 |
| 规格 | 2 vCPU / 4 GiB |
| 系统盘 | ESSD Entry 40 GiB |
| 公网带宽 | 固定公网带宽 3 Mbps |
| 操作系统 | Ubuntu 24.04 |
| 自动续费 | 已关闭 |

- 这份规格表用于第 5 节"Phase 1 前置条件"和第 10 节任务卡的成本/容量核对，**不构成对备案资格的自动确认**——备案资格仍以第 9 节的域名/身份合规性确认为准。

### 迁移兼容性清单（P0-C03）
- Next.js `^15.5.24` + React `19.1.0` + TypeScript `^5`，无 `engines` 字段锁定 Node 版本。
- **Web 运行时的数据库驱动是标准 `pg`（node-postgres）+ `drizzle-orm/node-postgres`**（`lib/db/client.ts`），非 Neon 专有驱动，`package.json` 里也没有任何 `@neondatabase/*` 依赖。**这条结论只覆盖 Next.js 应用本身这一条连接路径，不覆盖脚本层。**
- **媒体存储的 R2 耦合不止 `lib/storage/hot-storage.ts` 一个文件**：`scripts/quark-heic-ingest-direct.mjs`、`scripts/quark-heic-ingest-linux.mjs`、`scripts/quark-heic-ingest.mjs`、`scripts/quark-history-init.mjs`、`scripts/quark-photo-init.mjs`、`scripts/quark-repair-derivatives.mjs`、`scripts/quark-smoke-r2.mjs`、`tools/quark-connector/apply-artifact.ts` 都直接引用 R2 相关环境变量/endpoint。媒体迁移是一整条 Quark/HEIC 入库脚本链路，不是改一个文件。
- **Vercel Cron 仍归入"迁移时必须替换或停用"**：`/api/internal/organizer-worker` 的调度配置**目前总开关已 Disabled、不会运行**，但配置本身仍写在 `vercel.json` 里——迁到 ECS 后这段配置不会随之生效，目标方案是默认关闭、与 Web 容器隔离的独立定时任务（系统 crontab 或独立进程），迁移时必须显式替换或停用，不能假设"不启用就等于已经处理好了"。
- **脚本层存在 Neon 专有的硬编码模式，与 Web 运行时无关，需单独复核**：
  - `ssl: { rejectUnauthorized: false }` 在 `scripts/`、`lib/`、`test/` 下共 **48** 个文件出现（抽查确认至少 3 处是真实连接配置）：`scripts/nianlife-worker.mjs:362`、`scripts/organizer-month-write.mjs:135`、`scripts/deepseek-family-writer.mjs:74`。
  - `DATABASE_URL_UNPOOLED`/`_UNPOOLED` 相关逻辑出现在 **10** 个脚本，其中 `scripts/wechat-import-all.mjs:77-79` 还有针对 Neon pooler 域名的显式字符串判断。
  - 阿里云 RDS 没有"pooler"端点概念，这段逻辑迁移后大概率是死代码，**但应逐个复核后决定保留/清理/改写，不建议批量替换或删除**（本仓库历史上因批量操作出过至少两次事故）。
- **ECS 自托管新增的基础设施工作量**：容器化、反向代理、健康检查、发布/回滚流程、Worker 与 Web 进程隔离、媒体停用/止损开关（**目前代码里没有任何"媒体停用"机制，是新开发项**）。ECS 本身已完成采购（见 1.1 节），但上述工作量不因"机器已经买了"而减少。
- Sharp 使用面很小，只在两个文件：`lib/ingest/wechat-snapshot.ts`、`lib/media/processing.ts`。
- `next.config.ts` 使用 Next 内置图片优化，依赖自托管 `next start` 时本机 sharp 可用。
- AI Organizer 走 DeepSeek 外部 API，迁移后 ECS 需要能访问该 API 的出站网络。
- 没有 `middleware.ts`，代码里也没有任何"维护模式"实现（详见第 8 节）。
- `REPOSITORY_BACKEND` 未设置时默认 `"json"`、`MEDIA_STORAGE_PROVIDER` 不是 `"r2"` 时退回本地存储——理论可能性，**未经实际构建/运行验证**。

三类清单：

| 分类 | 项目 |
|---|---|
| **必须适配** | 媒体存储 provider（不止 `hot-storage.ts`，还有 8 个 Quark/HEIC 相关脚本硬编码 R2）；部署方式（Vercel Git 集成 → 已改为 main-only + 人工审批发布，见第 1.2 节，容器/发布流程本身仍需在 ECS 上从零搭建）；**Vercel Cron（`/api/internal/organizer-worker`）——配置仍在 `vercel.json` 里，总开关虽已 Disabled，迁移时仍必须显式替换为默认关闭、与 Web 容器隔离的独立定时任务或系统定时器，不能沿用 `vercel.json` 的调度机制**；ECS 自托管新增的容器化、反向代理、健康检查、发布流程、Worker 隔离、媒体停用措施 |
| **需要复核（不建议批量改）** | 脚本层的 `ssl.rejectUnauthorized=false`（48 个文件）与 Neon pooled/unpooled 判断逻辑（10 个脚本）——大概率是死代码但需逐个确认 |
| **需要验证** | Sharp/libvips 在目标 Linux 发行版上的 HEIC 支持；Next.js 自托管后的内置图片优化与磁盘缓存；`contributors` 全表读在真实数据量下的行为；Postgres 扩展在阿里云 RDS 对应版本上的兼容性（版本号本身已确认）；`REPOSITORY_BACKEND=json`/无 R2 配置下应用能否干净启动 |
| **可以保持不变** | Web 运行时数据库驱动（标准 `pg`/node-postgres，非 Neon 专有，仅限 `v2/lib/db/client.ts` 这条路径）；ORM 层（drizzle-orm 标准 postgresql dialect）；应用代码整体架构 |

### 1.2 Git / 发布工作方式定稿（本轮新增，已同步进 `AGENTS.md`）

Teddy 本轮正式确定，并已写入仓库 `AGENTS.md` 的"开发规则"：

- 只使用 `main`，不创建功能分支，不搭建长期 Preview 环境。
- 长期运行环境只有 production；不存在独立的 Preview/Staging 长期环境。
- 本地类型检查、Lint、测试和构建通过后，才提交并 push `main`。
- push 不会触发自动部署；生产部署必须经人工批准，并由人工手动执行，每次发布记录 commit SHA 和回滚点。
- 保留历史记录、儿童/家庭敏感数据处理规则、媒体授权要求、V1/V2 边界、发布前检查清单——这些既有规则本轮未改动，`AGENTS.md` 中原样保留。

这条定稿使第 4 节此前"Git/Vercel 集成仍在"的风险描述彻底失效——不是"风险已缓解"，而是**迁移期间的发布方式本身已经不再依赖 Vercel Git 集成**，无论未来是否重新连接 Vercel，仓库层面的默认工作方式都是 main-only + 人工发布。

---

## 2. 待 Teddy 控制台确认（已大部分解决，剩余项见下）

1. ~~Vercel：Ignored Build Step 内容、Neon 计划、Cron 状态、Git 连接状态、Authentication 状态~~ ——**已由 Teddy 提供，见第 1 节表格**。
2. 仍未获取：Vercel 最近几次部署的真实 Ready/Error 状态、Production 别名具体指向哪个构建、环境变量在 Production/Preview 的实际取值分布。
3. 备案地区/主体/域名情况/网站备案名称——已由 Teddy 确认，见第 9 节。

---

## 3. 资料之间的冲突（Neon 计划与 PostgreSQL 版本已解决，本轮无新增冲突）

1. **Neon 当前计划与状态——已解决**：Teddy 控制台实测确认当前为 **Launch 计划**且明确决定维持 Launch、不降级、不删除、不旋转凭据。`docs/STATE.md` 此前"已降级 Free"的记录与实测不符，具体原因未核实，仅记录当前实测结果。
2. **迁移计划引用的源文件缺失**：`nianlife-migration-plan-v1.md` 在 Downloads 中未找到，只有 v2。仍未解决。
3. **未提交改动的规模计数**：见第 1 节"两侧观测不一致"，维持分开记录。
4. **PostgreSQL 版本——已解决**：Teddy 控制台实测确认 Neon 引擎版本为 **18**，与交接资料一致。

---

## 4. 当前风险（本轮更新：Git 发布风险已从"缓解"变为"结构性解除"）

- ~~**Git/Vercel 集成仍在，存在意外触发构建的持续风险**~~ ——**已解除**：GitHub 与 Vercel 的连接已由 Teddy 确认断开，且发布方式已改为 main-only + 人工审批发布（见第 1.2 节），不再依赖 Vercel Git 集成本身是否重新连接。
- ~~**Vercel Cron 仍是 Enabled 状态**~~ ——**已缓解，但配置迁移仍未完成**：Cron 总开关已 Disabled，`/api/internal/organizer-worker` 不会运行；但配置仍在 `vercel.json` 里，**迁移到 ECS 时仍需显式处理**（不能假设"disable 一次就永远不用管"）。
- **Neon endpoint 是否处于 INACTIVE 会随连接动态变化**：一旦有新连接会自动唤醒；本周期（9/6–10/1）此前的用量快照是网络传输 0 kB，只是一个时点快照，不代表问题已经解决或不会再发生。**Phase 2 备份一旦执行，会主动建立连接、产生真实的（但预计很小的）用量**，见 `docs/nianlife-P2-backup-execution-2026-09-07.md`。
- **媒体存储迁移的实际工作量比"改一个文件"大得多**：涉及 hot-storage.ts 之外的 8 个 Quark/HEIC 脚本，且 OSS 分支目前完全不存在。
- **脚本层 48 处 SSL 校验关闭 + 10 处 pooled/unpooled 硬编码**：需要人工逐个复核，不建议批量处理。
- **ECS 自托管的运维基础设施全部是新开发项**：机器本身已采购（见 1.1 节），但容器化、发布流程、健康检查等都还没有开始，不能按"配置一下就好"估算工作量。
- **HEIC/Sharp 在目标平台的行为未知**。
- **`a04d8d2`/`94ea000` 两个修复均未经真实构建/真实数据库验证**。
- **"迁移期间保持可访问"如果选错方案，可能重演本项目已发生过两次的"以为是静态其实还在连库/以为部署好了其实没生效"事故模式**。

---

## 5. Phase 1 前置条件

- 备案主体/省份/域名/名称——**已由 Teddy 确认，见第 9 节，条件已满足**。
- ECS——**已采购，见第 1.1 节**；预算原则（选择满足可靠性要求的最小规格；采购前列明首付、续费价和全部按量项目）已在采购时执行，具体金额本文档不记录，由 Teddy 自行留存账单。
- 媒体交付方式取舍（私有 OSS 直读+签名 vs ECS 经内网读取由 Nginx 交付）需要在 C4 开发前定死。
- Phase 2（源系统冻结与备份）：**执行方案已成文（`docs/nianlife-P2-backup-execution-2026-09-07.md`），仍待总指挥审核批准，未连接/导出生产数据库**。
- 迁移期间是否保持网站可访问：方案比较已完成（第 8 节），未部署。

---

## 6. 建议任务顺序

1. 总指挥审核 `docs/nianlife-P2-backup-execution-2026-09-07.md`，批准后才允许连接 Neon 执行备份。
2. 在此基础上，推进 P1-01 备案资料的实际提交（资质前置条件已满足，材料由 Teddy／苏静直接在阿里云备案系统填写，不经本 Session）。
3. 媒体交付方式取舍拍板后，再让 Claude Code 设计 C4（OSS 适配）分支，范围包含 `hot-storage.ts` 之外的 8 个脚本。
4. Phase 2 备份执行、验证通过后，再在 ECS 上开始容器化/发布流程等新开发项（第 4 节所列）。
5. 迁移期间静态可用方案（第 8 节）如果 Teddy 决定推进，按第 10 节任务卡边界执行（只比较不部署）。
6. `a04d8d2`/`94ea000` 建议保持本地不推送，由 Teddy 按既定流程决定何时处理——不属于迁移范畴。

---

## 7. 本轮执行过的操作和明确未执行的生产操作

**本轮（2026-09-07）执行过的**：
- 记录 Teddy 提供的 ECS 采购规格（第 1.1 节）——仅规格与计费方式，未记录实例 ID、公网 IP、密钥对名称、私钥、备案手机号或身份材料。
- 记录 Teddy 确定的 Git / 发布工作方式（第 1.2 节），并**据此编辑了仓库 `AGENTS.md`**（用二进制安全方式替换"开发规则"中的分支/Preview 表述，保留原有 CRLF 换行符与其余全部条款不变）。
- 新增独立完整的 Phase 2 执行方案文件 `docs/nianlife-P2-backup-execution-2026-09-07.md`（含可逐条执行的命令模板，仍未运行任何一步）。
- 更新本报告并同步写入三处：仓库 `docs/nianlife-P0-report-2026-09-06.md`、`C:\Users\teddy\Downloads\nianlife-P0-report-2026-09-06.md`、项目文档 `claude/nianlife-P0-report-2026-09-06.md`。
- **精确暂存并提交** `AGENTS.md`、`docs/nianlife-P0-report-2026-09-06.md`、`docs/nianlife-P2-backup-execution-2026-09-07.md` 三个文件，**push 到 `origin/main`**——提交前逐一核对 `git status`/`git diff --cached --name-only`，确认未暂存 `v2/package-lock.json`、`docs/nianlife-handoff-2026-09-06-neon.md`、`v2/db-check-tmp.mjs`、`v2/scripts/quark-heic-ingest-linux.mjs` 及其余无关改动。commit SHA、push 结果、`git status --short --branch` 的最终结果已在本轮对话中单独回复 Teddy（不重复写入本文件，避免自我引用）。

**明确未执行的**：
- 未连接 Neon、未运行任何 `pg_dump`/查询/迁移/importer/Organizer/worker。
- 未访问 `nianlife.cn`。
- 未运行任何 Vercel CLI 操作。
- 未记录任何环境变量值、项目密钥、连接串、实例 ID、公网 IP、身份证号码或其他身份资料。
- 未购买 RDS/OSS，未部署任何静态维护页，未开始任何代码改造（容器化、媒体存储适配、Cron 替换等均未开始）。

---

## 8. 补充任务 P0-C05：迁移期间静态可用方案评估

### 8.1 现有代码能否"零依赖"运行（只读代码核查，未构建验证）
- `REPOSITORY_BACKEND` 未设置时默认 `"json"`，不需要 `DATABASE_URL`；`MEDIA_STORAGE_PROVIDER !== "r2"` 时回退本地存储，不连 R2。
- 但没有 `middleware.ts`，代码里也没有任何"维护模式"实现——实际结果是"数据为空的正常页面"而非"维护中"提示，且未经构建验证。
- Cron（`/api/internal/organizer-worker`）配置仍在 `vercel.json` 里，**总开关目前已 Disabled**——迁移期间的静态维护方案即便复用现有 Vercel 项目，也不依赖这条 Cron 是否运行来判断安全性，仍应确保新构建不带着这段配置一起生效。

### 8.2 Vercel Pause 的确切机制（已用官方文档核实，并与 Teddy 实测互相印证）
- 暂停位置：Settings → General → "Pause Project"。恢复：同页 "Resume Project"，立即生效、不需要重新部署。
- **暂停期间访客看到的是 Vercel 自己的通用 503 `DEPLOYMENT_PAUSED` 错误页，不是可自定义内容的维护页**。
- 此前"push 后是否仍触发构建"的疑问已因 Git 连接断开而失去现实意义——没有 push 事件，也就没有构建触发。

### 8.3 两个最小方案比较

**方案 A：现有 Vercel 项目改造为静态维护页**
- 需要真正的代码/配置改动，不是一个开关。直接点 Pause 不满足"体面维护页"预期。
- 优点：域名/DNS 不需要改动。
- 结论：看起来"复用现有项目"更简单，实际要保证零费用风险，工作量和确定性都不如方案 B。

**方案 B：独立静态托管维护页**
- 在一个全新的、与当前代码库/环境变量/Cron 完全无关的地方部署一个不带任何后端逻辑的纯 HTML 页面。
- 费用风险表述：**不连接数据库且费用风险很低；免费额度、部署触发规则和中国内地可访问性仍需验证。**
- 缺点：需要一次临时 DNS 切换，比方案 A 多一轮 DNS 生效等待（可与备案等待期重叠）。
- 备案注意：若托管仍是境外/非大陆节点，与现状一致，不新增备案义务；若误选大陆节点则会撞上"未备案不得对公网开放"的红线——本轮未做进一步核实。

### 8.4 推荐
**推荐方案 B**，理由不变：费用风险优先于实现简单这一前提下，方案 A 需要的"确保零残留动态调用"工作量和本项目的踩坑历史都不支持它是真的"简单"。方案 B **不连接生产数据库或应用后端，费用风险很低；托管平台本身仍受免费额度、计费条款和可访问性限制**。**本轮只完成方案比较，未部署，见第 10 节任务卡边界。**

---

## 9. Phase 0 补充信息与备案确认（Teddy 提供，原样记录）

- **备案主体确定为苏静个人，浙江省**。
- **域名合规性确认**：域名实名信息与苏静当前身份证一致；域名与身份证的有效期均满足备案要求；身份证地址在浙江（与备案地区一致）。——本报告只记录这几条"是否满足要求"的结论，**不记录身份证号码、具体地址、具体到期日期等证件细节**。
- `nianlife.cn` 域名注册商为腾讯云（维持现状，不迁移注册商）。
- **网站备案首选名称："岁月拾光册"**。
- 阿里云账号已实名，账号实名人与备案主体可以不同。
- 预算原则：选择满足可靠性要求的最小规格；采购前列明首付、续费价和全部按量项目——**ECS 已按此原则完成采购，见第 1.1 节**。
- 迁移期间可考虑保持网站可访问，前提是没有明显费用风险、实现简单（见第 8 节）。
- 备案环节只输出操作清单，不由本 Session 收集、复制或保存苏静的身份证号码、手机号等个人材料。

---

## 10. Phase 1 任务卡（本轮更新状态列）

| 任务编号 | 内容 | 负责人 | 前置条件 | 允许操作范围 | 交付物 | 验收标准 | 状态 |
|---|---|---|---|---|---|---|---|
| P1-01 | 备案资质提交（苏静个人，浙江省，首次备案，网站名称"岁月拾光册"） | Teddy／苏静 | 身份/域名合规性已确认满足（见第 9 节） | 在阿里云备案系统内自行填写主体信息、证件、联系方式；本 Session 不参与、不留存材料 | 备案申请材料（不进入 Claude 文档或仓库） | 备案系统受理，进入初审 | **资料准备完成，提交动作待 Teddy 操作** |
| P1-02 | 域名维持现状确认 | Teddy | 无 | 确认 `nianlife.cn` 继续由腾讯云管理注册，不发起转移注册商操作 | 域名现状确认记录 | 备案系统对当前注册商无异议 | **已完成** |
| P1-03 | ECS 采购 | Teddy | 备案主体与地域已定（已满足） | 按最小可靠规格采购，包年包月，列明首付/续费/按量项目 | ECS 实例（规格见第 1.1 节，不记录实例 ID/IP/密钥） | Teddy 确认规格与计费方式符合预期 | **已完成采购** |
| P1-04 | RDS PostgreSQL 采购（暂不购买） | — | ECS 已备案受理、Phase 2 备份验证通过 | 无 | 无 | 明确列为"暂不购买" | **未启动** |
| P1-05 | OSS 采购与媒体交付方式选型（暂不购买） | Teddy 拍板取舍 | 媒体交付方式已拍板 | 无 | 无 | 明确列为"暂不购买" | **未启动** |
| P1-06 | 独立静态维护页（迁移期间可访问性） | Claude Code（如决定推进） | Teddy 决定是否采用方案 B | 仅方案比较与草案（已在第 8 节完成），不部署、不切 DNS | 方案比较文档（已交付） | Teddy 认可方案后才进入实施 | 仅完成方案比较，不部署 |
| P1-07 | Phase 2 数据备份执行 | Claude Code（获批后） | **总指挥审核通过 `docs/nianlife-P2-backup-execution-2026-09-07.md`** | 见执行方案文档，未批准前不连接 Neon | 两份验证过的备份 + 核对报告（存放于仓库之外的受控目录） | 见执行方案文档验收标准 | **待总指挥审核，未批准，未执行** |

---

**本报告到此为止。Phase 0 已通过，Git 发布方式已定稿为 main-only + 人工审批（见第 1.2 节），ECS 已采购（见第 1.1 节），Phase 1 前置事项（备案资质）已满足，Phase 2 执行方案见 `docs/nianlife-P2-backup-execution-2026-09-07.md`，经总指挥批准后方可连接 Neon 执行。**
