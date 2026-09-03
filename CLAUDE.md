# Nian Life Journey

给张年（Teddy 的孩子）做的数字人生档案网站。

## V1 / V2 边界

- 根目录 `index.html` 是 V1：历史静态页面和视觉参考，**不要**把它重构成 React 或删除。
- V2 位于 `v2/`，是独立的 Next.js App Router 应用，生产站直接运行在根路径（nianlife.cn），新功能只在这里做。
- 不要把 V1 的 DOM/CSS 结构当成 V2 的实现基础。

## 技术栈与目录

Next.js 15 + React 19 + TypeScript + Tailwind 4 + Drizzle ORM/PostgreSQL（Neon，已在运行时接入）+ Sharp + AWS S3 SDK（R2）。

- `v2/app`：页面、Server Action、Route Handler
- `v2/lib/db`：Repository（默认走 PostgreSQL，JSON file store 保留仅供本地无凭据开发）
- `v2/lib/organizer`：Rule/AI Organizer（`MEMORY_ORGANIZER`/`AI_ORGANIZER_ENABLED` 默认关闭，走 RuleBased；AI 路径启用后，Gemini provider 缺省用 V2 Prompt/Schema 契约，OpenAI-compatible provider 仍用 V1）
- `v2/lib/ingest`、`v2/tools/quark-connector`：Quark/WorkBuddy artifact 边界
- `v2/lib/media`、`v2/lib/storage`、`v2/lib/archive`：媒体派生与存储

## 隐私与安全红线

- 儿童照片、视频、健康记录、家庭信息一律按敏感数据处理；不臆造、不外泄、不发布未经许可的内容。
- 不读取、复制或打印 `.env`、Token、Cookie、Quark 凭据。
- 媒体走 repository/object-storage 策略，禁止用临时外链（如 `big_thumbnail`/`check_link`）当永久地址。

## WorkBuddy / Quark 边界

- Quark CLI 只能由 WorkBuddy 调用；`QuarkCliAdapter` 抛 `QUARK_CAPABILITY_UNSUPPORTED` 是设计，不是 bug。
- Nianlife 只消费 WorkBuddy 产出的 Quark JSONL artifact，走 `v2/lib/ingest/quark-artifact*.ts`。
- artifact 导入默认 dry-run；不自动登录、上传、移动或删除网盘文件。
- WorkBuddy 运行时目录（`workbuddy/storage/`、Quark `search-results/`）已在 `.gitignore` 覆盖；artifact 路径校验已加固，拒绝经由 symlink 或 Windows junction/reparse point 到达的文件。
- **`fid` 已验证为不稳定，结论已定**：对完全相同的搜索重复执行两次，两次返回的文件名集合相同，但 `fid` 交集为 0。因此 `fid`、`check_link`、Quark 路径只是单次任务期下载引用，绝不能作为永久媒体身份或跨任务幂等键；原始文件内容的 SHA-256 才是永久身份，服务端持久化前必须独立重算并核对 SHA-256。`(provider="quark", variant="original", providerRef=fid)` 仅适用于 dry-run 的 artifact-metadata-only 路径（`quark-artifact-asset.ts`，同一任务内单次运行），不是跨任务的永久幂等键；真正下载原图并入库的路径（见 `v2/scripts/quark-photo-init.mjs`）以 SHA-256 派生的确定性 id 去重，而不是 fid。

## 产品原则（P2 必读）

任何 P2 及之后的产品、UI、UX、信息架构工作，动手前必须先读 [`docs/nianlife-product-principles.md`](docs/nianlife-product-principles.md) 并以它为准。原则只在那份文档里维护，本文件不复述。

## AI Organizer 架构方向

Gemini V2 的语义方向已用真实评测验证（Schema/Policy 叙事泄漏问题已解决），但真实响应延迟不稳定，同一请求在不同时刻可能是几秒也可能超过 30 秒。当前 Capture 链路仍是同步调用、同步 fallback。生产化时应把 AI Organizer 改成基于 PostgreSQL/job/outbox 的异步任务，让用户上传不必等待模型返回；不要通过继续调大同步 `AI_TIMEOUT_MS` 来掩盖这个问题。

## Teddy 的长期开发规则

### 当前产品优先级

Nianlife 当前按单用户个人项目开发，功能优先。

现阶段不做，也不反复提醒：

- 登录和认证
- User/Account/Session
- Family/Household/Membership
- 角色与权限
- visibility policy
- 数据安全体系
- 审计、导出、账号删除
- 为未来多用户提前进行复杂设计

当前主线顺序：

1. PostgreSQL 正式 Repository
2. AI Organizer 异步任务
3. Quark/WorkBuddy 初始化与持续导入
4. 其他核心产品功能
5. 核心功能完成后再考虑登录和安全

