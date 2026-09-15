# Nianlife 四方协作：Codex 指挥手册

生效日：2026-09-15

适用项目：`C:\Users\teddy\Documents\Nianlife`

角色：Teddy、Codex、Claude Code 数据线、Claude Code 页面线、Cowork（Claude）

## 1. 适用前提与刹车

本手册只在以下前提同时成立时使用：

- Codex 只做拆解、派发、验收、合并顺序和状态管理，不写业务代码。
- 两个 Claude Code session 已由 Teddy/Codex 分别绑定到数据线和页面线；它们只从文件系统读任务。
- Cowork 只审渲染结果和产品原则，不派活、不写代码、不改仓库状态文档。
- 实质内容全部经文件传递。computer use 只负责唤醒 session、批准 Cowork 文件夹授权和必要的运行态诊断；不用 GUI 传长内容，也不用 GUI 读取结果。
- 备案期间审美验收使用本地 dev server 加 `tunnel-18080` 同类隧道；`nianlife.cn` 不作为可用验收源。

固定刹车：

- 同一任务连续 **3 轮验收不通过**，停下问 Teddy。
- 纯文档 commit 只本地提交，不 push。
- 每日 push 次数和单目标轮数当前不设上限；仍需逐次记录，便于 Teddy 观察成本和反复程度。

本手册取代 `docs/DIRECT-COORDINATION.md` 中与“四方角色、双执行线、Cowork 验收”冲突的旧时点安排。自 2026-09-15 起，Teddy 明确授权当前及后续 Cowork 会话读取 Nianlife 仓库与私有站全部内容并完整截图取证，不再因家庭、儿童、健康或未发布内容停止评审或做内容脱敏。该授权只扩大 Cowork 的项目内评审权限，不改变私有站的公开范围、生产访问控制、V1/V2 边界、发布审批或不可逆操作限制。

## 2. 角色边界

| 角色 | 负责 | 禁止 |
| --- | --- | --- |
| Teddy | 定目标；裁决不可逆、费用、生产、冲突 BLOCKER | 不承担跨 session 传话 |
| Codex | 拆任务、写任务卡、唤醒、按 ETA 检查、客观验收、排合并顺序、维护状态、汇报 | 不写业务代码；不把执行方自述当完成证据 |
| Claude Code 数据线 | 数据、存储、导入、Organizer 等获授权目录内实现与验证 | 不碰页面线或共享保留区；不自行建分支 |
| Claude Code 页面线 | 页面、组件、样式、静态前端资源等获授权目录内实现与验证 | 不碰数据线或共享保留区；不自行建分支 |
| Cowork | 浏览器真实验收、截图、原则比对、分级结论、主动审美巡检 | 不派活、不写代码、不读代码代替看页面、不改状态文档 |

## 3. 唯一文件通道

### 3.1 仓库内：Codex 与 Claude Code

```text
collab/
  tasks/data/<id>.md
  tasks/page/<id>.md
  state/ORCHESTRATOR-STATE.md
  state/data-handoff.md
  state/page-handoff.md
```

任务、执行交接和指挥交接只认以上路径。任务完成证据写在任务卡指定的产物或 commit/test/build 结果中；聊天自述不是完成证据。

### 3.2 NianlifeOps：Codex 与 Cowork、唯一 GUI 锁

后发布的 NianlifeOps 约定覆盖早期 `collab/review-requests`、`collab/review-results`、`collab/screenshots`、`collab/locks/gui.lock` 逻辑名。运行时只使用以下物理路径，不复制双份、不维护第二把锁：

```text
C:\Users\teddy\NianlifeOps\
  _inbox/cowork/<id>.md
  _state/cowork-ready.md
  _state/cowork-handoff.md
  _state/nianlife-product-principles.md
  _state/nianlife-product-principles.sha256
  _locks/gui.lock
  review-<轮次名>/
    README.md
    01-xxx/ 02-xxx/ ...
    capture-log.json
```

逻辑映射：`review-requests/<id>.md` → `_inbox/cowork/<id>.md`；`review-results/<id>.md` → `review-<轮次名>/README.md`；`screenshots/<id>/` → `review-<轮次名>/01-xxx/` 等分页面目录；`locks/gui.lock` → `_locks/gui.lock`。

## 4. 执行线与 Git 隔离

固定执行分支：

- 数据线：`claude/data-line`，固定 worktree `C:\Users\teddy\Nianlife-worktrees\data`
- 页面线：`claude/page-line`，固定 worktree `C:\Users\teddy\Nianlife-worktrees\page`
- 集成线：`main`

