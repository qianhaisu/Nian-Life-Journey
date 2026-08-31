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

## 修改、提交与部署纪律

- 从最新 `main` 拉功能分支，不直接改 `main`。
- 超过 3 个文件的改动，先给简短计划，Teddy 确认后再动手。

## 详细交接文档

- [`docs/CLAUDE_CODE_HANDOFF.md`](docs/CLAUDE_CODE_HANDOFF.md) — Nianlife 仓库全面审计（功能状态矩阵、P0-P3 路线图）
- [`docs/WORKBUDDY_NIANLIFE_INTEGRATION_HANDOFF.md`](docs/WORKBUDDY_NIANLIFE_INTEGRATION_HANDOFF.md) — WorkBuddy/Quark 集成契约审计

这两份文档记录的是某一时刻的快照，读之前先用 `git status` 核实是否仍然成立。
