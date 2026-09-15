# BOOTSTRAP-DATA 数据线握手

- line: data
- status: acknowledged
- round: 1
- branch: `claude/data-line`
- worktree: `C:\Users\teddy\Nianlife-worktrees\data`
- base_sha: `9f121067547746c0bc24a6c408047ea57251330e`
- depends_on: none
- merge_order: bootstrap only; no merge
- objective: 加载执行协议，确认数据线可从绝对控制面读写任务，并能在固定 worktree 运行只读 Git 检查。
- acceptance: 在本文件末尾追加 ACK，包含实际 worktree、当前分支、HEAD、skill 已加载、是否可接收新任务。
- allowed_paths: 仅本文件的 ACK 区域；业务代码零改动。
- forbidden: 不改业务代码，不提交，不 push，不部署，不切换或新建分支。
- eta: 收到唤醒后 5 分钟内
- required_evidence: `git -C C:\Users\teddy\Nianlife-worktrees\data branch --show-current` 与 `rev-parse HEAD` 的实际结果。
- push_policy: no
- stop_conditions: 路径、分支、HEAD 或 skill 任一不符即写 BLOCKED。

## ACK

- acked_at: 2026-09-15 14:04:56 北京时间
- skill: 已加载 `C:\Users\teddy\Documents\Nianlife\.claude\skills\exec-protocol\SKILL.md`（文件存在，已完整读取）
- control_plane: 通过绝对路径 `C:\Users\teddy\Documents\Nianlife\collab\tasks\data\BOOTSTRAP-DATA.md` 读写，确认可用
- worktree: `C:/Users/teddy/Nianlife-worktrees/data`（`git -C C:\Users\teddy\Nianlife-worktrees\data rev-parse --show-toplevel`）
- `git -C C:\Users\teddy\Nianlife-worktrees\data branch --show-current` → `claude/data-line`
- `git -C C:\Users\teddy\Nianlife-worktrees\data rev-parse HEAD` → `9f121067547746c0bc24a6c408047ea57251330e`（与 base_sha 一致）
- `git -C C:\Users\teddy\Nianlife-worktrees\data status --short --branch` → `## claude/data-line`（无改动、无未跟踪文件）
- 结论：路径、分支、HEAD、skill 均相符，未触发 BLOCKED；业务代码零改动，未提交、未 push、未部署、未切换或新建分支。
- ready_for_new_tasks: yes