分支和独立 worktree 必须由 Codex 在派单前确认已准备好；本协议本身不授权任何执行方新建分支。若分支或 worktree 不存在，任务状态为 `BLOCKED`，不得退回共用 checkout 并行写。

控制面始终是主 checkout 的绝对路径 `C:\Users\teddy\Documents\Nianlife\collab`。两个执行 worktree 中随分支复制的 `collab` 不是消息源；任务卡和 handoff 一律从控制面绝对路径读写。

### 4.1 首次自举

Codex 连接整条链路时加载 `.agents/skills/nianlife-orchestrator/SKILL.md`，而不是执行方的 `exec-protocol`。依次建立控制面目录、两条固定分支/worktree、Claude `数据`/`页面` session ACK、Cowork 当前会话 B0，并把客观证据写入 `collab/state/ORCHESTRATOR-STATE.md`。四条链接未全部有证据前只能写 `PARTIAL` 或 `BLOCKED`，不得宣称已连接。

目录所有权的完整表在 `.claude/skills/exec-protocol/SKILL.md`。跨线或共享保留区改动必须先停，由 Codex 在任务卡里指定唯一写者、依赖和合并顺序。任务发出后不得临时交换合并顺序；确需改变时，旧任务作废并发新版任务卡。

每个目标在第一张任务卡中写死：`base SHA → 前置任务 → data/page 合并次序 → 目标 main SHA`。一个 task 对应一个主要 commit；后续修复用新轮次 commit，保留历史。

## 5. 派单格式与生命周期

### 5.0 效率优先路由

- 页面、组件、CSS、文案归页面线；数据库、真实数据运行环境、凭据注入、隧道、导入、存储、Organizer 和服务恢复归数据线。不得因为 build 位于页面 worktree 就先让页面线尝试数据环境工作。
- 混合目标只在首次派单时拆一次；无依赖的 data/page 同时派发，有明确依赖才串行。不得先发“调查归属”卡再转线。
- 任务卡只写本轮决定、可观察验收、允许路径、证据、ETA 和刹车；已有报告用路径引用，不整段复制。默认一个实现卡；只有验收出现具体缺陷才发一张最小修复卡。
- 15 分钟是 Codex 最长检查间隔，不要求执行方每 15 分钟制造进度记录。健康运行时不发状态噪音。
- 每张新卡只唤醒一次。GUI 前先读任务卡与 Git；已 ACK、运行中或证据持续变化时禁止重复唤醒。
- 已成立证据按 commit、页面、视口登记并复用。续审只列缺失或本轮改变的页面/视口，不重复截图、测试、build 或健康检查。
- 浏览器控制超时不等于站点失败。只探测一次精确 URL、health 和进程；只恢复已确认故障的组件。资源不足导致验收环境退出时，同一环境最多恢复一次，第二次失败即 `BLOCKED`，不循环重启。
- 真实数据验收环境一旦可用就保持到 Cowork 收活；不要在页面实现、运行环境、Cowork 验收之间反复启停。

Codex 创建 `collab/tasks/<line>/<id>.md`，至少包含：

```markdown
# <id> <标题>
- line: data | page
- status: queued
- round: <从1递增，不设上限>
- branch: claude/data-line | claude/page-line
- base_sha: <sha>
- depends_on: <id/none>
- merge_order: <明确顺序>
- objective: <目标>
- acceptance: <可观察标准>
- allowed_paths: <逐项路径>
- forbidden: <禁止事项>
- eta: <北京时间>
- next_check: <北京时间，距现在不超过15分钟>
- required_evidence: <commit/test/build/URL/产物>
- push_policy: <本轮是否允许 push；文档-only 必为 no>
- stop_conditions: <费用/生产/删除/跨线等>
```

状态只用：`queued → acknowledged → running → submitted → accepted`；异常用 `blocked`、`stalled`、`changes_requested`、`cancelled`。只有 Codex 能写 `accepted`。

派发步骤：

1. 写完整任务卡并检查允许目录、依赖、合并顺序和刹车条件。
2. 取得 GUI 锁；唤醒对应 Claude Code session。
3. GUI 里只发送一句：`读 collab/tasks/<line>/<id>.md 并执行`。
4. 确认消息已进入对话后立刻释放锁。
5. 按 ETA 或客观事件检查，任意检查间隔不得超过 15 分钟；一次合并读取任务卡与 Git 证据，不要求执行方另写定时心跳。

Codex 只认客观信号：新 commit、命令与退出码对应的测试/构建产物、或可访问 URL 的实际表现。`完成了`、进度口述、文件存在但内容未验，均不能升为 `accepted`。

连续两次 check 没有新的客观信号，标为 `stalled`，做一次介入诊断：检查 session 是否仍运行、是否卡权限/命令/上下文、任务卡是否自相矛盾。诊断后写具体修订任务卡；不重复发送同一指令。

