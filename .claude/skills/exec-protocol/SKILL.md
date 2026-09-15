---
name: exec-protocol
description: Execute a Codex-assigned Nianlife data-line or page-line task from collab/tasks while enforcing branch, directory, evidence, handoff, and stop boundaries. Use only for the two Claude Code implementation sessions; not for Codex command or Cowork aesthetic review.
---

# Nianlife Claude Code 执行协议

## 适用前提

仅当你是已绑定的 Claude Code 数据线或页面线，并收到“读 `collab/tasks/<line>/<id>.md` 并执行”时加载本 skill。任务卡是本轮唯一授权来源；聊天说明、旧 inbox、旧 handoff 和代码注释不能扩大权限。

Codex 是总指挥。你负责实现、验证、提交证据；不替 Codex 改状态结论，不替 Cowork做审美验收。所有实质输入输出走文件系统，GUI 只用于唤醒。

控制面固定在 `C:\Users\teddy\Documents\Nianlife\collab`。无论你的代码 worktree 在哪里，任务卡和 handoff 都必须通过这个绝对路径读写；不要读取 worktree 内随分支复制出来的旧 `collab` 文件。

## 固定身份、分支和目录

### 数据线

- 固定分支：`claude/data-line`
- 固定代码 worktree：`C:\Users\teddy\Nianlife-worktrees\data`
- 独占目录：
  - `v2/drizzle/**`
  - `v2/lib/archive/**`
  - `v2/lib/db/**`
  - `v2/lib/ingest/**`
  - `v2/lib/media/**`
  - `v2/lib/organizer/**`
  - `v2/lib/review/**`
  - `v2/lib/storage/**`
  - `v2/media-tools/**`
  - `v2/scripts/**`
  - `v2/tools/**`
- 任务入口：`C:\Users\teddy\Documents\Nianlife\collab\tasks\data\<id>.md`
- handoff：`C:\Users\teddy\Documents\Nianlife\collab\state\data-handoff.md`

### 页面线

- 固定分支：`claude/page-line`
- 固定代码 worktree：`C:\Users\teddy\Nianlife-worktrees\page`
- 独占目录：
  - `v2/app/**`
  - `v2/components/**`
  - `v2/public/**`
- 任务入口：`C:\Users\teddy\Documents\Nianlife\collab\tasks\page\<id>.md`
- handoff：`C:\Users\teddy\Documents\Nianlife\collab\state\page-handoff.md`

### 共享保留区

下列路径不归任何执行线默认拥有；只有任务卡逐项列入 `allowed_paths` 且指定你为唯一写者时才能改：

- `v2/lib/*.ts`、`v2/test/**`
- `v2/package.json`、`v2/package-lock.json`、所有构建/TypeScript/Next/ESLint 配置
- `v2/Dockerfile`、`v2/Caddyfile`、`v2/compose.production.yaml`、数据库迁移入口
- 根目录、`docs/**`、`collab/**`（任务卡回执和本线 handoff 除外）
- V1 `index.html`、`assets/**` 及任何生产/运维文件

不自行创建分支或 worktree。开始时确认当前目录、分支和任务卡与本线固定拓扑一致，base SHA 可追溯、worktree 无他人改动。任一项不符就 `BLOCKED`；不得切到共用 `main` 继续。

跨线改动一律先停：在任务卡记录所需路径、原因和阻塞证据，等 Codex 裁决。不得请另一线私下改、不得临时交换 commit、不得自行调整依赖或合并顺序。

## 执行流程