现有安全防护不要主动删除，但不要让新增安全建设阻塞当前开发。

### Git 长期授权

Teddy 的默认 Git 习惯：

- 不再新建分支（feature branch）或 worktree；直接在 `main` 上开发、commit、push。
- Teddy 说"commit"时，默认包含 commit 后正常 push `main`。
- 不需要为普通 commit、push main 反复询问。
- main push 触发 Vercel 自动部署属于正常结果。
- 保留有意义的提交历史，不默认 squash/rebase。
- 不 force push。
- 不擅自删除远端分支。
- 不把不相关改动混入提交。

只有以下操作需要 Teddy 单独确认：

- force push 或改写历史
- 删除分支、文件或数据
- drop 整个数据库，或不可恢复地删除现有业务记录（见下方「Neon/PostgreSQL」，普通 migration 不在此列）
- 修改生产环境变量或密钥
- 手动部署、回滚生产
- 调用会产生明显费用的外部 API
- 无法确定正确处理方式的实质性业务冲突

### 开发执行方式

- 如果实现方式明确，直接修改、验证、commit、push main。
- 不要先完成一轮只读审计后，又为显而易见的修改重复询问。
- 只有存在真正影响产品行为、数据模型或迁移路线的歧义时才找 Teddy。
- 可以使用 Sonnet subagent，但 Teddy 是普通 Pro 用户：
  - 默认主 Agent 完成
  - 最多 2 个 subagent
  - 不重复遍历相同代码
  - 不为简单任务启用 subagent
  - 不默认使用 Opus

### 分支与 Worktree

项目统一使用单一 worktree、单一分支：`C:\Users\teddy\Documents\Nianlife`，始终在 `main` 上。

- 只使用这一个 worktree，不再创建 `main-focus`、`postgres-foundation` 或其他额外 worktree；未经 Teddy 明确要求，不得执行 `git worktree add`。
- 不再新建 feature branch；直接在 `main` 上开发、commit、push，与 `origin/main` 保持同步。
- 多个 Session 可以并行做只读规划（阅读、分析、只读命令），但同一时间只能有一个 Session 对仓库做写操作（改文件、commit、push）。开始写操作前确认没有其他 Session 正在改动仓库。

### Neon/PostgreSQL

Nianlife 只有一个 Neon 数据库（integration `neon-citrine-park`），Vercel 里 `DATABASE_URL` 等变量同时挂在 Production 和 Preview 上，两者本来就是同一份连接串——**没有独立的 Development/Test 数据库，也不新建一个**。这个唯一的库同时充当开发库和测试库。

- 不创建新 Neon Project、不建 Neon branch、不建第二个数据库、不要求 Teddy 另配一套连接串。
- 普通建表、加字段、改约束、跑 migration、contract test 写入/清理测试数据，都已经授权，不用因为"这是 Production"就停下来问。
- 测试只清理自己创建的记录，不清空整个库；需要 drop 整个数据库或不可逆删除现有业务记录时才停下来找 Teddy。
- Teddy 可以接受开发期间数据库短暂不可用、migration 期间网站报错——这是单人个人项目当前阶段的正常代价，不必为了避免这个而绕路。

### 稳定项目边界

继续保留本文件中原有的稳定边界，不因为上面的“默认执行”规则而放松，例如：

- V1 `index.html` 不删除、不重构（见「V1 / V2 边界」）。
- Quark CLI 只能由 WorkBuddy 调用（见「WorkBuddy / Quark 边界」）。
- 不提交凭据和 WorkBuddy 运行时文件。
- 不删除现有路径、Schema、Policy 和幂等保护。
- 修改后运行与改动范围匹配的 typecheck、test、lint、build 和 diff check（见「常用验证命令」），而不是每次都跑全套或完全不验证。

## 工程执行质量与状态报告原则

先看真实数据，再看真实调用链，再看真实写入链，最后才设计。不要因为代码存在就认为产品拥有该能力，不要因为测试通过就认为生产走过该路径，不要因为本阶段成功就推断下一阶段已经准备好。

这一节要求的是「Session 自己先核实事实」，不是「多问 Teddy」。核实由 Session 自己完成，不改变上面「开发执行方式」和「Neon/PostgreSQL」里已经给出的授权。

### Ground Truth First

- 设计前先查真实数据、真实文件字节、真实 production call graph、真实 persistence path。
- 代码、接口、类型、测试存在，不等于生产真的走这条路径；先确认调用方，再确认写入方。

### Verify Before Building

- DB 没资产 ≠ 文件不存在。
- 测试通过 ≠ production 已接通。
- dry-run 通过 ≠ Canary 通过。
- fixture 能写 ≠ worker 能写。
- 先用证据证明缺口存在，再为缺口设计方案；不要为想象中的缺口写代码。