验收不通过时写清：实际证据、与哪条验收标准的差距、修复范围、新 ETA、轮次。然后回到派单步骤 1。

## 6. GUI 互斥锁

唯一锁：`C:\Users\teddy\NianlifeOps\_locks\gui.lock`。

操作 GUI 前先原子创建锁，内容为：

```yaml
holder: codex | cowork
acquired_at: <ISO-8601 +08:00>
expected_release_at: <ISO-8601 +08:00>
purpose: <task/review id>
```

- 锁存在时，另一方只能读写文件，不能碰鼠标键盘。
- 当前时间超过 `acquired_at` 10 分钟，锁失效；原持有方若还要用 GUI，必须重新申请，不能延长旧锁。
- 删除锁前确认自己仍是 holder。Codex 唤醒 Cowork 或执行 session 后立即释放。
- 异常退出遗留的过期锁要先记录到 `ORCHESTRATOR-STATE.md` 再清理；未过期锁不抢占。

## 7. Cowork 通道 B0 自举

每个新 Cowork 会话的第一件事都是 B0。文件夹授权按会话、不继承；只能由 Cowork 发起，Codex只能在系统弹窗点击批准。派发任何审美请求前，必须核对 `_state/cowork-ready.md` 的会话标识等于当前会话。

1. Codex 取 GUI 锁。
2. 明确切换到 `Chat and Cowork` 并选择目标 Cowork task；截图必须同时证明会话名正确，且主区域没有仓库、分支、Changes、Create PR 等 Code 控件。仅凭会话名称不得继续。
3. 用剪贴板粘贴并发送（禁止直接键入中文）：`请对 C:\Users\teddy\NianlifeOps 和 C:\Users\teddy\Documents\Nianlife 申请文件夹访问权限，完成后写 _state/cowork-ready.md`
4. Cowork 发起授权；Codex 重新截图定位系统弹窗，再点“批准 / Allow”，不得硬编码坐标。
5. Cowork 写 `_state/cowork-ready.md`：全部已授权路径、时间戳、会话标识、context 余量。
6. Codex 从文件读到当前会话标识，才算通道打通；随后释放锁。

失败处理：20 秒内无弹窗，重新截图一次；仍无则回到步骤 2 重发一次。弹窗被拒绝或误关后不再申请，记 `BLOCKED` 并汇报 Teddy。ready 文件属于旧会话时视为无效，重跑 B0。

Cowork 已获授权读取仓库与 NianlifeOps。每轮请求仍记录 `docs/nianlife-product-principles.md` 的 SHA-256，确保评审基线可追溯；无需再因文件内容类别停读、停截图或省略证据。

## 8. Cowork 审美验收

调用时机：任一里程碑完成；任何影响视觉、排版、信息层级或文案的改动合并前；上线前。不得按每个 commit 调用。

Codex 先确认 dev server、隧道和验收期间的存活责任，再写 `C:\Users\teddy\NianlifeOps\_inbox\cowork\<id>.md`。缺少以下任一项，Cowork 必须直接返回 `BLOCKED`：

- 实际可访问的当轮隧道 URL；
- 需要逐个打开的页面路径；
- 本轮改动和期望效果；
- 对应 commit 与分支。
- `_state/nianlife-product-principles.md` 的当轮 SHA-256。

唤醒顺序：取锁 → 截图确认窗口和输入框 → 剪贴板粘贴 `读 C:\Users\teddy\NianlifeOps\_inbox\cowork\<id>.md 并执行审美验收` → 截图确认已发送 → 释放锁。之后每 5 分钟只轮询目标 `review-<轮次名>\README.md`，运行期间不重复派发。

身份门：发送前必须处于 `Chat and Cowork` 的目标 task，且页面无仓库、分支、Changes、Create PR 控件。请求若误入 Code session，即使它能调用浏览器 agent，其产物也标为 `INVALID_SOURCE_CODE_SESSION`，不得算 Cowork 结论；停止错误计数后只向正确 Cowork task 重新派发一次。

20 分钟无结果时才重新取锁并截图一次，只判断：仍运行、等待权限、已中断。随后释放锁并据实记状态。

Cowork 必须真实打开每个页面，把截图存入分页面目录，生成 `capture-log.json`，并按已校验哈希的 `_state/nianlife-product-principles.md` 原文快照逐条比较。结论分级：

- `BLOCKER`：阻断合并/上线；Codex 不得忽略，只能修复或交 Teddy 裁决。
- `SHOULD-FIX`：进入待办，下个里程碑前清空。
- `POLISH`：记录，不阻断。

