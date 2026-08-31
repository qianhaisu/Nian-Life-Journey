# Nian Life Journey

给张年（Teddy 的孩子）做的数字人生档案网站。

## V1 / V2 边界

- 根目录 `index.html` 是 V1：历史静态页面和视觉参考，**不要**把它重构成 React 或删除。
- V2 位于 `v2/`，是独立的 Next.js App Router 应用（`basePath: "/v2"`），新功能只在这里做。
- 不要把 V1 的 DOM/CSS 结构当成 V2 的实现基础。

## 技术栈与目录

Next.js 15 + React 19 + TypeScript + Tailwind 4 + Drizzle ORM/PostgreSQL（目标持久化，尚未接入运行时）+ Sharp + AWS S3 SDK（R2）。

- `v2/app`：页面、Server Action、Route Handler
- `v2/lib/db`：Repository（当前实际是 JSON 文件存储，见下）
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
- 幂等键固定：`(provider="quark", variant="original", providerRef=fid)`，不可更改。
- artifact 导入默认 dry-run；不自动登录、上传、移动或删除网盘文件。
- WorkBuddy 运行时目录（`workbuddy/storage/`、Quark `search-results/`）已在 `.gitignore` 覆盖；artifact 路径校验已加固，拒绝经由 symlink 或 Windows junction/reparse point 到达的文件。
- Quark 的 `fid` 是否长期稳定，目前正在另一个 Session 中重新验证，尚无定论；不要在文档或代码注释中把"`fid` 永久稳定"当作既定事实来写，以该 Session 的最终结论为准。

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

- Teddy 说"commit"时，默认包含 commit 后正常 push 当前功能分支。
- 功能切片完成且全部验证通过后，默认继续合并到 main 并正常 push main。
- 不需要为普通 commit、push 功能分支、merge main、push main 反复询问。
- main push 触发 Vercel 自动部署属于正常结果。
- 合并前必须更新 main，并在合并后重新运行完整验证。
- 保留有意义的提交历史，不默认 squash/rebase。
- 不 force push。
- 不擅自删除远端分支。
- 不把不相关改动混入提交。

只有以下操作需要 Teddy 单独确认：

- force push 或改写历史
- 删除分支、文件或数据
- 运行生产数据库 migration
- 修改生产环境变量或密钥
- 手动部署、回滚生产
- 调用会产生明显费用的外部 API
- 无法确定正确处理方式的实质性业务冲突

### 开发执行方式

- 如果实现方式明确，直接修改、验证、commit、push、merge main。
- 不要先完成一轮只读审计后，又为显而易见的修改重复询问。
- 只有存在真正影响产品行为、数据模型或迁移路线的歧义时才找 Teddy。
- 可以使用 Sonnet subagent，但 Teddy 是普通 Pro 用户：
  - 默认主 Agent 完成
  - 最多 2 个 subagent
  - 不重复遍历相同代码
  - 不为简单任务启用 subagent
  - 不默认使用 Opus

### 分支与 Worktree

项目统一使用单一 worktree：`C:\Users\teddy\Documents\Nianlife`。

- 默认只使用这一个 worktree，不再创建 `main-focus`、`postgres-foundation` 或其他额外 worktree。
- 未经 Teddy 明确要求，不得执行 `git worktree add`。
- 空闲状态保持在 `main`，并同步 `origin/main`。
- 从最新 `main` 拉功能分支，在当前目录（同一个 worktree）创建普通 feature branch，不直接改 `main`。
- 功能完成、验证通过、合并 main 并 push 后，切回 `main`。
- 看到当前目录仍在功能分支，不代表该功能没有进入 main；必须通过 Git ancestry、main HEAD 和远端状态判断是否已合并。
- 多个 Session 可以并行做只读规划（阅读、分析、只读命令），但同一时间只能有一个 Session 对仓库做写操作（改文件、commit、push、merge）。开始写操作前确认没有其他 Session 正在改动仓库。

### 稳定项目边界

继续保留本文件中原有的稳定边界，不因为上面的“默认执行”规则而放松，例如：

- V1 `index.html` 不删除、不重构（见「V1 / V2 边界」）。
- Quark CLI 只能由 WorkBuddy 调用（见「WorkBuddy / Quark 边界」）。
- 不提交凭据和 WorkBuddy 运行时文件。
- 不删除现有路径、Schema、Policy 和幂等保护。
- 修改后运行与改动范围匹配的 typecheck、test、lint、build 和 diff check（见「常用验证命令」），而不是每次都跑全套或完全不验证。

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

这两份文档记录的是某一时刻的快照，读之前先用 `git status` 核实是否仍然成立。