### Trace Existing Architecture First

新增 adapter / binder / repository API / worker path 之前，先完整 trace 现有的 entrypoint、写入、transaction、identity、retry、review、provenance，优先复用现有实现，不要在旁边另起一条平行链路。

### Stop on Architectural Blockers

一旦发现任务前提不成立——pipeline 没有 production entrypoint、persistence 不存在、source data 实际缺失、evaluation independence 不成立——立即停止下游工作并报告 blocker。

不得为了「把任务做完」继续跑没有意义的 Shadow / Writer / Canary，也不得降低标准让它通过。

### Proven / Inferred / Unknown

重要结论必须区分「已证明 / 推断 / 未知」，并说明证据来源。禁止把 likely、expected、inferred 写成 confirmed。

### 状态用词必须保守

- TESTS PASS ≠ PRODUCTION READY
- DRY RUN PASS ≠ CANARY READY
- CANARY PASS ≠ CUTOVER READY
- CUTOVER READY ≠ CUTOVER COMPLETE

状态标题必须反映所有已知 blocker；禁止用阶段性胜利掩盖未完成项。

### End-to-End Completion

一项生产能力只有在 entrypoint → business logic → persistence → provenance → review/publication → retry/replay/idempotency → rollback 这条链按任务要求验证之后，才能称为完成。

仅由 script / mock / fixture / evaluation 验证过的能力，必须明确标注为**非 production-complete**。

### Bounded Production Writes

- 写入前 predeclare：exact inputs、expected DB delta、rollback identities。
- 写入后：核对 actual delta、replay、确认 zero unexpected drift。
- actual delta 与预期不符时立即停止，不扩大范围。

### 不要为「完成任务」优化

优先级固定：**correctness > truthfulness > reversibility > architectural coherence > completion speed**。

不得为了让测试变绿、让 Canary 有结果、凑够样本数、输出 READY 或完成原始任务，而降低事实、subject、worthiness、media、review、identity 或 safety 标准。

### 最终报告纪律

最终报告必须写清：

- 本轮证明了什么
- 没证明什么
- 最大的已知 blocker
- 是否存在 production-only / fixture-only / script-only 差异
- 下一个 Gate

如果结论依赖 workaround、raw SQL、临时脚本、mock、placeholder 或 Canary-only path，必须写在状态标题附近，不能藏在正文末尾。

## 本地环境文件永久保护

`v2/.env.local` 是持久本地配置，不是可重新生成的临时文件。

1. 未经 Teddy 针对具体文件明确授权，任何 Session 禁止删除、移动、清空或覆盖：
   - `.env.local`
   - 任意 `.env*`
   - `.vercel`
2. 禁止出现类似操作：
   - `rm -rf .vercel .env.local`
   - `rm -f .env.local`
   - 为测试临时移动或改名 `.env.local`
3. 测试必须通过单进程环境变量覆盖或隔离环境完成，不得操作真实 `.env.local`。
4. `vercel env pull` 禁止直接写入 `.env.local`：
   - 必须先写仓库外临时文件
   - 验证不是空值或 `[SENSITIVE]`
   - Sensitive 变量无法拉取时立即停止，不得覆盖原文件
5. 即使需要重新执行 `vercel link`，也不得删除 `.env.local`。
6. 任何获准的环境文件修改前，必须先在仓库外创建可恢复备份。
7. 禁止在日志、聊天、commit 或终端输出中显示 secret 值。

## 现有改动保护规则

处理任何新任务前先跑 `git status --short --branch`。工作区里已有的改动在未确认其来源和目的前，不得回滚、覆盖、stash 或混入其他提交。

## 常用验证命令

```
cd v2
npm run typecheck
npm test
npm run lint
npm run build
```

不要每次微小改动都跑全套；完成一个切片后再验证。

## 详细交接文档

- [`docs/CLAUDE_CODE_HANDOFF.md`](docs/CLAUDE_CODE_HANDOFF.md) — Nianlife 仓库全面审计（功能状态矩阵、P0-P3 路线图）
- [`docs/WORKBUDDY_NIANLIFE_INTEGRATION_HANDOFF.md`](docs/WORKBUDDY_NIANLIFE_INTEGRATION_HANDOFF.md) — WorkBuddy/Quark 集成契约审计
- [`docs/nianlife-product-aesthetic-ia-audit-2026-09-02.md`](docs/nianlife-product-aesthetic-ia-audit-2026-09-02.md) 与 [`docs/editorial-refactor-plan-2026-09-02.md`](docs/editorial-refactor-plan-2026-09-02.md) — 2026-09-02 产品审查与对应实施计划

以上文档记录的是某一时刻的快照，读之前先用 `git status` 核实是否仍然成立。长期有效的产品原则见上方「产品原则（P2 必读）」。