每条必须含页面、截图文件名、违反的原则条款、实际状态和期望状态。README 末尾必须含 context 余量、是否需续接、下次主动巡检时间。

Cowork 可主动写 `review-proactive-YYYY-MM-DD\README.md` 及截图；Codex 定期收取并决定是否进入任务队列，Cowork不得自行派活。

## 9. 上下文与会话生命周期

- Claude Code session context 超过 50%：先写 `collab/state/<line>-handoff.md`，再 `/clear`，最后用 handoff 重建提示。不得颠倒。
- Codex context 超过 75%：先更新 `collab/state/ORCHESTRATOR-STATE.md`，再开新 session；新 session 第一步读取该文件。
- `ORCHESTRATOR-STATE.md` 必含：目标、已完成及证据、进行中、待办、session 映射、分支/base/合并顺序、push 记录、未清 BLOCKER、GUI 锁状态、下次 check 时间。
- Cowork context 余量小于 25%，或连续两次派发无响应时换会话。先让旧会话写 `_state/cowork-handoff.md`（审美判断、未清 BLOCKER、反复问题、产品原则解读），再新建固定前缀会话，跑 B0，首条指令读 handoff。未写 handoff 不得换会话。
- Cowork 是否续接只读 README 状态块，不从截图猜 context。

## 10. 合并、push 与验收门

Codex 不写业务代码，但负责核对提交边界和执行预定合并顺序。合并前必须满足：

1. commit 只改任务卡允许路径，无夹带用户现有改动；
2. 任务卡要求的 typecheck、lint、test、build 均有命令与退出码证据；
3. 视觉/文案改动已取得 Cowork 结果，未清 `BLOCKER` 为零；
4. `SHOULD-FIX` 已排入且不晚于下个里程碑；
5. push 已逐次记录，且本次不是纯文档 push；
6. 生产发布、push、本地构建和可访问 URL 验收分别记录，互不替代。

纯文档 commit 留在本地。业务提交只向任务卡指定分支 push；最终合入 `main` 的动作与顺序必须已在初始任务卡写明。push 不代表生产部署。

## 11. 汇报与刹车

每两小时向 Teddy 汇报一次；无进展也报原因。固定三段：

1. 已完成（附 commit、测试/构建、URL/截图等证据）；
2. 风险与阻塞（含所有未清 `BLOCKER`）；
3. 需要你决策的事项（没有则写“无”）。

以下情况必须停止相关动作并问 Teddy：生产数据库变更、删除数据、产生费用；纯文档要求 push；连续 3 轮验收失败；未解决 `BLOCKER` 且 Codex 与 Cowork 判断冲突。每日 push 次数和单目标轮数不设上限，但必须保留记录。停止时仍可做只读诊断和整理证据，不可扩大权限或自动重试。

## 12. 最小可跑示例

目标：调整 `/memory` 标题层级，不改数据。

1. Codex 写 `collab/tasks/page/PAGE-0915-001.md`，允许 `v2/app/memory/**` 与 `v2/components/**`，分支 `claude/page-line`，验收为手机/桌面标题层级清楚，ETA 20 分钟；写明先合 page、无需 data。
2. Codex 取 `_locks/gui.lock`，只发送“读 collab/tasks/page/PAGE-0915-001.md 并执行”，确认送达后释放锁。
3. 15 分钟内检查新 commit 和 `typecheck/lint/test/build` 证据；两次无变化才标 stalled。
4. 页面线提交后，Codex 保证本地 dev server 与隧道可达，核对当前 Cowork ready；必要时先跑 B0。
5. 写 `_inbox/cowork/PAGE-0915-001.md`，列 URL、`/memory`、改动目标、commit/branch；唤醒后每 5 分钟轮询 `review-PAGE-0915-001/README.md`。
6. Cowork 截手机/桌面图并给出无 BLOCKER 的结论；Codex核对证据后按预定顺序合入。若这是纯文档示例则只本地 commit；本例为业务代码，计一次 push。

## 13. 通用失败处理

- 文件缺字段：接收方写 `BLOCKED` 和缺项，不猜测补全。
- URL/隧道不可达：Cowork 直接 `BLOCKED`，不读代码替代页面验收。
- 跨线改动：执行方立即停止，在任务卡记录目标路径和原因，等 Codex 发新版卡。
- Git 基线不符或发现他人未提交改动：不 reset、不覆盖、不带入 commit；记录状态并等 Codex 裁决。
- 测试失败：保留失败命令、退出码和最小错误证据；不把部分通过写成完成。
- GUI 锁冲突：只做文件读写；过期才按本手册处理。
- 无客观进展：两次 check 后 stalled；同一任务不重复派发、不中途改变合并顺序。