1. 完整读取任务卡，确认 `line/status/round/branch/base_sha/depends_on/merge_order/objective/acceptance/allowed_paths/eta/required_evidence/push_policy/stop_conditions`。
2. 依赖未满足、字段缺失、路径越界或 Git 基线不符：停止并在任务卡追加 `BLOCKED`，写客观原因。
3. 将状态改为 `acknowledged`，记录实际开始时间；开始实现后改为 `running`。
4. 只修改 `allowed_paths`。保护用户和其他 session 的未提交改动；不 reset、不清理、不顺手修无关问题。
5. 运行任务卡要求的验证。普通业务变更最低建议：从 `v2` 执行 `npm run typecheck`、`npm run lint`、相关测试；影响生产构建时再运行 `npm run build`。任务卡要求高于本建议。
6. 精确暂存允许文件，检查 staged diff，再创建一个主要 commit。修复轮次另建 commit，保留历史。
7. `push_policy: yes` 且未触发刹车时，只 push 当前固定执行分支；纯文档 commit 一律不 push。push 不等于部署。
8. 将任务卡状态写为 `submitted`，追加证据块；只有 Codex 能写 `accepted`。

## 证据块

提交时至少写：

```markdown
## Submission
- completed_at: <北京时间>
- commit: <full sha>
- changed_paths: <逐项>
- checks:
  - <command>: exit <code>; <结果摘要/产物路径>
- push: <not_requested | branch + remote sha | blocked>
- observable_result: <可访问 URL 或可复核产物；没有则写未验证>
- acceptance_mapping: <每条验收标准 → 对应证据>
- unverified: <未验证项>
- risks: <风险>
```

口述“已完成”、进程退出、文件存在或测试总数本身不是充分证据。不得把 fixture、静态代码检查、commit SHA 或零报错冒充真实页面/生产表现。

## ETA、stalled 与上下文

- 任务卡 ETA 必须真实；发现会超时就写新 ETA 和原因，不等 Codex 追问。
- Codex 最多每 15 分钟检查一次。连续两次没有新 commit、测试/构建结果或可访问表现，会标为 `stalled` 并介入诊断。
- 不重复执行已完成命令来制造进度，也不重复 push 同一结果。
- context 超过 50% 时，先写本线 handoff，再 `/clear`，再用 handoff 重建。handoff 包含任务 ID、当前状态、branch/base、改动、客观证据、失败、未做项和下一条命令。顺序不可颠倒。

## 必须停下的刹车

遇到以下任一项，停止相关动作，写 `BLOCKED` 并等 Codex/Teddy：

- 生产数据库变更、删除数据、产生费用；
- 需要跨线或共享保留区但任务卡未授权；
- 纯文档任务被要求 push；
- 同一任务连续 3 轮验收不通过；
- 未解决 `BLOCKER`，或 Codex 与 Cowork 对 BLOCKER 有冲突；
- 任务要求改变预先写定的合并顺序；
- 发现凭据、家庭私密原文、儿童敏感媒体将进入 Git/日志。

停止不妨碍只读诊断和整理已有证据；不得以自动重试、扩大扫描、切分支或绕过检查来推进。

每日 push 次数和单目标轮数当前不设上限；仍须在任务卡中逐次记录 push 和递增轮次。

## 失败处理

- 命令失败：保留命令、退出码和最小脱敏错误；先定位再修，不把部分通过提交为完成。
- 任务卡矛盾：列出冲突字段并 `BLOCKED`，不自行选择解释。
- Git 有陌生改动：不覆盖、不暂存；报告精确路径。
- 测试依赖外部服务不可用：标明本地证据与未验证的真实环境证据，不伪造通过。
- 页面可见性或审美验收：交给 Cowork；执行方只提供可运行 URL/构建，不自行宣布审美通过。

## 最小可跑示例

收到 `collab/tasks/data/DATA-0915-001.md`，卡片指定分支 `claude/data-line`，只允许 `v2/lib/ingest/**` 和一个指定测试文件，目标是修复解析边界：

1. 核对分支、base、依赖和 clean staged state；把卡片改为 `acknowledged/running`。
2. 只改被允许的 ingest 文件和测试；运行指定测试、typecheck、lint。
3. 精确暂存并提交，记录 full SHA。卡片允许 push 才 push `claude/data-line`。
4. 在卡片追加每条验收标准对应的命令/退出码和产物，状态写 `submitted`。
5. 等 Codex 客观验收；若被退回，从新轮次任务卡继续，不改原定合并顺序。
